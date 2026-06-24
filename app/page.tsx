"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PriceChart from "@/components/PriceChart";
import AIAnalysis from "@/components/AIAnalysis";

type SnapshotRow = { ticker: string; trade_date: string; close_price: number; daily_return: number | null };
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

  useEffect(() => {
    fetch("/api/prices")
      .then((r) => r.json())
      .then((d) => {
        const rows: SnapshotRow[] = d.rows ?? [];
        rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
        setSnapshot(rows);
        if (!active && rows[0]) setActive(rows[0].ticker);
      });
  }, []);

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
      <aside className="w-56 border-r border-border bg-panel overflow-y-auto">
        <div className="p-3 border-b border-border">
          <h1 className="font-bold text-lg">Finance AI</h1>
          <p className="text-xs text-gray-400">VN30 · GLM-powered</p>
          <Link
            href="/screen"
            className="mt-2 inline-block text-xs text-blue-400 hover:underline"
          >
            🔍 Screener →
          </Link>
        </div>
        <ul>
          {snapshot.map((r) => {
            const up = (r.daily_return ?? 0) >= 0;
            return (
              <li key={r.ticker}>
                <button
                  onClick={() => setActive(r.ticker)}
                  className={`w-full flex justify-between items-center px-3 py-2 text-sm hover:bg-white/5 ${
                    active === r.ticker ? "bg-white/10" : ""
                  }`}
                >
                  <span className="font-mono">{r.ticker}</span>
                  <span className={up ? "text-up" : "text-down"}>
                    {r.close_price?.toLocaleString()}
                  </span>
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
