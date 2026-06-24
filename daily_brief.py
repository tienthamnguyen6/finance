"""
Sinh bản tin tổng quan rổ VN30 cho phiên giao dịch gần nhất.
Chạy SAU main.py trong cron daily.

Logic:
- Lấy ~80 phiên cho mỗi mã từ Supabase.
- Tính các chỉ báo Python-side (MA20, MA50, RSI14, MACD, volume spike).
- Build features tổng hợp: top gainers/losers, RSI quá mua/quá bán, MACD cross, volume bất thường.
- Gọi GLM tạo bản tin markdown (1 lần / phiên).
- Upsert vào market_briefs.
"""
import os
import sys
import pandas as pd
from datetime import datetime
from supabase import create_client
from openai import OpenAI


def load_dotenv(path: str = ".env.local") -> None:
    """Đọc .env.local an toàn (utf-8-sig để bỏ BOM, strip quote/space).
    Chỉ set biến chưa có trong môi trường → cho phép override từ CI/shell."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            # Cắt comment inline (chuẩn dotenv: ` #...`), trừ khi value nằm trong quote.
            if not (val.startswith('"') or val.startswith("'")):
                for sep in (" #", "\t#"):
                    idx = val.find(sep)
                    if idx != -1:
                        val = val[:idx]
            val = val.strip().strip('"').strip("'").strip()
            if key and key not in os.environ:
                os.environ[key] = val


load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
GLM_API_KEY = os.environ["GLM_API_KEY"]
GLM_API_BASE = os.environ.get("GLM_API_BASE", "https://open.bigmodel.cn/api/paas/v4")
GLM_MODEL = os.environ.get("GLM_MODEL", "glm-4.6")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
glm = OpenAI(api_key=GLM_API_KEY, base_url=GLM_API_BASE)


def fetch_prices(ticker: str, limit: int = 80) -> pd.DataFrame:
    res = sb.table("vn30_daily_prices") \
        .select("trade_date, open_price, high_price, low_price, close_price, volume, daily_return") \
        .eq("ticker", ticker) \
        .order("trade_date", desc=True) \
        .limit(limit) \
        .execute()
    df = pd.DataFrame(res.data or [])
    if df.empty:
        return df
    df = df.sort_values("trade_date").reset_index(drop=True)
    return df


def compute_features(df: pd.DataFrame) -> dict | None:
    if len(df) < 30:
        return None
    close = df["close_price"]
    vol = df["volume"].fillna(0)

    ma20 = close.rolling(20).mean().iloc[-1]
    ma50 = close.rolling(50).mean().iloc[-1] if len(df) >= 50 else None

    # RSI14 (Wilder smoothed)
    delta = close.diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)
    avg_gain = gain.ewm(alpha=1 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-9)
    rsi = (100 - 100 / (1 + rs)).iloc[-1]

    # MACD
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    macd_today = macd_line.iloc[-1] - signal_line.iloc[-1]
    macd_prev = macd_line.iloc[-2] - signal_line.iloc[-2] if len(macd_line) >= 2 else 0

    avg_vol20 = vol.tail(20).mean()
    vol_spike = (vol.iloc[-1] / avg_vol20) if avg_vol20 > 0 else None

    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else last
    chg_1d = float(last["daily_return"]) * 100 if pd.notna(last["daily_return"]) else 0.0

    return {
        "ticker": "",
        "date": last["trade_date"],
        "close": float(last["close_price"]),
        "chg_1d": chg_1d,
        "rsi14": float(rsi) if pd.notna(rsi) else None,
        "ma20_above_ma50": (ma20 > ma50) if (ma20 is not None and ma50 is not None) else None,
        "price_above_ma20": float(last["close_price"]) > ma20 if pd.notna(ma20) else None,
        "macd_golden_cross": macd_today > 0 and macd_prev <= 0,
        "macd_death_cross": macd_today < 0 and macd_prev >= 0,
        "vol_spike": float(vol_spike) if vol_spike else None,
        "volume": int(vol.iloc[-1]) if pd.notna(vol.iloc[-1]) else None,
    }


def get_tickers() -> list[str]:
    res = sb.table("vn30_daily_prices").select("ticker").execute()
    tickers = sorted({r["ticker"] for r in (res.data or [])})
    return tickers


def build_brief_prompt(features: list[dict]) -> tuple[str, str]:
    # Sắp xếp + chọn lọc.
    by_ret = sorted(features, key=lambda f: f["chg_1d"], reverse=True)
    top_gainers = by_ret[:5]
    top_losers = by_ret[-5:]

    macd_up = [f for f in features if f["macd_golden_cross"]]
    macd_down = [f for f in features if f["macd_death_cross"]]
    overbought = [f for f in features if f["rsi14"] and f["rsi14"] >= 70]
    oversold = [f for f in features if f["rsi14"] and f["rsi14"] <= 30]
    high_vol = sorted(
        [f for f in features if f["vol_spike"] and f["vol_spike"] >= 1.8],
        key=lambda f: f["vol_spike"], reverse=True,
    )[:5]

    avg_chg = sum(f["chg_1d"] for f in features) / max(1, len(features))
    up_count = sum(1 for f in features if f["chg_1d"] > 0)
    down_count = sum(1 for f in features if f["chg_1d"] < 0)
    bullish_ma = sum(1 for f in features if f["price_above_ma20"])

    trade_date = features[0]["date"] if features else "?"

    def fmt(arr, key="chg_1d"):
        return ", ".join(f"{f['ticker']} ({f[key]:+.2f}%)" for f in arr) or "—"

    def fmt_rsi(arr):
        return ", ".join(f"{f['ticker']} (RSI {f['rsi14']:.1f})" for f in arr) or "—"

    def fmt_vol(arr):
        return ", ".join(f"{f['ticker']} ({f['vol_spike']:.1f}x)" for f in arr) or "—"

    sys_prompt = """Bạn là chuyên gia phân tích thị trường chứng khoán Việt Nam, viết bản tin tổng quan rổ VN30 hàng ngày.

