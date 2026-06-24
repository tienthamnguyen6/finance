# Finance AI — VN30 Dashboard

Dashboard hiển thị giá VN30 (đọc từ Supabase do `main.py` ETL) + phân tích biến động bằng LLM (GLM, OpenAI-compatible).

## Cấu trúc

```
main.py                 # ETL: vnstock → Supabase (vn30_daily_prices)
app/                    # Next.js App Router
  page.tsx              # Dashboard
  api/prices/route.ts   # GET giá (snapshot hoặc history theo ticker)
  api/analyze/route.ts  # POST → stream phân tích AI
components/             # PriceChart, AIAnalysis
lib/                    # supabase, glm clients
```

## Chạy local

```bash
cp .env.example .env.local   # rồi điền key
npm install
npm run dev                  # http://localhost:3000
```

## Về model AI

Code dùng SDK `openai` trỏ tới endpoint GLM. Cấu hình qua env:

| Biến            | Mặc định                                        |
| --------------- | ----------------------------------------------- |
| `GLM_API_BASE`  | `https://open.bigmodel.cn/api/paas/v4` (Zhipu) |
| `GLM_MODEL`     | `glm-4.6`                                       |
| `GLM_API_KEY`   | —                                               |

Khi **GLM 5.2** được phát hành chính thức, chỉ cần đổi `GLM_MODEL=glm-5.2` (và `GLM_API_BASE` nếu nhà cung cấp đổi domain) — không cần sửa code.

## Lưu ý

- Bảng `vn30_daily_prices` hiện chỉ có `ticker / trade_date / close_price / daily_return`. Muốn vẽ nến (OHLC) + khối lượng cần bổ sung cột trong ETL (`open, high, low, volume`).
- Output AI là **bình luận tham khảo**, không phải khuyến nghị đầu tư.
