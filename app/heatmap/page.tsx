"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SnapshotRow = {
  ticker: string;
  trade_date: string;
  close_price: number;
  daily_return: number | null;
  volume: number | null;
  spark: number[];
};

type Metric = "chg_1d" | "chg_5d" | "chg_20d" | "vol_spike";

const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: "chg_1d", label: "Δ 1 phiên", unit: "%" },
  { key: "chg_5d", label: "Δ 5 phiên", unit: "%" },
  { key: "chg_20d", label: "Δ 20 phiên", unit: "%" },
  { key: "vol_spike", label: "Vol vs TB20", unit: "x" },
];

// Map value → màu nền. Đối xứng quanh 0 cho chg, từ 1 cho vol_spike.
function cellColor(v: number | null, metric: Metric): string {
  if (v == null || Number.isNaN(v)) return "#1f2937";
  if (metric === "vol_spike") {
    // 1x = neutral, >2x = đậm xanh (high volume)
    const norm = Math.max(0, Math.min(1, (v - 1) / 2));
    const alpha = 0.15 + norm * 0.7;
    return `rgba(59, 130, 246, ${alpha})`; // blue
  }
  // chg: âm = đỏ, dương = xanh.
  const cap = metric === "chg_20d" ? 15 : metric === "chg_5d" ? 8 : 4;
  const norm = Math.max(-1, Math.min(1, v / cap));
  const alpha = 0.15 + Math.abs(norm) * 0.7;
  return norm >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
}

function fmt(v: number | null, metric: Metric): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (metric === "vol_spike") return `${v.toFixed(2)}x`;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function HeatmapPage() {
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>("chg_1d");

  useEffect(() => {
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .finally(() => setLoading(false));
  }, []);

  const cells = useMemo(() => {
    const pct = (a: number, b: number) => (b !== 0 ? ((a - b) / b) * 100 : null);
    return rows
      .map((r) => {
        const sp = r.spark ?? [];
        const last = sp[sp.length - 1] ?? r.close_price;
        const wk = sp[Math.max(0, sp.length - 6)] ?? last;
        const mo = sp[0] ?? last;
        const avgVol20 = 0; // không có vol theo phiên từ snapshot — dùng tỷ lệ thay thế
        const chg_1d = r.daily_return != null ? r.daily_return * 100 : null;
        const chg_5d = pct(last, wk);
        const chg_20d = pct(last, mo);
        // Không có vol per-day cho 20 phiên ở snapshot → tạm để null, sẽ ẩn metric này nếu mọi value đều null.
        const vol_spike = null;
        const value: Record<Metric, number | null> = {
          chg_1d,
          chg_5d,
          chg_20d,
          vol_spike,
        };
        return { ticker: r.ticker, close: r.close_price, value };
      })
      .sort((a, b) => {
        const av = a.value[metric] ?? -Infinity;
        const bv = b.value[metric] ?? -Infinity;
        return bv - av;
      });
  }, [rows, metric]);

  return (
    <div className="min-h-screen p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Heatmap VN30</h1>
          <p className="text-sm text-gray-400">Bức tranh tổng thể rổ trong 1 nháy. Click vào ô để xem chi tiết.</p>
        </div>
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          ← Dashboard
        </Link>
      </header>

      <section className="bg-panel border border-border rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 mr-2">Theo chỉ số:</span>
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              disabled={m.key === "vol_spike"}
              title={m.key === "vol_spike" ? "Cần dữ liệu volume theo phiên (chưa sẵn trong snapshot)" : undefined}
              className={`px-3 py-1.5 rounded ${
                metric === m.key
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="text-center text-gray-500 p-12">Đang tải…</div>
      ) : (
        <section className="grid grid-cols-5 gap-2">
          {cells.map((c) => {
            const v = c.value[metric];
            const bg = cellColor(v, metric);
            return (
              <Link
                key={c.ticker}
                href={`/?t=${c.ticker}`}
                className="rounded-lg p-3 border border-border/50 hover:border-blue-500/50 transition aspect-square flex flex-col justify-between"
                style={{ background: bg }}
              >
                <div className="font-mono font-bold text-lg">{c.ticker}</div>
                <div className="text-right">
                  <div className="text-xl font-semibold">{fmt(v, metric)}</div>
                  <div className="text-[10px] text-gray-300/80 mt-1">
                    {c.close.toLocaleString()}
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      <div className="text-xs text-gray-500 flex items-center gap-4">
        <span>Chú thích:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.7)" }} /> giảm
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: "#1f2937" }} /> đi ngang
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: "rgba(34,197,94,0.7)" }} /> tăng
        </span>
      </div>
    </div>
  );
}
