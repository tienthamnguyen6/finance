"use client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Style markdown đồng nhất cho AI Analysis và ChatBot.
const components: Components = {
  h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-white">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="text-lg font-bold mt-4 mb-2 text-white border-b border-border pb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold mt-3 mb-1.5 text-blue-300">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="font-semibold mt-2 mb-1 text-gray-200">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed text-gray-200">{children}</p>,
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 text-gray-200">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 text-gray-200">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-white/10 text-blue-300 text-[0.9em] font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded bg-black/30 border border-border overflow-x-auto text-xs">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3 border-l-2 border-blue-500/50 text-gray-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline hover:text-blue-300 break-all"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1 text-left text-xs text-gray-400 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 border-b border-border/50">{children}</td>,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
