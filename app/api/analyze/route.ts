import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { glm, GLM_MODEL } from "@/lib/glm";
import { enrich, type PriceRow } from "@/lib/indicators";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Enriched = ReturnType<typeof enrich>;

// Tìm swing high/low cục bộ (fractal): đỉnh/đáy mà cao/thấp hơn `w` nến hai bên.
// Đây là kháng cự/hỗ trợ "thật" thị trường từng phản ứng, thay vì chỉ min/max cửa sổ.
function findSwings(rows: Enriched, w = 3) {
  const highs: { date: string; price: number }[] = [];
  const lows: { date: string; price: number }[] = [];
  for (let i = w; i < rows.length - w; i++) {
    const h = rows[i].high_price ?? rows[i].close_price;
    const l = rows[i].low_price ?? rows[i].close_price;
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      const hj = rows[j].high_price ?? rows[j].close_price;
      const lj = rows[j].low_price ?? rows[j].close_price;
      if (hj >= h) isHigh = false;
      if (lj <= l) isLow = false;
    }
    if (isHigh) highs.push({ date: rows[i].trade_date, price: h });
    if (isLow) lows.push({ date: rows[i].trade_date, price: l });
  }
  return { highs, lows };
}

// ATR(14) — biên độ dao động trung bình, dùng ước lượng stop/target và R:R.
function atr(rows: Enriched, period = 14): number | null {
  if (rows.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const h = rows[i].high_price ?? rows[i].close_price;
    const l = rows[i].low_price ?? rows[i].close_price;
    const pc = rows[i - 1].close_price;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const lastN = trs.slice(-period);
  return lastN.reduce((s, v) => s + v, 0) / period;
}

// Chuỗi tăng/giảm liên tiếp tính tới phiên cuối.
function streak(rows: Enriched): { dir: "tăng" | "giảm" | "đi ngang"; len: number } {
  let len = 0;
  let dir: "tăng" | "giảm" | "đi ngang" = "đi ngang";
  for (let i = rows.length - 1; i > 0; i--) {
    const r = rows[i].daily_return ?? 0;
    const d = r > 0 ? "tăng" : r < 0 ? "giảm" : "đi ngang";
    if (i === rows.length - 1) {
      dir = d;
      len = 1;
    } else if (d === dir && d !== "đi ngang") len++;
    else break;
  }
  return { dir, len };
}

// Phát hiện phân kỳ RSI vs giá trên ~14 phiên gần nhất (tín hiệu đảo chiều sớm).
function rsiDivergence(rows: Enriched): string | null {
  const w = rows.slice(-14);
  if (w.length < 8) return null;
  const prices = w.map((r) => r.close_price);
  const rsis = w.map((r) => r.rsi14).filter((x): x is number => x != null);
  if (rsis.length < 8) return null;
  const half = Math.floor(w.length / 2);
  const pMax1 = Math.max(...prices.slice(0, half));
  const pMax2 = Math.max(...prices.slice(half));
  const pMin1 = Math.min(...prices.slice(0, half));
  const pMin2 = Math.min(...prices.slice(half));
  const rMax1 = Math.max(...rows.slice(-14, -14 + half).map((r) => r.rsi14 ?? 0));
  const rMax2 = Math.max(...rows.slice(-half).map((r) => r.rsi14 ?? 0));
  const rMin1 = Math.min(...rows.slice(-14, -14 + half).map((r) => r.rsi14 ?? 100));
  const rMin2 = Math.min(...rows.slice(-half).map((r) => r.rsi14 ?? 100));
  if (pMax2 > pMax1 && rMax2 < rMax1) return "Phân kỳ ÂM: giá tạo đỉnh cao hơn nhưng RSI đỉnh thấp hơn → cảnh báo suy yếu đà tăng";
  if (pMin2 < pMin1 && rMin2 > rMin1) return "Phân kỳ DƯƠNG: giá tạo đáy thấp hơn nhưng RSI đáy cao hơn → khả năng tạo đáy";
  return null;
}

// Compute "features" — đại lượng tóm tắt để LLM khỏi phải tự đếm.
function buildFeatures(enriched: Enriched) {
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
  // Xu hướng khối lượng: TB 5 phiên gần / TB 5 phiên trước đó.
  const vol5recent = enriched.slice(-5).reduce((s, r) => s + (r.volume ?? 0), 0) / 5;
  const vol5prev = enriched.slice(-10, -5).reduce((s, r) => s + (r.volume ?? 0), 0) / 5;
  const volTrend = vol5prev > 0 ? vol5recent / vol5prev : null;

  const recent10 = enriched.slice(-10);
  const up = recent10.filter((r) => (r.daily_return ?? 0) > 0).length;
  const down = recent10.filter((r) => (r.daily_return ?? 0) < 0).length;

  const bbPos =
    last.bb_upper != null && last.bb_lower != null && last.bb_upper !== last.bb_lower
      ? ((last.close_price - last.bb_lower) / (last.bb_upper - last.bb_lower)) * 100
      : null;
  // Độ rộng Bollinger (volatility regime): (upper-lower)/mid. Hẹp = squeeze, sắp bung.
  const bbWidth =
    last.bb_upper != null && last.bb_lower != null && last.ma20
      ? ((last.bb_upper - last.bb_lower) / last.ma20) * 100
      : null;

  const { highs, lows } = findSwings(enriched, 3);
  const cls = last.close_price;
  // Kháng cự = swing high gần nhất TRÊN giá; hỗ trợ = swing low gần nhất DƯỚI giá.
  const resistances = highs
    .filter((h) => h.price > cls)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);
  const supports = lows
    .filter((l) => l.price < cls)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  const atr14 = atr(enriched, 14);
  const stk = streak(enriched);
  const divergence = rsiDivergence(enriched);

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
    bb_position_pct: bbPos,
    bb_width_pct: bbWidth,
    volume_last: last.volume,
    volume_avg20: Math.round(avgVol),
    volume_spike_x: volSpike,
    volume_trend_x: volTrend, // >1 = khối lượng đang tăng dần
    up_sessions_10d: up,
    down_sessions_10d: down,
    streak_dir: stk.dir,
    streak_len: stk.len,
    atr14,
    atr_pct: atr14 != null && last.close_price ? (atr14 / last.close_price) * 100 : null,
    rsi_divergence: divergence,
    swing_resistances: resistances, // kháng cự thật từ swing high
    swing_supports: supports, // hỗ trợ thật từ swing low
  };
}

