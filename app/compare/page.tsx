"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

type Row = { trade_date: string; close_price: number };

// 8 màu HSL phân biệt cao.
const COLORS = [
  "#60a5fa",
  "#f59e0b",
  "#a855f7",
  "#22c55e",
  "#ef4444",
  "#06b6d4",
  "#f472b6",
  "#84cc16",
];

const MAX_PICKS = 8;

export default function ComparePage() {
  const [allTickers, setAllTickers] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [series, setSeries] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(false);

  // Lấy danh sách mã từ snapshot.
  useEffect(() => {
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d) => {
        const list = ((d.rows ?? []) as { ticker: string }[]).map((r) => r.ticker).sort();
        setAllTickers(list);
      });
  }, []);

  // Fetch khi danh sách hoặc days đổi.
  useEffect(() => {
    if (picked.length === 0) {
      setSeries({});
      return;
    }
    setLoading(true);
    Promise.all(
      picked.map((t) =>
        fetch(`/api/prices?ticker=${t}&days=${days}`)
          .then((r) => r.json())
          .then((d) => [t, (d.rows ?? []) as Row[]] as const),
      ),
    )
      .then((results) => {
        const next: Record<string, Row[]> = {};
        for (const [t, rows] of results) next[t] = rows;
        setSeries(next);
      })
      .finally(() => setLoading(false));
  }, [picked.join(","), days]);

  // Merge thành 1 dataset rebased về 100 (chỉ số tương đối).
  const merged = useMemo(() => {
    if (picked.length === 0) return [];
    // Union ngày từ tất cả series.
    const dateSet = new Set<string>();
    for (const t of picked) {
      const rows = series[t] ?? [];
      for (const r of rows) dateSet.add(r.trade_date);
    }
    const dates = Array.from(dateSet).sort();

    // Base value = close phiên đầu tiên có data của ticker đó.
    const base: Record<string, number> = {};
    for (const t of picked) {
      const first = (series[t] ?? [])[0];
      if (first) base[t] = first.close_price;
    }

    return dates.map((d) => {
      const point: Record<string, any> = { trade_date: d };
      for (const t of picked) {
        const row = (series[t] ?? []).find((r) => r.trade_date === d);
        if (row && base[t]) point[t] = (row.close_price / base[t]) * 100;
      }
      return point;
    });
  }, [picked.join(","), series]);

  function toggle(t: string) {
    setPicked((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, t];
    });
  }

  return (
    <div className="min-h-screen p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">So sánh hiệu suất</h1>
          <p className="text-sm text-gray-400">
            Chọn tối đa {MAX_PICKS} mã. Tất cả giá được rebase về 100 ở phiên đầu để so độ tăng tương đối.
          </p>
        </div>
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          ← Dashboard
        </Link>
      </header>

      <section className="bg-panel border border-border rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400">Số phiên:</span>
          {[30, 60, 90, 180, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 rounded text-xs ${
                days === d ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5"
              }`}
            >
              {d}d
            </button>
          ))}
          {picked.length > 0 && (
            <button
              onClick={() => setPicked([])}
              className="ml-auto px-2 py-1 text-xs text-gray-400 hover:text-white"
            >
              Bỏ chọn tất cả
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allTickers.map((t) => {
            const on = picked.includes(t);
            const idx = picked.indexOf(t);
            const c = on ? COLORS[idx % COLORS.length] : undefined;
            return (
              <button
                key={t}
                onClick={() => toggle(t)}
                style={on ? { background: c, borderColor: c, color: "white" } : undefined}
                className={`px-2.5 py-1 text-xs font-mono rounded border ${
                  on ? "" : "border-border text-gray-300 hover:bg-white/5"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4">
        {picked.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">Chọn ít nhất 1 mã để bắt đầu.</div>
        ) : loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Đang tải…</div>
        ) : (
          <div className="h-[480px]">
            <ResponsiveContainer>
              <LineChart data={merged} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="trade_date" stroke="#9ca3af" fontSize={11} />
                <YAxis stroke="#9ca3af" fontSize={11} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{
                    background: "#121826",
                    border: "1px solid #1f2937",
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: "#e5e7eb" }}
                  formatter={(v: number) => v?.toFixed(2)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {picked.map((t, i) => (
                  <Line
                    key={t}
                    type="monotone"
                    dataKey={t}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={1.6}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {picked.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Bảng tổng kết hiệu suất ({days} phiên)</h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400 border-b border-border">
              <tr>
                <th className="text-left px-2 py-2">Mã</th>
                <th className="text-right px-2 py-2">Giá đầu</th>
                <th className="text-right px-2 py-2">Giá cuối</th>
                <th className="text-right px-2 py-2">Tăng %</th>
                <th className="text-right px-2 py-2">Vol biên độ %</th>
              </tr>
            </thead>
            <tbody>
              {picked.map((t, i) => {
                const rows = series[t] ?? [];
                if (rows.length < 2) return null;
                const first = rows[0].close_price;
                const last = rows[rows.length - 1].close_price;
                const totalRet = ((last - first) / first) * 100;
                const high = Math.max(...rows.map((r) => r.close_price));
                const low = Math.min(...rows.map((r) => r.close_price));
                const range = ((high - low) / low) * 100;
                return (
                  <tr key={t} className="border-b border-border/50">
                    <td className="px-2 py-2 font-mono" style={{ color: COLORS[i % COLORS.length] }}>
                      {t}
                    </td>
                    <td className="px-2 py-2 text-right">{first.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right">{last.toLocaleString()}</td>
                    <td className={`px-2 py-2 text-right ${totalRet >= 0 ? "text-up" : "text-down"}`}>
                      {totalRet >= 0 ? "+" : ""}
                      {totalRet.toFixed(2)}%
                    </td>
                    <td className="px-2 py-2 text-right text-gray-400">{range.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
