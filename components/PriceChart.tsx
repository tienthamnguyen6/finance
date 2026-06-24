"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";

export type Row = {
  trade_date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number;
  volume: number | null;
  ma20?: number | null;
  ma50?: number | null;
  bb_upper?: number | null;
  bb_lower?: number | null;
  rsi14?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  macd_hist?: number | null;
};

type Toggles = { ma20: boolean; ma50: boolean; bb: boolean; sr: boolean };

function toTime(date: string): UTCTimestamp {
  return Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000) as UTCTimestamp;
}

// Swing fractal client-side để vẽ kháng cự/hỗ trợ — đồng bộ logic với AI analysis.
function findSR(rows: Row[], w = 3) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = w; i < rows.length - w; i++) {
    const h = rows[i].high_price ?? rows[i].close_price;
    const l = rows[i].low_price ?? rows[i].close_price;
    let isH = true;
    let isL = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if ((rows[j].high_price ?? rows[j].close_price) >= h) isH = false;
      if ((rows[j].low_price ?? rows[j].close_price) <= l) isL = false;
    }
    if (isH) highs.push(h);
    if (isL) lows.push(l);
  }
  const last = rows[rows.length - 1]?.close_price ?? 0;
  const resistances = [...new Set(highs.filter((h) => h > last))].sort((a, b) => a - b).slice(0, 2);
  const supports = [...new Set(lows.filter((l) => l < last))].sort((a, b) => b - a).slice(0, 2);
  return { resistances, supports };
}

const DAYS_OPTIONS = [60, 120, 250];

