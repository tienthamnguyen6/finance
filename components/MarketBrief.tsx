"use client";
import { useEffect, useState } from "react";
import Markdown from "./Markdown";

type Brief = { trade_date: string; content: string; model: string; created_at: string };

export default function MarketBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/brief")
      .then((r) => r.json())
      .then((d) => setBrief(d.brief ?? null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="bg-panel border border-border rounded-lg p-4 text-sm text-gray-500">
        Đang tải bản tin VN30…
      </section>
    );
  }
  if (!brief) {
    return (
      <section className="bg-panel border border-border rounded-lg p-4 text-sm text-gray-500">
        Chưa có bản tin AI — sẽ xuất hiện sau khi cron daily chạy lần đầu.
      </section>
    );
  }

  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <header className="flex items-baseline justify-between mb-2">
        <div>
          <h3 className="font-semibold">📰 Bản tin VN30 — {brief.trade_date}</h3>
          <p className="text-xs text-gray-500">
            Sinh bởi {brief.model} · {new Date(brief.created_at).toLocaleString("vi-VN")}
          </p>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs text-gray-400 hover:text-white"
        >
          {collapsed ? "Mở rộng ↓" : "Thu gọn ↑"}
        </button>
      </header>
      {!collapsed && (
        <div className="text-sm">
          <Markdown>{brief.content}</Markdown>
        </div>
      )}
    </section>
  );
}
