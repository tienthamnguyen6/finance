import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { enrich, type PriceRow } from "@/lib/indicators";

export const dynamic = "force-dynamic";

// Buffer thêm để các chỉ báo dài hạn (MA50) không bị NaN ở đầu cửa sổ hiển thị.
const INDICATOR_WARMUP = 60;

// GET /api/prices?ticker=FPT&days=60&indicators=1
// Hoặc không có ticker → trả snapshot ngày gần nhất cho toàn bộ rổ.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker");
  const days = Math.min(Number(searchParams.get("days") ?? 60), 365);
  const withIndicators = searchParams.get("indicators") === "1";

  if (ticker) {
    const fetchLimit = withIndicators ? days + INDICATOR_WARMUP : days;
    // Lấy DESC để giới hạn về N phiên mới nhất, rồi đảo lại ASC cho chart.
    const { data, error } = await supabase
      .from("vn30_daily_prices")
      .select(
        "trade_date, open_price, high_price, low_price, close_price, volume, daily_return",
      )
      .eq("ticker", ticker.toUpperCase())
      .order("trade_date", { ascending: false })
      .limit(fetchLimit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const asc = ((data ?? []) as PriceRow[]).slice().reverse();
    if (!withIndicators) return NextResponse.json({ ticker, rows: asc });

    const enriched = enrich(asc);
    // Cắt bỏ phần warmup, chỉ trả về `days` phiên cuối.
    const rows = enriched.slice(-days);
    return NextResponse.json({ ticker, rows });
  }

  // Snapshot: ngày mới nhất + sparkline 20 phiên + volume.
  const SPARK_LEN = 20;
  const { data, error } = await supabase
    .from("vn30_daily_prices")
    .select("ticker, trade_date, close_price, daily_return, volume")
    .order("trade_date", { ascending: false })
    .limit(30 * SPARK_LEN + 50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Raw = { ticker: string; trade_date: string; close_price: number; daily_return: number | null; volume: number | null };
  const grouped = new Map<string, Raw[]>();
  for (const r of (data ?? []) as Raw[]) {
    const arr = grouped.get(r.ticker) ?? [];
    if (arr.length < SPARK_LEN) arr.push(r);
    grouped.set(r.ticker, arr);
  }

  const rows = Array.from(grouped.entries()).map(([ticker, recent]) => {
    // recent đang DESC (mới → cũ). Đảo lại để sparkline đúng chiều thời gian.
    const asc = recent.slice().reverse();
    const last = asc[asc.length - 1];
    return {
      ticker,
      trade_date: last.trade_date,
      close_price: last.close_price,
      daily_return: last.daily_return,
      volume: last.volume,
      spark: asc.map((r) => r.close_price),
    };
  });

  return NextResponse.json({ rows });
}
