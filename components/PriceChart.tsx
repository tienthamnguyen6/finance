"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
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
};

function toTime(date: string): UTCTimestamp {
  // Lightweight Charts dùng UTC epoch (giây) hoặc 'YYYY-MM-DD'.
  return Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000) as UTCTimestamp;
}

export default function PriceChart({ rows }: { rows: Row[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle?: ISeriesApi<"Candlestick">;
    volume?: ISeriesApi<"Histogram">;
    ma20?: ISeriesApi<"Line">;
    ma50?: ISeriesApi<"Line">;
    bbUpper?: ISeriesApi<"Line">;
    bbLower?: ISeriesApi<"Line">;
  }>({});

  // Tạo chart 1 lần.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1f2937" },
      timeScale: { borderColor: "#1f2937", timeVisible: false },
      autoSize: true,
    });

    const candle = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.3 } });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "#3b82f6",
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    const ma20 = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const ma50 = chart.addLineSeries({ color: "#a855f7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbUpper = chart.addLineSeries({ color: "#64748b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bbLower = chart.addLineSeries({ color: "#64748b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    chartRef.current = chart;
    seriesRef.current = { candle, volume, ma20, ma50, bbUpper, bbLower };

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
    };
  }, []);

  // Cập nhật dữ liệu mỗi khi rows đổi.
  useEffect(() => {
    const s = seriesRef.current;
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
        return {
          time: toTime(r.trade_date),
          value: r.volume as number,
          color: up ? "rgba(22,163,74,0.5)" : "rgba(220,38,38,0.5)",
        };
      });

    const lineData = (key: "ma20" | "ma50" | "bb_upper" | "bb_lower") =>
      rows
        .filter((r) => r[key] != null)
        .map((r) => ({ time: toTime(r.trade_date), value: r[key] as number }));

    s.candle.setData(candles);
    s.volume?.setData(volumes);
    s.ma20?.setData(lineData("ma20"));
    s.ma50?.setData(lineData("ma50"));
    s.bbUpper?.setData(lineData("bb_upper"));
    s.bbLower?.setData(lineData("bb_lower"));

    chartRef.current?.timeScale().fitContent();
  }, [rows]);

  if (!rows.length) {
    return <div className="text-gray-400 text-sm p-8 text-center">Chưa có dữ liệu</div>;
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="h-80 w-full" />
      <div className="flex gap-4 text-xs text-gray-400 px-2">
        <span><span className="inline-block w-3 h-0.5 align-middle bg-[#f59e0b] mr-1" />MA20</span>
        <span><span className="inline-block w-3 h-0.5 align-middle bg-[#a855f7] mr-1" />MA50</span>
        <span><span className="inline-block w-3 h-0.5 align-middle bg-[#64748b] mr-1" />Bollinger ±2σ</span>
        <span><span className="inline-block w-3 h-2 align-middle bg-blue-500/50 mr-1" />Volume</span>
      </div>
    </div>
  );
}
