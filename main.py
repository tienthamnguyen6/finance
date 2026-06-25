import os
import sys
import time
import pandas as pd
from vnstock import Vnstock
from supabase import create_client, Client
from datetime import datetime, timedelta


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

# Nguồn dữ liệu chính + danh sách dự phòng. Khi nguồn này bị rate-limit (hay xảy ra
# trên IP GitHub Actions), thử ngay nguồn kế tiếp trước khi phải chờ qua cửa sổ 60s.
# Nguồn hợp lệ của vnstock hiện tại: VCI, MSN, KBS, FMP.
VN_SOURCE = os.environ.get("VNSTOCK_SOURCE", "VCI")
VN_SOURCES = [VN_SOURCE] + [s for s in ("VCI", "MSN", "KBS") if s != VN_SOURCE]
_vn = Vnstock()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
# Số ngày backfill. Cron daily đặt = 1; chạy lần đầu để backfill 1 năm đặt = 365.
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "1"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

VN30_FALLBACK = [
    'ACB', 'BCM', 'BID', 'BVH', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG',
    'MBB', 'MSN', 'MWG', 'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'SSI', 'STB',
    'TCB', 'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VRE'
]

# Mã bổ sung ngoài VN30 (luôn được theo dõi). Có thể override qua env EXTRA_TICKERS="VIX,DIG".
EXTRA_TICKERS = [
    t.strip().upper()
    for t in os.environ.get("EXTRA_TICKERS", "VIX").split(",")
    if t.strip()
]


def get_vn30_tickers():
    try:
        symbols = _vn.stock(symbol='ACB', source=VN_SOURCE).listing.symbols_by_group('VN30')
        tickers = sorted({str(s).strip().upper() for s in symbols if str(s).strip()})
        if len(tickers) >= 20:
            base = tickers
        else:
            base = VN30_FALLBACK
    except Exception as e:
        print(f"⚠️ Không lấy được VN30 động ({e}), dùng fallback.")
        base = VN30_FALLBACK
    # Union mã bổ sung, giữ thứ tự: VN30 trước rồi extra.
    merged = list(base)
    for t in EXTRA_TICKERS:
        if t not in merged:
            merged.append(t)
    return merged


def _is_rate_limit(e: Exception) -> bool:
    msg = str(e).lower()
    return 'limit' in msg or 'rate' in msg or '429' in msg or 'quá nhiều' in msg


def fetch_history_with_retry(ticker: str, start_date: str, end_date: str, max_retries: int = 2):
    """Cào lịch sử giá. Gặp rate-limit thì đổi sang nguồn dự phòng ngay; chỉ khi
    MỌI nguồn đều bị chặn mới chờ qua cửa sổ 60s rồi thử lại."""
    last_err = None
    for attempt in range(max_retries):
        rate_limited = False
        for src in VN_SOURCES:
            try:
                df = _vn.stock(symbol=ticker, source=src) \
                    .quote.history(start=start_date, end=end_date, interval='1D')
                if src != VN_SOURCES[0] or attempt > 0:
                    print(f"   ↳ {ticker}: lấy được từ nguồn {src}")
                return df
            except Exception as e:
                last_err = e
                if _is_rate_limit(e):
                    rate_limited = True
                continue  # thử nguồn kế tiếp (kể cả lỗi non-rate-limit của 1 nguồn)
        # Chỉ chờ qua cửa sổ 60s khi nguyên nhân là rate-limit; lỗi khác chờ vô ích.
        if rate_limited and attempt < max_retries - 1:
            wait = 65
            print(f"⏳ {ticker}: mọi nguồn rate-limit, chờ {wait}s (vòng {attempt + 1}/{max_retries})")
            time.sleep(wait)
        elif not rate_limited:
            break
    # Mọi nguồn đều fail → ném lỗi để main() ghi nhận mã thất bại, KHÔNG trả None
    # (sẽ bị nhầm thành "không có dữ liệu mới" và nuốt âm thầm).
    raise RuntimeError(f"{ticker}: không cào được từ nguồn nào {VN_SOURCES}") from last_err


def get_date_range(ticker: str):
    """Trả về (min_date, max_date, count) cho ticker trong DB, hoặc (None, None, 0)."""
    try:
        res = supabase.table('vn30_daily_prices') \
            .select('trade_date') \
            .eq('ticker', ticker) \
            .order('trade_date', desc=False) \
            .execute()
        rows = res.data or []
        if not rows:
            return None, None, 0
        return rows[0]['trade_date'], rows[-1]['trade_date'], len(rows)
    except Exception as e:
        print(f"⚠️ Không đọc được date range cho {ticker}: {e}")
        return None, None, 0


