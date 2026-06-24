"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import AIAnalysis from "@/components/AIAnalysis";
import Sparkline from "@/components/Sparkline";

type SnapshotRow = {
  ticker: string;
  trade_date: string;
  close_price: number;
  daily_return: number | null;
  volume: number | null;
  spark: number[];
};
type SortMode = "ticker" | "gainers" | "losers" | "volume";
type HistoryRow = {
  trade_date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number;
  volume: number | null;
  daily_return: number | null;
  ma20: number | null;
  ma50: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
};

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Đang tải…</div>}>
      <PageInner />
    </Suspense>
  );
}

function PageInner() {
  const searchParams = useSearchParams();
  const queryTicker = searchParams.get("t")?.toUpperCase() ?? null;
  const [snapshot, setSnapshot] = useState<SnapshotRow[]>([]);
  const [active, setActive] = useState<string | null>(queryTicker);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("ticker");

  useEffect(() => {
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d) => {
        const rows: SnapshotRow[] = d.rows ?? [];
        setSnapshot(rows);
        if (!active && rows[0]) {
          rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
          setActive(rows[0].ticker);
        }
      });
  }, []);

  const sortedSnapshot = useMemo(() => {
    const arr = snapshot.slice();
    switch (sortMode) {
      case "gainers":
        arr.sort((a, b) => (b.daily_return ?? -1) - (a.daily_return ?? -1));
        break;
      case "losers":
        arr.sort((a, b) => (a.daily_return ?? 1) - (b.daily_return ?? 1));
        break;
      case "volume":
        arr.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        break;
      default:
        arr.sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    return arr;
  }, [snapshot, sortMode]);

  // Khi URL ?t= đổi (vd: từ Screener navigate sang), cập nhật active.
  useEffect(() => {
    if (queryTicker) setActive(queryTicker);
  }, [queryTicker]);

  useEffect(() => {
    if (!active) return;
    setLoadingHist(true);
    fetch(`/api/prices?ticker=${active}&days=120&indicators=1`)
      .then((r) => r.json())
      .then((d) => setHistory(d.rows ?? []))
      .finally(() => setLoadingHist(false));
  }, [active]);

  const stats = useMemo(() => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    const chg = ((last.close_price - prev.close_price) / prev.close_price) * 100;
    const high = Math.max(...history.map((r) => r.close_price));
    const low = Math.min(...history.map((r) => r.close_price));
    return { last, chg, high, low };
  }, [history]);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-72 border-r border-border bg-panel overflow-y-auto flex flex-col">
        <div className="p-3 border-b border-border">
          <h1 className="font-bold text-lg">Finance AI</h1>
          <p className="text-xs text-gray-400">VN30 · GLM-powered</p>
          <div className="mt-2 flex gap-3 text-xs">
            <Link href="/screen" className="text-blue-400 hover:underline">
              🔍 Screener
            </Link>
            <Link href="/compare" className="text-blue-400 hover:underline">
              ⚖️ So sánh
            </Link>
          </div>
        </div>

        <div className="p-2 border-b border-border flex gap-1 text-[11px]">
          {(["ticker", "gainers", "losers", "volume"] as SortMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setSortMode(m)}
              className={`flex-1 px-2 py-1 rounded ${
                sortMode === m ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5"
              }`}
            >
              {m === "ticker" ? "A-Z" : m === "gainers" ? "Tăng" : m === "losers" ? "Giảm" : "Vol"}
            </button>
          ))}
        </div>

        <ul className="flex-1">
          {sortedSnapshot.map((r) => {
            const ret = r.daily_return ?? 0;
            const up = ret >= 0;
            return (
              <li key={r.ticker}>
                <button
                  onClick={() => setActive(r.ticker)}
                  className={`w-full grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2 text-sm hover:bg-white/5 ${
                    active === r.ticker ? "bg-white/10" : ""
                  }`}
                >
                  <div className="flex flex-col items-start min-w-0">
                    <span className="font-mono font-semibold">{r.ticker}</span>
                    <span className="text-[10px] text-gray-500">
                      {r.close_price?.toLocaleString()}
                    </span>
                  </div>
                  <Sparkline values={r.spark ?? []} positive={up} />
                  <div className={`text-right text-xs ${up ? "text-up" : "text-down"}`}>
                    {up ? "+" : ""}
                    {(ret * 100).toFixed(2)}%
                  </div>
                </button>
              </li>
            );
          })}
          {!snapshot.length && (
            <li className="text-gray-500 text-sm p-3">Đang tải hoặc DB rỗng…</li>
          )}
        </ul>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {active ? (
          <>
            <header className="flex items-baseline gap-4">
              <h2 className="text-2xl font-bold">{active}</h2>
              {stats && (
                <>
                  <span className="text-xl">{stats.last.close_price.toLocaleString()}</span>
                  <span className={stats.chg >= 0 ? "text-up" : "text-down"}>
                    {stats.chg >= 0 ? "▲" : "▼"} {stats.chg.toFixed(2)}%
                  </span>
                  <span className="text-sm text-gray-400">
                    Cao {stats.high.toLocaleString()} · Thấp {stats.low.toLocaleString()}
                  </span>
                </>
              )}
            </header>

            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="font-semibold mb-2">Nến + Volume — 120 phiên</h3>
              {loadingHist ? (
                <div className="text-gray-500 text-sm">Đang tải biểu đồ…</div>
              ) : (
                <PriceChart rows={history} />
              )}
            </section>

            <AIAnalysis ticker={active} />
          </>
        ) : (
          <div className="text-gray-500">Chọn một mã ở thanh bên để bắt đầu.</div>
        )}
      </main>
    </div>
  );
}
