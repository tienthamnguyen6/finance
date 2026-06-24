import { NextRequest } from "next/server";
import { GLM_MODEL_CHAT } from "@/lib/glm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClientMsg = { role: "user" | "assistant"; content: string };
type SearchResult = { title: string; link: string; content?: string; media?: string; publish_date?: string };

const SYS_BASE = `Bạn là trợ lý tài chính tiếng Việt, am hiểu thị trường chứng khoán Việt Nam (HOSE, HNX, UPCoM), kiến thức kinh tế vĩ mô, phân tích kỹ thuật và cơ bản.

Nguyên tắc:
- Trả lời ngắn gọn, có cấu trúc, dùng tiếng Việt.
- Khi giải thích khái niệm: cho ví dụ cụ thể nếu giúp dễ hiểu.
- KHÔNG khuyến nghị mua/bán dứt khoát. Nêu rủi ro.
- Định dạng markdown.
- TUYỆT ĐỐI KHÔNG bịa URL.`;

const SYS_WITH_SEARCH = `${SYS_BASE}

Khi trả lời, hãy ưu tiên dữ liệu trong "## Kết quả tìm kiếm web" được cung cấp. Trích con số/sự kiện trực tiếp từ đó. Khi nói đến số liệu, kèm reference [n] trỏ tới kết quả tương ứng. KHÔNG cần ghi lại danh sách URL — hệ thống sẽ tự append cuối câu trả lời.`;

// Gọi Tavily Search API — bao phủ nguồn tiếng Việt tốt (CafeF, Vietstock, VnExpress…).
async function callWebSearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("[tavily] missing TAVILY_API_KEY");
    return [];
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        // Mở rộng query song ngữ để bắt được cả nguồn VN lẫn EN.
        query: `${query} VN-Index VN30 Vietnam stock market`,
        search_depth: "advanced",
        max_results: 10,
        include_answer: false,
        // Loại trang data dashboard (cần JS render, không phải bài tin).
        exclude_domains: [
          "investing.com",
          "vn.investing.com",
          "tradingview.com",
          "vn.tradingview.com",
          "stockanalysis.com",
          "marketwatch.com",
        ],
      }),
    });
    if (!res.ok) {
      console.error("[tavily]", res.status, await res.text());
      return [];
    }
    const json = await res.json();
    const results = json?.results;
    if (!Array.isArray(results)) {
      console.error("[tavily] bất ngờ:", JSON.stringify(json).slice(0, 500));
      return [];
    }
    const hostname = (u: string) => {
      try {
        return new URL(u).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    };
    // Dedupe theo domain — không lấy >2 bài cùng 1 trang để nguồn đa dạng.
    const perDomain = new Map<string, number>();
    const out: SearchResult[] = [];
    for (const r of results as any[]) {
      const dom = hostname(r.url);
      const count = perDomain.get(dom) ?? 0;
      if (count >= 2) continue;
      perDomain.set(dom, count + 1);
      out.push({
        title: r.title || dom || r.url,
        link: r.url,
        content: r.content,
        media: dom,
        publish_date: r.published_date,
      });
    }
    console.log(`[tavily] query="${query}" → ${out.length} results (${perDomain.size} domains)`);
    return out;
  } catch (e) {
    console.error("[tavily] exception", e);
    return [];
  }
}

// POST /api/chat  body: { messages: [{role, content}, ...], search?: boolean }
export async function POST(req: NextRequest) {
  let messages: ClientMsg[] = [];
  let search = false;
  try {
    const body = await req.json();
    messages = body?.messages ?? [];
    search = !!body?.search;
  } catch {
    return new Response("invalid json body", { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("missing messages", { status: 400 });
  }

  const apiBase = process.env.GLM_API_BASE ?? "https://open.bigmodel.cn/api/paas/v4";
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) return new Response("missing GLM_API_KEY", { status: 500 });

  const encoder = new TextEncoder();

  // Bước 1: nếu bật search, gọi tools/web-search-pro với câu user mới nhất.
  let searchResults: SearchResult[] = [];
  let searchAnnouncement = "";
  if (search) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (lastUser.trim()) {
      searchAnnouncement = "_🔍 Đang tìm kiếm web…_\n\n";
      searchResults = await callWebSearch(lastUser);
    }
  }

  // Bước 2: chuẩn bị messages cho chat completion.
  // Nếu có kết quả search, inject context message trước user.
  const sysContent = searchResults.length > 0 ? SYS_WITH_SEARCH : SYS_BASE;
  const finalMessages: ClientMsg[] = [];
  if (searchResults.length > 0) {
    const ctx = searchResults
      .slice(0, 8)
      .map(
        (r, i) =>
          `[${i + 1}] **${r.title}** (${r.media || "?"}${r.publish_date ? `, ${r.publish_date}` : ""})\n${r.content ?? ""}`,
      )
      .join("\n\n");
    finalMessages.push({
      role: "user",
      content: `## Kết quả tìm kiếm web (sử dụng để trả lời câu hỏi bên dưới)\n\n${ctx}\n\n---\nDựa trên kết quả trên, trả lời câu hỏi sau:`,
    });
  }
  for (const m of messages) finalMessages.push(m);

  // Bước 3: stream chat completion.
  const upstream = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GLM_MODEL_CHAT,
      stream: true,
      temperature: 0.4,
      messages: [{ role: "system", content: sysContent }, ...finalMessages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text();
    return new Response(`upstream ${upstream.status}: ${errText}`, { status: 502 });
  }

  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const readable = new ReadableStream({
    async start(controller) {
      let buf = "";
      try {
        if (searchAnnouncement) controller.enqueue(encoder.encode(searchAnnouncement));

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {
                // bỏ qua dòng meta không parse được
              }
            }
          }
        }

        // Append nguồn cuối stream (đã lấy structured từ web-search-pro → URL đảm bảo thật).
        if (searchResults.length > 0) {
          const refs = searchResults
            .slice(0, 8)
            .map((r, i) => `${i + 1}. [${r.title}](${r.link})${r.media ? ` — *${r.media}*` : ""}`)
            .join("\n");
          controller.enqueue(encoder.encode(`\n\n---\n**📎 Nguồn tham khảo:**\n${refs}\n`));
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(`\n\n[Lỗi stream] ${e?.message ?? e}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
