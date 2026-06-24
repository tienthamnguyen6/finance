"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  ticker: string;
  trade_date: string;
  close: number;
  chg_1d: number | null;
  chg_5d: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma50: number | null;
  bb_pos: number | null;
  volume: number | null;
  vol_spike: number | null;
  rsi_oversold: boolean;
  rsi_overbought: boolean;
  macd_golden_cross: boolean;
  macd_death_cross: boolean;
  price_above_ma20: boolean;
  price_above_ma50: boolean;
  ma20_above_ma50: boolean;
  bb_squeeze_break_up: boolean;
  bb_break_down: boolean;
  high_volume: boolean;
};

type FilterKey =
  | "rsi_oversold"
  | "rsi_overbought"
  | "macd_golden_cross"
  | "macd_death_cross"
  | "price_above_ma20"
  | "price_above_ma50"
  | "ma20_above_ma50"
  | "bb_squeeze_break_up"
  | "bb_break_down"
  | "high_volume";

const FILTERS: { key: FilterKey; label: string; desc: string }[] = [
  { key: "rsi_oversold", label: "RSI quá bán (≤30)", desc: "Khả năng hồi kỹ thuật" },
  { key: "rsi_overbought", label: "RSI quá mua (≥70)", desc: "Áp lực chốt lời" },
  { key: "macd_golden_cross", label: "MACD cắt lên", desc: "Tín hiệu mua kỹ thuật" },
  { key: "macd_death_cross", label: "MACD cắt xuống", desc: "Tín hiệu bán kỹ thuật" },
  { key: "ma20_above_ma50", label: "MA20 > MA50", desc: "Đà tăng trung hạn" },
  { key: "price_above_ma20", label: "Giá > MA20", desc: "Đà tăng ngắn hạn" },
  { key: "price_above_ma50", label: "Giá > MA50", desc: "Trên đường xu hướng trung hạn" },
  { key: "bb_squeeze_break_up", label: "Break Bollinger trên", desc: "Đột phá tăng" },
  { key: "bb_break_down", label: "Break Bollinger dưới", desc: "Đột phá giảm" },
  { key: "high_volume", label: "Volume cao (≥1.8x TB)", desc: "Dòng tiền chú ý" },
];

type SortKey = "ticker" | "chg_1d" | "chg_5d" | "rsi14" | "vol_spike" | "bb_pos";

export default function ScreenPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Set<FilterKey>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("chg_1d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    fetch("/api/screen")
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const passes = (r: Row) => {
      for (const k of active) if (!r[k]) return false;
      return true;
    };
    const out = rows.filter(passes);
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return out;
  }, [rows, active, sortKey, sortDir]);

  function toggle(k: FilterKey) {
    const s = new Set(active);
    s.has(k) ? s.delete(k) : s.add(k);
    setActive(s);
  }

  function clickSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const SortHeader = ({ k, label, align = "right" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <th
      onClick={() => clickSort(k)}
      className={`px-2 py-2 cursor-pointer select-none hover:text-white ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label}
      {sortKey === k && <span className="ml-1 text-gray-500">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <div className="min-h-screen p-3 md:p-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Screener — VN30</h1>
          <p className="text-sm text-gray-400">Lọc mã theo tín hiệu kỹ thuật.</p>
        </div>
        <Link href="/" className="text-sm text-blue-400 hover:underline">
          ← Dashboard
        </Link>
      </header>

      <section className="bg-panel border border-border rounded-lg p-3">
        <div className="text-xs text-gray-400 mb-2">Bộ lọc (AND — phải thoả tất cả tín hiệu được chọn)</div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const on = active.has(f.key);
            return (
              <button
                key={f.key}
                onClick={() => toggle(f.key)}
                title={f.desc}
                className={`px-3 py-1.5 text-xs rounded border transition ${
                  on
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-transparent border-border text-gray-300 hover:bg-white/5"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          {active.size > 0 && (
            <button
              onClick={() => setActive(new Set())}
              className="px-3 py-1.5 text-xs rounded text-gray-400 hover:text-white"
            >
              Xoá filter
            </button>
          )}
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="p-8 text-gray-500 text-sm">Đang tải…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400 border-b border-border">
              <tr>
                <SortHeader k="ticker" label="Mã" align="left" />
                <SortHeader k="chg_1d" label="Δ1d %" />
                <SortHeader k="chg_5d" label="Δ5d %" />
                <th className="px-2 py-2 text-right">Giá</th>
                <SortHeader k="rsi14" label="RSI14" />
                <th className="px-2 py-2 text-right">MA20/50</th>
                <SortHeader k="bb_pos" label="BB %" />
                <SortHeader k="vol_spike" label="Vol×" />
                <th className="px-2 py-2 text-left">Tín hiệu</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticker} className="border-b border-border/50 hover:bg-white/5">
                  <td className="px-2 py-2 font-mono font-semibold">
                    <Link href={`/?t=${r.ticker}`} className="text-blue-400 hover:underline">
                      {r.ticker}
                    </Link>
                  </td>
                  <td className={`px-2 py-2 text-right ${(r.chg_1d ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                    {r.chg_1d?.toFixed(2) ?? "—"}
                  </td>
                  <td className={`px-2 py-2 text-right ${(r.chg_5d ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                    {r.chg_5d?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-right">{r.close.toLocaleString()}</td>
                  <td
                    className={`px-2 py-2 text-right ${
                      r.rsi_overbought ? "text-down" : r.rsi_oversold ? "text-up" : ""
                    }`}
                  >
                    {r.rsi14?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-gray-400">
                    {r.ma20?.toFixed(1)} / {r.ma50?.toFixed(1)}
                  </td>
                  <td className="px-2 py-2 text-right">{r.bb_pos?.toFixed(0) ?? "—"}</td>
                  <td className={`px-2 py-2 text-right ${r.high_volume ? "text-up font-semibold" : ""}`}>
                    {r.vol_spike?.toFixed(2) ?? "—"}
                  </td>
                  <td className="px-2 py-2 text-left">
                    <div className="flex gap-1 flex-wrap">
                      {r.macd_golden_cross && <Tag color="green">MACD↑</Tag>}
                      {r.macd_death_cross && <Tag color="red">MACD↓</Tag>}
                      {r.bb_squeeze_break_up && <Tag color="green">BB↑</Tag>}
                      {r.bb_break_down && <Tag color="red">BB↓</Tag>}
                      {r.rsi_oversold && <Tag color="green">Oversold</Tag>}
                      {r.rsi_overbought && <Tag color="red">Overbought</Tag>}
                      {r.high_volume && <Tag color="blue">Vol×{r.vol_spike?.toFixed(1)}</Tag>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-gray-500">
                    Không có mã nào thoả điều kiện.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Tag({ color, children }: { color: "green" | "red" | "blue"; children: React.ReactNode }) {
  const c =
    color === "green"
      ? "bg-green-500/15 text-green-400 border-green-500/30"
      : color === "red"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return <span className={`px-1.5 py-0.5 text-[10px] rounded border ${c}`}>{children}</span>;
}
