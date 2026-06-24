import { NextRequest } from "next/server";
import { glm, GLM_MODEL } from "@/lib/glm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ClientMsg = { role: "user" | "assistant"; content: string };

const SYS = `Bạn là trợ lý tài chính tiếng Việt, am hiểu thị trường chứng khoán Việt Nam (HOSE, HNX, UPCoM), kiến thức kinh tế vĩ mô, phân tích kỹ thuật và cơ bản.

Nguyên tắc:
- Trả lời ngắn gọn, có cấu trúc, dùng tiếng Việt.
- Khi giải thích khái niệm: cho ví dụ cụ thể nếu giúp dễ hiểu.
- Khi user hỏi về SỐ LIỆU/TIN TỨC THỜI SỰ (giá hôm nay, sự kiện mới, kết quả kinh doanh quý gần nhất...): hãy DÙNG WEB SEARCH để lấy thông tin mới nhất. Trích nguồn.
- Khi user hỏi về KIẾN THỨC TỔNG QUÁT (RSI là gì, P/E hoạt động ra sao...): trả lời từ kiến thức, không cần search.
- KHÔNG khuyến nghị mua/bán dứt khoát. Nêu rủi ro.
- Định dạng markdown.`;

// POST /api/chat  body: { messages: [{role, content}, ...], search?: boolean }
export async function POST(req: NextRequest) {
  const { messages, search } = (await req.json()) as { messages: ClientMsg[]; search?: boolean };
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("missing messages", { status: 400 });
  }

  const tools = search
    ? [
        {
          type: "web_search",
          web_search: {
            enable: "True",
            search_engine: "search-prime",
            search_result: "True",
            count: "8",
            content_size: "high",
          },
        },
      ]
    : undefined;

  const stream = await glm.chat.completions.create({
    model: GLM_MODEL,
    stream: true,
    temperature: 0.5,
    messages: [{ role: "system", content: SYS }, ...messages],
    // GLM-specific tools: Zhipu chấp nhận type "web_search" như built-in tool, không phải function calling.
    // @ts-ignore openai client không biết schema này nhưng request body passthrough.
    tools,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(`\n\n[Lỗi LLM] ${e?.message ?? e}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
