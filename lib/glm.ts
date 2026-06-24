import OpenAI from "openai";

// GLM (Zhipu/z.ai) chuẩn OpenAI-compatible.
// Cấu hình qua env — đổi model/endpoint mà không sửa code.
// Mặc định: GLM-4.6 trên endpoint chính thức của Zhipu.
//   GLM_API_BASE   = https://open.bigmodel.cn/api/paas/v4
//   GLM_MODEL      = glm-4.6  (đổi sang glm-5.2 khi bạn có quyền truy cập)
//   GLM_API_KEY    = <key của bạn>
export const glm = new OpenAI({
  apiKey: process.env.GLM_API_KEY ?? "missing",
  baseURL: process.env.GLM_API_BASE ?? "https://open.bigmodel.cn/api/paas/v4",
});

export const GLM_MODEL = process.env.GLM_MODEL ?? "glm-4.6";
