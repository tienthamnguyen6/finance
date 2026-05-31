import os
import pandas as pd
from vnstock import stock_historical_data
from supabase import create_client, Client
from datetime import datetime, timedelta

# CHỈ SỬA ĐOẠN NÀY: Lấy thông tin bảo mật từ hệ thống của GitHub chứ không ghi đè chuỗi ký tự vào đây
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# (Giữ nguyên toàn bộ phần code lấy dữ liệu và insert ở phía dưới...)

# Danh sách cổ phiếu muốn theo dõi
tickers = ['FPT', 'MBB', 'VNM']

# 2. EXTRACT: Lấy dữ liệu ngày hôm qua (hoặc dải ngày tùy ý)
today = datetime.now()
yesterday = (today - timedelta(days=1)).strftime('%Y-%m-%d')

for ticker in tickers:
    # Lấy dữ liệu từ vnstock
    df = stock_historical_data(symbol=ticker, start_date=yesterday, end_date=yesterday, resolution='1D')
    
    if not df.empty:
        # 3. TRANSFORM: Xử lý và làm sạch dữ liệu
        close_price = float(df['close'].iloc[0])
        
        # Công thức tính Return (Giả sử bạn cần query thêm giá ngày t-1 để tính, 
        # ở đây lấy ví dụ tính sẵn hoặc có thể để SQL tính sau)
        # Tỷ suất sinh lời: R_t = (P_t - P_{t-1}) / P_{t-1}
        
        # Chuẩn bị gói dữ liệu (Payload)
        data_payload = {
            "ticker": ticker,
            "trade_date": yesterday,
            "close_price": close_price,
            "daily_return": 0.0 # Tạm gán 0, ta sẽ dùng hàm SQL Window function để tính sau
        }
        
        # 4. LOAD: Đẩy dữ liệu vào Supabase
        try:
            data, count = supabase.table('vn30_daily_prices').insert(data_payload).execute()
            print(f"✅ Đã cập nhật thành công {ticker} ngày {yesterday}")
        except Exception as e:
            print(f"⚠️ Lỗi khi cập nhật {ticker}: {e}")