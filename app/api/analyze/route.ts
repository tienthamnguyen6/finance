import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { glm, GLM_MODEL } from "@/lib/glm";
import { enrich, type PriceRow } from "@/lib/indicators";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Compute "features" — đại lượng tóm tắt để LLM khỏi phải tự đếm.
function buildFeatures(enriched: ReturnType<typeof enrich>) {
  const n = enriched.length;
  const last = enriched[n - 1];
  const prev = enriched[n - 2];
  const wkAgo = enriched[Math.max(0, n - 6)];
  const moAgo = enriched[Math.max(0, n - 21)];

  const pct = (a?: number | null, b?: number | null) =>
    a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null;

  const recent20 = enriched.slice(-20);
  const high20 = Math.max(...recent20.map((r) => r.high_price ?? r.close_price));
  const low20 = Math.min(...recent20.map((r) => r.low_price ?? r.close_price));

  const volumes20 = recent20.map((r) => r.volume ?? 0);
  const avgVol = volumes20.reduce((s, v) => s + v, 0) / Math.max(1, volumes20.length);
  const volSpike = last.volume != null && avgVol > 0 ? last.volume / avgVol : null;

  // Đếm phiên xanh/đỏ 10 gần nhất.
  const recent10 = enriched.slice(-10);
  const up = recent10.filter((r) => (r.daily_return ?? 0) > 0).length;
  const down = recent10.filter((r) => (r.daily_return ?? 0) < 0).length;

  const bbPos =
    last.bb_upper != null && last.bb_lower != null && last.bb_upper !== last.bb_lower
      ? ((last.close_price - last.bb_lower) / (last.bb_upper - last.bb_lower)) * 100
      : null;

  return {
    date: last.trade_date,
    close: last.close_price,
    chg_1d: pct(last.close_price, prev?.close_price),
    chg_5d: pct(last.close_price, wkAgo?.close_price),
    chg_20d: pct(last.close_price, moAgo?.close_price),
    high_20d: high20,
    low_20d: low20,
    dist_from_high20_pct: pct(last.close_price, high20),
    dist_from_low20_pct: pct(last.close_price, low20),
    ma20: last.ma20,
    ma50: last.ma50,
    price_vs_ma20_pct: pct(last.close_price, last.ma20),
    price_vs_ma50_pct: pct(last.close_price, last.ma50),
    ma20_vs_ma50: last.ma20 != null && last.ma50 != null ? (last.ma20 > last.ma50 ? "MA20>MA50 (đà tăng)" : "MA20<MA50 (đà giảm)") : null,
    rsi14: last.rsi14,
    rsi_state:
      last.rsi14 == null ? null : last.rsi14 >= 70 ? "quá mua" : last.rsi14 <= 30 ? "quá bán" : "trung tính",
    macd: last.macd,
    macd_signal: last.macd_signal,
    macd_hist: last.macd_hist,
    macd_state:
      last.macd != null && last.macd_signal != null
        ? last.macd > last.macd_signal
          ? "MACD trên signal (đà tăng)"
          : "MACD dưới signal (đà giảm)"
        : null,
    bb_upper: last.bb_upper,
    bb_lower: last.bb_lower,
    bb_position_pct: bbPos, // 0% = chạm dải dưới, 100% = chạm dải trên
    volume_last: last.volume,
    volume_avg20: Math.round(avgVol),
    volume_spike_x: volSpike, // >1.5 là bất thường
    up_sessions_10d: up,
    down_sessions_10d: down,
  };
}