def fetch_one_range(ticker: str, start_date: str, end_date: str, cutoff: str | None):
    """Cào 1 dải, trả về list payload đã chuẩn hoá. cutoff: ngày tối thiểu sẽ giữ."""
    df = fetch_history_with_retry(ticker, start_date, end_date)
    if df is None or df.empty:
        return []
    df = df.rename(columns={'time': 'trade_date'})
    df = df.sort_values('trade_date').reset_index(drop=True)
    df['daily_return'] = df['close'].pct_change()
    if cutoff:
        df['_d'] = pd.to_datetime(df['trade_date']).dt.strftime('%Y-%m-%d')
        df = df[df['_d'] >= cutoff].drop(columns=['_d']).reset_index(drop=True)
    payload_local = []
    for _, row in df.iterrows():
        trade_date = pd.to_datetime(row['trade_date']).strftime('%Y-%m-%d')
        dr = row['daily_return']
        payload_local.append({
            "ticker": ticker,
            "trade_date": trade_date,
            "open_price": float(row['open']),
            "high_price": float(row['high']),
            "low_price": float(row['low']),
            "close_price": float(row['close']),
            "volume": int(row['volume']) if pd.notna(row['volume']) else None,
            "daily_return": float(dr) if pd.notna(dr) else None,
        })
    return payload_local


def fetch_and_upsert(ticker: str, start_date: str, end_date: str):
    min_d, max_d, count = get_date_range(ticker)

    # Xác định các khoảng còn thiếu cần cào.
    ranges = []  # mỗi phần tử: (fetch_start, fetch_end, cutoff)
    if count == 0:
        ranges.append((start_date, end_date, None))
    else:
        # Gap đầu: start_date → (min_d - 1)
        if min_d > start_date:
            gap_end = (datetime.strptime(min_d, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
            ranges.append((start_date, gap_end, None))
        # Gap đuôi: (max_d + 1) → end_date, lùi 5 ngày làm anchor cho pct_change.
        if max_d < end_date:
            anchor_start = (datetime.strptime(max_d, '%Y-%m-%d') - timedelta(days=5)).strftime('%Y-%m-%d')
            cutoff = (datetime.strptime(max_d, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
            ranges.append((anchor_start, end_date, cutoff))

    if not ranges:
        print(f"⏭️  {ticker}: đủ {count} dòng ({min_d} → {max_d}), skip.")
        return 0

    payload = []
    for s, e, cut in ranges:
        payload.extend(fetch_one_range(ticker, s, e, cut))
        if len(ranges) > 1:
            time.sleep(3.2)  # tránh đốt quota khi cào 2 dải/ticker
    if not payload:
        print(f"… {ticker}: không có dữ liệu mới.")
        return 0

    payload.sort(key=lambda x: x['trade_date'])
    try:
        supabase.table('vn30_daily_prices') \
            .upsert(payload, on_conflict='ticker,trade_date') \
            .execute()
        print(f"✅ {ticker}: upsert {len(payload)} dòng ({payload[0]['trade_date']} → {payload[-1]['trade_date']})")
        return len(payload)
    except Exception as e:
        print(f"⚠️ Lỗi upsert {ticker}: {e}")
        return 0


def main():
    tickers = get_vn30_tickers()
    today = datetime.now()
    end_date = (today - timedelta(days=1)).strftime('%Y-%m-%d')
    start_date = (today - timedelta(days=BACKFILL_DAYS)).strftime('%Y-%m-%d')
    print(f"📋 Cào {len(tickers)} mã, dải {start_date} → {end_date}")

    total = 0
    failed = []
    for i, ticker in enumerate(tickers, 1):
        try:
            total += fetch_and_upsert(ticker, start_date, end_date)
        except Exception as e:
            print(f"❌ {ticker}: cào thất bại ({e})")
            failed.append(ticker)
        # Guest tier vnstock ~20 req/phút → sleep ~4s/ticker để bớt áp lực rate-limit.
        if i < len(tickers):
            time.sleep(4.0)

    # Pass 2: thử lại các mã thất bại với khoảng nghỉ dài hơn (IP GitHub Actions
    # hay bị rate-limit). Tránh để mất dữ liệu ngày mà job vẫn báo thành công.
    if failed:
        print(f"🔁 Thử lại {len(failed)} mã thất bại: {failed}")
        still_failed = []
        for ticker in failed:
            time.sleep(10)
            try:
                total += fetch_and_upsert(ticker, start_date, end_date)
            except Exception as e:
                print(f"❌ {ticker}: vẫn thất bại ({e})")
                still_failed.append(ticker)
        failed = still_failed

    print(f"🏁 Hoàn tất: {total} dòng đã upsert.")
    if failed:
        # Exit ≠ 0 → GitHub Actions báo đỏ và gửi email cảnh báo, không nuốt lỗi.
        print(f"⚠️ {len(failed)}/{len(tickers)} mã KHÔNG cào được: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
