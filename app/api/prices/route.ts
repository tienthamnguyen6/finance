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

  // Snapshot: ngày mới nhất cho mỗi mã.
  const { data, error } = await supabase
    .from("vn30_daily_prices")
    .select("ticker, trade_date, close_price, daily_return")
    .order("trade_date", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const latest = new Map<string, any>();
  for (const r of data ?? []) {
    if (!latest.has(r.ticker)) latest.set(r.ticker, r);
  }
  return NextResponse.json({ rows: Array.from(latest.values()) });
}