// POST /api/analyze  body: { ticker: "FPT", force?: boolean }
// Mặc định: trả cache nếu có (cùng phiên giao dịch). force=true → rerun GLM và đè cache.
export async function POST(req: NextRequest) {
  const { ticker, force } = await req.json();
  if (!ticker) return new Response("missing ticker", { status: 400 });
  const sym = String(ticker).toUpperCase();

  // Fetch ~80 phiên đủ warmup cho MA50.
  const { data: rawRows, error } = await supabase
    .from("vn30_daily_prices")
    .select("trade_date, open_price, high_price, low_price, close_price, volume, daily_return")
    .eq("ticker", sym)
    .order("trade_date", { ascending: false })
    .limit(80);

  if (error) return new Response(error.message, { status: 500 });
  if (!rawRows?.length) return new Response("không có dữ liệu cho mã này", { status: 404 });

  const asc = (rawRows as PriceRow[]).slice().reverse();
  const enriched = enrich(asc);
  const f = buildFeatures(enriched);
  const tradeDate = f.date; // phiên gần nhất trong DB

  // Cache hit: nếu đã có phân tích cho (ticker, tradeDate) và không force.
  if (!force) {
    const { data: cached } = await supabase
      .from("ai_analyses")
      .select("content, model, created_at")
      .eq("ticker", sym)
      .eq("trade_date", tradeDate)
      .maybeSingle();
    if (cached?.content) {
      return new Response(cached.content, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Cache": "HIT",
          "X-Cache-Model": cached.model,
          "X-Cache-Created": cached.created_at,
        },
      });
    }
  }

  // OHLCV 10 phiên gần nhất — đủ cho LLM "nhìn" mà không phình token.
  const last10 = enriched.slice(-10).map((r) => ({
    d: r.trade_date,
    o: r.open_price,
    h: r.high_price,
    l: r.low_price,
    c: r.close_price,
    v: r.volume,
    ret: r.daily_return != null ? +(r.daily_return * 100).toFixed(2) : null,
  }));

  // System prompt được giữ static giữa các request → Zhipu auto-cache phần prefix này
  // (Cached Input rẻ 5x so với Input thường). KHÔNG chèn ticker/data vào đây.
  const sys = `Bạn là analyst kỹ thuật chuyên thị trường chứng khoán Việt Nam.

## Nguyên tắc tuyệt đối
1. Mỗi nhận định gồm 3 phần: **LUẬN ĐIỂM** + **BẰNG CHỨNG** (số liệu trích chính xác từ dữ liệu được cung cấp) + **CƠ CHẾ** (giải thích tại sao tín hiệu kỹ thuật này dẫn tới hệ quả đó dựa trên lý thuyết).
2. KHÔNG bịa tin tức, sự kiện vĩ mô, dòng tiền khối ngoại, hay bất kỳ con số nào nằm ngoài dữ liệu được cung cấp.
3. KHÔNG khuyến nghị mua/bán dứt khoát. Luôn nêu điều kiện invalidation (khi nào nhận định bị bác bỏ).
4. Trả lời tiếng Việt, format markdown, ngắn gọn, đi thẳng vào trọng tâm.

## Cấu trúc output bắt buộc

### 1. Bối cảnh & xu hướng
Nêu xu hướng chủ đạo (1-3 tháng) — bằng chứng từ MA20/MA50, position so với biên 20 phiên. Giải thích cơ chế (tại sao MA cắt nhau hoặc giá break đỉnh/đáy lại hàm ý xu hướng đó).

### 2. Tín hiệu kỹ thuật then chốt
Liệt kê 2-3 tín hiệu nổi bật từ RSI / MACD / Bollinger / volume. Mỗi tín hiệu phải có:
- **Quan sát**: số liệu cụ thể
- **Hệ quả thường gặp**: theo lý thuyết kỹ thuật (vd: RSI > 70 → áp lực chốt lời ngắn hạn; phân kỳ âm RSI-giá → cảnh báo đảo chiều)
- **Lưu ý**: tín hiệu này có thể sai khi nào (vd: trong xu hướng tăng mạnh, RSI > 70 vẫn duy trì nhiều phiên)

### 3. Diễn biến phiên gần nhất
Giải thích Δ1d bằng cơ chế: volume có spike bất thường không, giá đóng ở đâu trong biên ngày (gần high/low), tương quan với MA và dải Bollinger, có gap không.

### 4. Kháng cự / hỗ trợ
Ước tính 2 mức kháng cự và 2 mức hỗ trợ, lấy từ: biên 20 phiên, MA20/MA50, dải Bollinger, các đỉnh/đáy local quan sát được trong OHLCV. Nêu lý do chọn mỗi mức.

### 5. Kịch bản & điều kiện invalidation
- **Kịch bản tăng**: cần điều kiện gì xác nhận (vd: đóng cửa trên kháng cự X với volume > Y)?
- **Kịch bản giảm**: cần break mức nào để xác nhận đảo chiều?
- **Rủi ro chính** dựa trên dữ liệu hiện tại (vd: RSI quá mua + volume yếu = phân kỳ).

## Quy tắc bằng chứng
- Khi trích số liệu, ghi chính xác (vd: "RSI14 = 67.3" không phải "RSI cao").
- Khi nói "khối lượng tăng đột biến", phải nêu hệ số so với TB 20 phiên.
- Khi nói "vượt MA20", phải nêu khoảng cách % cụ thể.`;

  const user = `Phân tích kỹ thuật mã **${ticker}** dựa trên dữ liệu sau:

## Chỉ số tổng hợp phiên ${f.date}
- Giá đóng: **${f.close}** | Δ1d: ${f.chg_1d?.toFixed(2)}% | Δ5d: ${f.chg_5d?.toFixed(2)}% | Δ20d: ${f.chg_20d?.toFixed(2)}%
- Biên 20 phiên: cao ${f.high_20d} / thấp ${f.low_20d} → giá đang cách đỉnh ${f.dist_from_high20_pct?.toFixed(2)}%, cách đáy ${f.dist_from_low20_pct?.toFixed(2)}%
- MA20: ${f.ma20?.toFixed(2)} (giá ${f.price_vs_ma20_pct?.toFixed(2)}% so với MA20)
- MA50: ${f.ma50?.toFixed(2)} (giá ${f.price_vs_ma50_pct?.toFixed(2)}% so với MA50) — ${f.ma20_vs_ma50}
- RSI14: **${f.rsi14?.toFixed(1)}** (${f.rsi_state})
- MACD: ${f.macd?.toFixed(3)} | signal: ${f.macd_signal?.toFixed(3)} | hist: ${f.macd_hist?.toFixed(3)} — ${f.macd_state}
- Bollinger: upper ${f.bb_upper?.toFixed(2)} / lower ${f.bb_lower?.toFixed(2)} — vị trí ${f.bb_position_pct?.toFixed(0)}% (0=chạm dải dưới, 100=chạm dải trên)
- Khối lượng phiên cuối: ${f.volume_last?.toLocaleString()} (TB 20 phiên: ${f.volume_avg20?.toLocaleString()}, hệ số ${f.volume_spike_x?.toFixed(2)}x)
- 10 phiên gần nhất: ${f.up_sessions_10d} xanh / ${f.down_sessions_10d} đỏ

## OHLCV 10 phiên cuối
${last10.map((r) => `${r.d}: O=${r.o} H=${r.h} L=${r.l} C=${r.c} V=${r.v?.toLocaleString()} (${r.ret}%)`).join("\n")}

Trả lời theo đúng 5 mục đã định nghĩa ở system prompt.`;

  const stream = await glm.chat.completions.create({
    model: GLM_MODEL,
    stream: true,
    temperature: 0.3,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const encoder = new TextEncoder();
  let buffer = "";
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            buffer += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }
        // Lưu cache khi stream hoàn tất (không await trước khi close — fire-and-forget).
        if (buffer.trim()) {
          supabase
            .from("ai_analyses")
            .upsert({ ticker: sym, trade_date: tradeDate, model: GLM_MODEL, content: buffer })
            .then(({ error: upErr }) => {
              if (upErr) console.error("Cache upsert lỗi:", upErr.message);
            });
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(`\n\n[Lỗi LLM] ${e?.message ?? e}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Cache": "MISS",
    },
  });
}
