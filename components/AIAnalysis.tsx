"use client";
import { useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";

export default function AIAnalysis({ ticker }: { ticker: string }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ hit: boolean; created?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run(force = false) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setErr(null);
    setText("");
    setCacheInfo(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, force }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        setErr(await res.text());
        return;
      }
      const hit = res.headers.get("X-Cache") === "HIT";
      setCacheInfo({ hit, created: res.headers.get("X-Cache-Created") ?? undefined });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setText((t) => t + decoder.decode(value, { stream: true }));
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-load (cache-first) khi đổi mã.
  useEffect(() => {
    if (!ticker) return;
    run(false);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  return (
    <div className="bg-panel border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-semibold">Phân tích AI — {ticker}</h3>
          {cacheInfo?.hit && (
            <span className="text-xs text-gray-500" title={cacheInfo.created}>
              · cache {cacheInfo.created ? new Date(cacheInfo.created).toLocaleString("vi-VN") : ""}
            </span>
          )}
        </div>
        <button
          onClick={() => run(true)}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Đang phân tích…" : "Phân tích lại"}
        </button>
      </div>
      {err && <div className="text-red-400 text-sm whitespace-pre-wrap">{err}</div>}
      {text && (
        <div className="text-sm">
          <Markdown>{text}</Markdown>
        </div>
      )}
      {!text && !err && !loading && (
        <div className="text-gray-500 text-sm">Chưa có phân tích cho mã này.</div>
      )}
    </div>
  );
}
