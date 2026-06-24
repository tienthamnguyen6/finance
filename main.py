import os
import time
import pandas as pd
from vnstock import Vnstock
from supabase import create_client, Client
from datetime import datetime, timedelta

# Nguồn dữ liệu: VCI (mặc định ổn nhất), có thể đổi sang TCBS/MSN.
VN_SOURCE = os.environ.get("VNSTOCK_SOURCE", "VCI")
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


def get_vn30_tickers():
    try:
        symbols = _vn.stock(symbol='ACB', source=VN_SOURCE).listing.symbols_by_group('VN30')
        tickers = sorted({str(s).strip().upper() for s in symbols if str(s).strip()})
        if len(tickers) >= 20:
            return tickers
    except Exception as e:
        print(f"⚠️ Không lấy được VN30 động ({e}), dùng fallback.")
    return VN30_FALLBACK


def fetch_history_with_retry(ticker: str, start_date: str, end_date: str, max_retries: int = 3):
    """Gọi vnstock, gặp rate-limit thì ngủ rồi thử lại."""
    stock = _vn.stock(symbol=ticker, source=VN_SOURCE)
    for attempt in range(max_retries):
        try:
            df = stock.quote.history(start=start_date, end=end_date, interval='1D')
            return df
        except Exception as e:
            msg = str(e).lower()
            if 'limit' in msg or 'rate' in msg or '429' in msg or 'quá nhiều' in msg:
                wait = 65  # qua hẳn cửa sổ 60s
                print(f"⏳ {ticker}: rate-limit, chờ {wait}s rồi thử lại (lần {attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue
            raise
    return None


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
    for i, ticker in enumerate(tickers, 1):
        total += fetch_and_upsert(ticker, start_date, end_date)
        # Guest tier vnstock = 20 req/phút → sleep ~3.2s/ticker để không vượt ngưỡng.
        if i < len(tickers):
            time.sleep(3.2)

    print(f"🏁 Hoàn tất: {total} dòng đã upsert.")


if __name__ == "__main__":
    main()
