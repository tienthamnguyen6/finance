"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "finance-ai-chat";

export default function ChatBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState(true);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist conversation.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // Auto-scroll khi có chunk mới.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const newMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    // Placeholder cho assistant đang stream.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, search }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: `[Lỗi] ${err}` };
          return copy;
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: buf };
          return copy;
        });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", content: `[Lỗi] ${e?.message ?? e}` };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 shadow-lg flex items-center justify-center text-xl"
        title="Trợ lý tài chính"
      >
        💬
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[380px] h-[560px] bg-panel border border-border rounded-xl shadow-2xl flex flex-col">
      <header className="p-3 border-b border-border flex items-center gap-2">
        <div className="flex-1">
          <div className="font-semibold text-sm">Trợ lý tài chính</div>
          <div className="text-[10px] text-gray-500">GLM · {search ? "đã bật web search" : "kiến thức nội tại"}</div>
        </div>
        <button
          onClick={() => setSearch((s) => !s)}
          title="Bật/tắt web search"
          className={`text-xs px-2 py-1 rounded ${search ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-white/5"}`}
        >
          🌐
        </button>
        <button
          onClick={clear}
          title="Xoá hội thoại"
          className="text-xs px-2 py-1 rounded text-gray-400 hover:bg-white/5"
        >
          ↺
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs px-2 py-1 rounded text-gray-400 hover:bg-white/5"
        >
          ✕
        </button>
      </header>

      <div ref={bodyRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="text-gray-500 text-xs space-y-2">
            <p>Hỏi tôi về:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Khái niệm kỹ thuật (RSI, MACD, EPS, P/E…)</li>
              <li>Tin tức mới nhất về 1 mã (cần bật 🌐)</li>
              <li>Vĩ mô VN/thế giới (cần bật 🌐)</li>
              <li>Cách đọc chỉ số trên dashboard</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap leading-relaxed ${
              m.role === "user"
                ? "ml-6 p-2 rounded-lg bg-blue-600/20 border border-blue-600/30"
                : "mr-6 text-gray-200"
            }`}
          >
            {m.content || (loading && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-border">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={search ? "Hỏi gì đó (có web search)…" : "Hỏi kiến thức…"}
            rows={1}
            className="flex-1 bg-transparent border border-border rounded px-2 py-1.5 text-sm resize-none outline-none focus:border-blue-500"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "…" : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}