Nguyên tắc:
- Văn phong báo chí, chuyên nghiệp, súc tích.
- Cấu trúc cố định: 1) Tóm tắt phiên (1-2 câu) — 2) Dòng tiền & tâm lý — 3) Mã nổi bật — 4) Cảnh báo & cơ hội — 5) Triển vọng phiên tới.
- KHÔNG bịa tin tức/sự kiện ngoài dữ liệu.
- KHÔNG khuyến nghị mua/bán dứt khoát. Dùng từ "đáng chú ý", "rủi ro", "cần theo dõi".
- Tổng độ dài 250-400 từ. Format markdown.
"""

    user_prompt = f"""Viết bản tin VN30 cho phiên **{trade_date}** dựa trên dữ liệu sau:

## Toàn rổ
- Δ trung bình: {avg_chg:+.2f}%
- Phiên xanh/đỏ: {up_count}/{down_count} mã
- Số mã giá > MA20: {bullish_ma}/{len(features)}

## Top tăng giá
{fmt(top_gainers)}

## Top giảm giá
{fmt(top_losers)}

## Tín hiệu kỹ thuật
- MACD cắt LÊN signal (golden cross) phiên này: {", ".join(f["ticker"] for f in macd_up) or "—"}
- MACD cắt XUỐNG signal (death cross) phiên này: {", ".join(f["ticker"] for f in macd_down) or "—"}
- RSI quá mua (≥70): {fmt_rsi(overbought)}
- RSI quá bán (≤30): {fmt_rsi(oversold)}

## Khối lượng đột biến (≥1.8x TB20)
{fmt_vol(high_vol)}

Viết bản tin tuân thủ cấu trúc 5 phần đã yêu cầu."""

    return sys_prompt, user_prompt


def main():
    tickers = get_tickers()
    print(f"📋 Tổng hợp brief cho {len(tickers)} mã")

    features: list[dict] = []
    for t in tickers:
        df = fetch_prices(t)
        f = compute_features(df)
        if f:
            f["ticker"] = t
            features.append(f)
    if not features:
        print("⚠️  Không có features → bỏ qua brief.")
        return

    trade_date = max(f["date"] for f in features)
    features = [f for f in features if f["date"] == trade_date]
    print(f"📅 Phiên: {trade_date} — {len(features)} mã có data")

    # Đã có brief cho phiên này chưa?
    existing = sb.table("market_briefs").select("trade_date").eq("trade_date", trade_date).execute()
    if existing.data:
        print(f"⏭️  Brief cho {trade_date} đã tồn tại → skip.")
        return

    sys_p, user_p = build_brief_prompt(features)
    print("🤖 Gọi GLM…")
    resp = glm.chat.completions.create(
        model=GLM_MODEL,
        temperature=0.5,
        messages=[
            {"role": "system", "content": sys_p},
            {"role": "user", "content": user_p},
        ],
    )
    content = resp.choices[0].message.content or ""
    print(f"✅ Nhận {len(content)} ký tự, upsert vào market_briefs…")

    sb.table("market_briefs").upsert({
        "trade_date": trade_date,
        "content": content,
        "model": GLM_MODEL,
    }, on_conflict="trade_date").execute()
    print("🏁 Xong.")


if __name__ == "__main__":
    main()