// POST /api/analyze  body: { ticker: "FPT", force?: boolean }
// Mặc định: trả cache nếu có (cùng phiên giao dịch). force=true → rerun GLM và đè cache.
export async function POST(req: NextRequest) {
  let ticker: string | undefined;
  let force = false;
  try {
    const body = await req.json();
    ticker = body?.ticker;
    force = !!body?.force;
  } catch {
    return new Response("invalid json body", { status: 400 });
  }
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
  const sys = `Bạn là trưởng bộ phận phân tích kỹ thuật một quỹ đầu tư, chuyên TTCK Việt Nam. Người đọc là nhà đầu tư có kinh nghiệm — họ KHÔNG cần định nghĩa chỉ báo, họ cần đọc được cấu hình kỹ thuật RIÊNG của mã này và một kết luận có thể hành động.

## Nguyên tắc tuyệt đối
1. KHÔNG giảng lý thuyết sách giáo khoa. Cấm các câu định nghĩa chung như "RSI là chỉ báo đo...". Thay vào đó luôn nói về CON SỐ CỤ THỂ của mã này và nó HÀM Ý GÌ.
2. Mỗi nhận định = SỐ LIỆU cụ thể → SUY LUẬN cơ chế → HỆ QUẢ giao dịch. Không nêu số liệu suông, không kết luận chay.
3. Khi nhiều tín hiệu mâu thuẫn (vd MACD tăng nhưng RSI phân kỳ âm), PHẢI nêu rõ mâu thuẫn và cân nhắc bên nào thắng thế, đừng liệt kê song song cho an toàn.
4. KHÔNG bịa tin tức/sự kiện vĩ mô/khối ngoại/số liệu ngoài dữ liệu cung cấp.
5. KHÔNG hô "mua/bán" kiểu phím hàng. Nhưng PHẢI đưa kết luận actionable: kịch bản xác suất cao nhất, vùng giá quan tâm, mức kích hoạt, mức vô hiệu hoá (invalidation), và tỷ lệ lời/lỗ ước tính.
6. Tiếng Việt, markdown, súc tích. Ưu tiên mật độ thông tin trên độ dài — thà 6 câu sắc còn hơn 3 đoạn loãng.

## Cấu trúc output bắt buộc (giữ đúng heading)

### 1. Chẩn đoán nhanh
2-3 câu chốt ngay: mã đang ở pha nào (tăng/giảm/tích luỹ/phân phối), vị thế kỹ thuật mạnh hay yếu, và điều quan trọng nhất nhà đầu tư cần biết lúc này. Đây là phần "đọc 10 giây hiểu ngay".

### 2. Cấu hình kỹ thuật
Phân tích sự GIAO THOA của các chỉ báo (không liệt kê rời rạc):
- Cấu trúc xu hướng: tương quan giá–MA20–MA50, độ dốc, khoảng cách %.
- Động lượng: MACD histogram đang mở rộng hay co lại + RSI + phân kỳ (nếu có) → đà thật sự đang mạnh lên hay yếu đi?
- Biến động & vị thế: vị trí trong dải Bollinger, độ rộng dải (squeeze hay đang giãn), ATR cho biết biên dao động kỳ vọng.
- Dòng tiền: xu hướng khối lượng 5 phiên + spike phiên cuối → tiền vào hay ra, xác nhận hay phủ nhận giá.
Kết đoạn bằng 1 câu tổng hợp: các tín hiệu ĐỒNG THUẬN hay PHÂN KỲ với nhau?

### 3. Vùng giá then chốt
Bảng markdown 2 cột (Mức giá | Ý nghĩa & độ tin cậy). Dùng các swing high/low THẬT được cung cấp + MA + Bollinger. Xếp từ kháng cự xa nhất xuống hỗ trợ xa nhất, đánh dấu mức gần giá hiện tại nhất là "trọng yếu".

### 4. Kịch bản giao dịch
- **Kịch bản chính (xác suất ~X%)**: diễn biến nhiều khả năng nhất + lý do.
- **Kịch bản phụ (~Y%)**: phản đề.
- **Mức kích hoạt**: giá/điều kiện + volume xác nhận để mỗi kịch bản thành hiện thực.
- **Mức vô hiệu hoá (invalidation)**: phá mức nào thì kịch bản chính sai.
- **R:R ước tính**: dùng ATR/khoảng cách tới kháng cự–hỗ trợ gần nhất để ước lượng lời:lỗ (vd "tới kháng cự gần +3.2%, tới hỗ trợ gần -1.8% → R:R ~1.8:1").

### 5. Rủi ro cần theo dõi
2-3 gạch đầu dòng: điều gì có thể khiến phân tích sai, tín hiệu cảnh báo sớm cần canh ở phiên tới.

## Quy tắc số liệu
- Trích chính xác: "RSI14 = 67.3" không phải "RSI cao". "Volume 0.8x TB20" không phải "thanh khoản thấp".
- Mọi nhận định về mức giá phải kèm khoảng cách % so với giá hiện tại.
- Ước lượng xác suất kịch bản phải nhất quán với độ mạnh tín hiệu, không phải 50/50 cho an toàn.`;

  const swingTxt = (arr: { date: string; price: number }[]) =>
    arr.length ? arr.map((s) => `${s.price} (${s.date})`).join(", ") : "không rõ trong cửa sổ dữ liệu";

  const user = `Phân tích kỹ thuật mã **${ticker}** dựa trên dữ liệu sau:

## Chỉ số tổng hợp phiên ${f.date}
- Giá đóng: **${f.close}** | Δ1d: ${f.chg_1d?.toFixed(2)}% | Δ5d: ${f.chg_5d?.toFixed(2)}% | Δ20d: ${f.chg_20d?.toFixed(2)}%
- Chuỗi hiện tại: ${f.streak_len} phiên ${f.streak_dir} liên tiếp | 10 phiên gần nhất: ${f.up_sessions_10d} xanh / ${f.down_sessions_10d} đỏ
- Biên 20 phiên: cao ${f.high_20d} / thấp ${f.low_20d} → cách đỉnh ${f.dist_from_high20_pct?.toFixed(2)}%, cách đáy ${f.dist_from_low20_pct?.toFixed(2)}%
- MA20: ${f.ma20?.toFixed(2)} (giá ${f.price_vs_ma20_pct?.toFixed(2)}% so MA20) | MA50: ${f.ma50?.toFixed(2)} (giá ${f.price_vs_ma50_pct?.toFixed(2)}% so MA50) — ${f.ma20_vs_ma50}
- RSI14: **${f.rsi14?.toFixed(1)}** (${f.rsi_state})${f.rsi_divergence ? ` | ⚠️ ${f.rsi_divergence}` : ""}
- MACD: ${f.macd?.toFixed(3)} | signal: ${f.macd_signal?.toFixed(3)} | hist: ${f.macd_hist?.toFixed(3)} — ${f.macd_state}
- Bollinger: upper ${f.bb_upper?.toFixed(2)} / lower ${f.bb_lower?.toFixed(2)} | vị trí ${f.bb_position_pct?.toFixed(0)}% (0=dải dưới,100=dải trên) | độ rộng dải ${f.bb_width_pct?.toFixed(1)}% (hẹp<8% = squeeze)
- ATR14: ${f.atr14?.toFixed(3)} (${f.atr_pct?.toFixed(2)}% giá) → biên dao động kỳ vọng/phiên
- Khối lượng: phiên cuối ${f.volume_last?.toLocaleString()} = ${f.volume_spike_x?.toFixed(2)}x TB20 (${f.volume_avg20?.toLocaleString()}) | xu hướng vol 5 phiên: ${f.volume_trend_x?.toFixed(2)}x so 5 phiên trước (${(f.volume_trend_x ?? 1) > 1 ? "tăng dần" : "giảm dần"})

## Mức kỹ thuật thật (swing fractal)
- Kháng cự (swing high trên giá): ${swingTxt(f.swing_resistances)}
- Hỗ trợ (swing low dưới giá): ${swingTxt(f.swing_supports)}

## OHLCV 10 phiên cuối
${last10.map((r) => `${r.d}: O=${r.o} H=${r.h} L=${r.l} C=${r.c} V=${r.v?.toLocaleString()} (${r.ret}%)`).join("\n")}

Phân tích theo đúng 5 mục ở system prompt. Tập trung vào cấu hình RIÊNG của mã này, chốt kết luận actionable ở mục 4.`;

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
