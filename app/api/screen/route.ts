import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { enrich, type PriceRow } from "@/lib/indicators";

export const dynamic = "force-dynamic";

// Per-ticker snapshot dùng cho screener.
type Snap = {
  ticker: string;
  trade_date: string;
  close: number;
  chg_1d: number | null;
  chg_5d: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma50: number | null;
  macd: number | null;
  macd_signal: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  bb_pos: number | null; // 0=chạm dưới, 100=chạm trên
  volume: number | null;
  vol_spike: number | null; // hệ số so với MA20 volume
  // Tín hiệu boolean tính sẵn để filter nhanh.
  rsi_oversold: boolean;
  rsi_overbought: boolean;
  macd_golden_cross: boolean; // hôm nay macd > signal, hôm qua macd <= signal
  macd_death_cross: boolean;
  price_above_ma20: boolean;
  price_above_ma50: boolean;
  ma20_above_ma50: boolean;
  bb_squeeze_break_up: boolean; // hôm nay close > bb_upper
  bb_break_down: boolean;
  high_volume: boolean; // vol_spike >= 1.8
};

async function buildSnapshot(ticker: string): Promise<Snap | null> {
  const { data } = await supabase
    .from("vn30_daily_prices")
    .select("trade_date, open_price, high_price, low_price, close_price, volume, daily_return")
    .eq("ticker", ticker)
    .order("trade_date", { ascending: false })
    .limit(80);
  if (!data?.length) return null;

  const asc = (data as PriceRow[]).slice().reverse();
  const e = enrich(asc);
  const n = e.length;
  const last = e[n - 1];
  const prev = e[n - 2];
  const wkAgo = e[Math.max(0, n - 6)];
  const pct = (a?: number | null, b?: number | null) =>
    a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null;

  const vols20 = e.slice(-20).map((r) => r.volume ?? 0);
  const avgVol = vols20.reduce((s, v) => s + v, 0) / Math.max(1, vols20.length);
  const volSpike = last.volume != null && avgVol > 0 ? last.volume / avgVol : null;

  const bbPos =
    last.bb_upper != null && last.bb_lower != null && last.bb_upper !== last.bb_lower
      ? ((last.close_price - last.bb_lower) / (last.bb_upper - last.bb_lower)) * 100
      : null;

  const macdToday = last.macd != null && last.macd_signal != null ? last.macd - last.macd_signal : null;
  const macdPrev = prev?.macd != null && prev?.macd_signal != null ? prev.macd - prev.macd_signal : null;

  return {
    ticker,
    trade_date: last.trade_date,
    close: last.close_price,
    chg_1d: pct(last.close_price, prev?.close_price),
    chg_5d: pct(last.close_price, wkAgo?.close_price),
    rsi14: last.rsi14,
    ma20: last.ma20,
    ma50: last.ma50,
    macd: last.macd,
    macd_signal: last.macd_signal,
    bb_upper: last.bb_upper,
    bb_lower: last.bb_lower,
    bb_pos: bbPos,
    volume: last.volume,
    vol_spike: volSpike,
    rsi_oversold: (last.rsi14 ?? 100) <= 30,
    rsi_overbought: (last.rsi14 ?? 0) >= 70,
    macd_golden_cross: macdToday != null && macdPrev != null && macdToday > 0 && macdPrev <= 0,
    macd_death_cross: macdToday != null && macdPrev != null && macdToday < 0 && macdPrev >= 0,
    price_above_ma20: last.ma20 != null && last.close_price > last.ma20,
    price_above_ma50: last.ma50 != null && last.close_price > last.ma50,
    ma20_above_ma50: last.ma20 != null && last.ma50 != null && last.ma20 > last.ma50,
    bb_squeeze_break_up: last.bb_upper != null && last.close_price > last.bb_upper,
    bb_break_down: last.bb_lower != null && last.close_price < last.bb_lower,
    high_volume: (volSpike ?? 0) >= 1.8,
  };
}

// GET /api/screen — trả snapshot toàn rổ VN30 (đã tính chỉ báo + tín hiệu).
export async function GET(_req: NextRequest) {
  // Lấy danh sách ticker hiện có trong DB.
  const { data: tList, error } = await supabase
    .from("vn30_daily_prices")
    .select("ticker")
    .order("ticker")
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = Array.from(new Set((tList ?? []).map((r) => r.ticker as string)));

  // Chạy song song — Supabase free tier OK với ~30 concurrent.
  const snaps = await Promise.all(tickers.map(buildSnapshot));
  const rows = snaps.filter((s): s is Snap => s != null);
  return NextResponse.json({ rows });
}