export default function PriceChart({
  rows,
  days,
  onDaysChange,
}: {
  rows: Row[];
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);

  const charts = useRef<{ main?: IChartApi; rsi?: IChartApi; macd?: IChartApi }>({});
  const series = useRef<{
    candle?: ISeriesApi<"Candlestick">;
    volume?: ISeriesApi<"Histogram">;
    ma20?: ISeriesApi<"Line">;
    ma50?: ISeriesApi<"Line">;
    bbU?: ISeriesApi<"Line">;
    bbL?: ISeriesApi<"Line">;
    rsi?: ISeriesApi<"Line">;
    macdLine?: ISeriesApi<"Line">;
    macdSignal?: ISeriesApi<"Line">;
    macdHist?: ISeriesApi<"Histogram">;
  }>({});
  const srLines = useRef<IPriceLine[]>([]);

  const [toggles, setToggles] = useState<Toggles>({ ma20: true, ma50: true, bb: true, sr: true });

  // Tạo 3 chart đồng bộ trục thời gian (1 lần).
  useEffect(() => {
    if (!mainRef.current || !rsiRef.current || !macdRef.current) return;

    const base = {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9ca3af", fontSize: 11 },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: { borderColor: "#1f2937", timeVisible: false },
      autoSize: true,
    };

    const main = createChart(mainRef.current, base);
    const rsi = createChart(rsiRef.current, { ...base, timeScale: { ...base.timeScale, visible: false } });
    const macd = createChart(macdRef.current, base);

    // --- Main: nến + volume + MA + Bollinger ---
    const candle = main.addCandlestickSeries({
      upColor: "#16a34a", downColor: "#dc2626",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
    const volume = main.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    const ma20 = main.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const ma50 = main.addLineSeries({ color: "#a855f7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbU = main.addLineSeries({ color: "#64748b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbL = main.addLineSeries({ color: "#64748b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    // --- RSI pane ---
    const rsiLine = rsi.addLineSeries({ color: "#22d3ee", lineWidth: 2, priceLineVisible: false });
    rsiLine.createPriceLine({ price: 70, color: "#dc2626", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsiLine.createPriceLine({ price: 30, color: "#16a34a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    // --- MACD pane ---
    const macdHist = macd.addHistogramSeries({ priceLineVisible: false });
    const macdLine = macd.addLineSeries({ color: "#60a5fa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const macdSignal = macd.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    charts.current = { main, rsi, macd };
    series.current = { candle, volume, ma20, ma50, bbU, bbL, rsi: rsiLine, macdLine, macdSignal, macdHist };

    // Sync trục thời gian giữa 3 chart.
    const all = [main, rsi, macd];
    let syncing = false;
    const subs = all.map((src) =>
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        for (const tgt of all) if (tgt !== src) tgt.timeScale().setVisibleLogicalRange(range);
        syncing = false;
      }),
    );

    return () => {
      all.forEach((c, i) => c.timeScale().unsubscribeVisibleLogicalRangeChange(subs[i]!));
      main.remove();
      rsi.remove();
      macd.remove();
      charts.current = {};
      series.current = {};
      srLines.current = [];
    };
  }, []);

  // Nạp dữ liệu mỗi khi rows đổi.
  useEffect(() => {
    const s = series.current;
    if (!s.candle || !rows.length) return;

    const candles = rows
      .filter((r) => r.open_price != null && r.high_price != null && r.low_price != null)
      .map((r) => ({
        time: toTime(r.trade_date),
        open: r.open_price as number,
        high: r.high_price as number,
        low: r.low_price as number,
        close: r.close_price,
      }));

    const volumes = rows
      .filter((r) => r.volume != null)
      .map((r) => {
        const up = (r.close_price ?? 0) >= (r.open_price ?? r.close_price);
        return { time: toTime(r.trade_date), value: r.volume as number, color: up ? "rgba(22,163,74,0.5)" : "rgba(220,38,38,0.5)" };
      });

    const line = (key: keyof Row) =>
      rows.filter((r) => r[key] != null).map((r) => ({ time: toTime(r.trade_date), value: r[key] as number }));

    s.candle.setData(candles);
    s.volume?.setData(volumes);
    s.ma20?.setData(line("ma20"));
    s.ma50?.setData(line("ma50"));
    s.bbU?.setData(line("bb_upper"));
    s.bbL?.setData(line("bb_lower"));
    s.rsi?.setData(line("rsi14"));
    s.macdLine?.setData(line("macd"));
    s.macdSignal?.setData(line("macd_signal"));
    s.macdHist?.setData(
      rows
        .filter((r) => r.macd_hist != null)
        .map((r) => {
          const v = r.macd_hist as number;
          return { time: toTime(r.trade_date), value: v, color: v >= 0 ? "rgba(22,163,74,0.6)" : "rgba(220,38,38,0.6)" };
        }),
    );

    charts.current.main?.timeScale().fitContent();
  }, [rows]);

  // Vẽ lại đường S/R + ẩn/hiện overlay khi toggles hoặc rows đổi.
  useEffect(() => {
    const s = series.current;
    if (!s.candle) return;
    s.ma20?.applyOptions({ visible: toggles.ma20 });
    s.ma50?.applyOptions({ visible: toggles.ma50 });
    s.bbU?.applyOptions({ visible: toggles.bb });
    s.bbL?.applyOptions({ visible: toggles.bb });

    // Xoá price line cũ.
    for (const pl of srLines.current) s.candle.removePriceLine(pl);
    srLines.current = [];
    if (toggles.sr && rows.length) {
      const { resistances, supports } = findSR(rows);
      for (const r of resistances)
        srLines.current.push(
          s.candle.createPriceLine({ price: r, color: "#dc2626", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "KC" }),
        );
      for (const sp of supports)
        srLines.current.push(
          s.candle.createPriceLine({ price: sp, color: "#16a34a", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "HT" }),
        );
    }
  }, [toggles, rows]);

  const last = rows[rows.length - 1];
  const legend = useMemo(() => {
    if (!last) return null;
    return { rsi: last.rsi14, macd: last.macd, signal: last.macd_signal, hist: last.macd_hist };
  }, [last]);

  if (!rows.length) {
    return <div className="text-gray-400 text-sm p-8 text-center">Chưa có dữ liệu</div>;
  }

  const chip = (on: boolean) =>
    `px-2 py-0.5 text-[11px] rounded border ${on ? "bg-blue-600 border-blue-500 text-white" : "border-border text-gray-400 hover:bg-white/5"}`;

  return (
    <div className="space-y-1">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <div className="flex gap-1">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              className={`px-2 py-0.5 text-[11px] rounded ${days === d ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5"}`}
            >
              {d}p
            </button>
          ))}
        </div>
        <span className="text-border">|</span>
        <button onClick={() => setToggles((t) => ({ ...t, ma20: !t.ma20 }))} className={chip(toggles.ma20)}>MA20</button>
        <button onClick={() => setToggles((t) => ({ ...t, ma50: !t.ma50 }))} className={chip(toggles.ma50)}>MA50</button>
        <button onClick={() => setToggles((t) => ({ ...t, bb: !t.bb }))} className={chip(toggles.bb)}>Bollinger</button>
        <button onClick={() => setToggles((t) => ({ ...t, sr: !t.sr }))} className={chip(toggles.sr)}>Kháng cự/Hỗ trợ</button>
      </div>

      {/* Main chart */}
      <div ref={mainRef} className="h-72 w-full" />

      {/* RSI pane */}
      <div className="relative">
        <span className="absolute left-2 top-1 z-10 text-[11px] text-cyan-300">
          RSI(14) {legend?.rsi != null ? legend.rsi.toFixed(1) : ""}
        </span>
        <div ref={rsiRef} className="h-24 w-full" />
      </div>

      {/* MACD pane */}
      <div className="relative">
        <span className="absolute left-2 top-1 z-10 text-[11px]">
          <span className="text-blue-400">MACD {legend?.macd != null ? legend.macd.toFixed(2) : ""}</span>{" "}
          <span className="text-amber-400">Signal {legend?.signal != null ? legend.signal.toFixed(2) : ""}</span>
        </span>
        <div ref={macdRef} className="h-28 w-full" />
      </div>

      {/* Chú thích */}
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-400 px-2 pt-1">
        <span><span className="inline-block w-3 h-0.5 align-middle bg-[#f59e0b] mr-1" />MA20</span>
        <span><span className="inline-block w-3 h-0.5 align-middle bg-[#a855f7] mr-1" />MA50</span>
        <span><span className="inline-block w-3 h-0.5 align-middle bg-[#64748b] mr-1" />Bollinger ±2σ</span>
        <span><span className="inline-block w-3 h-2 align-middle bg-blue-500/50 mr-1" />Volume</span>
        <span className="text-red-400">— — KC (kháng cự)</span>
        <span className="text-green-400">— — HT (hỗ trợ)</span>
      </div>
    </div>
  );
}
