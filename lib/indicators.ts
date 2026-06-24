// Chỉ báo kỹ thuật, thuần JS, không lib ngoài.
// Quy ước: input theo thứ tự thời gian tăng dần (cũ → mới).
// Output cùng độ dài với input; phần đầu kỳ chưa đủ dữ liệu = null.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      seed += values[i];
    } else if (i === period - 1) {
      seed += values[i];
      prev = seed / period;
      out[i] = prev;
    } else {
      prev = values[i] * k + (prev as number) * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

// RSI Wilder (smoothed).
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  // EMA của signal chỉ áp lên đoạn macdLine != null.
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const tail = macdLine.slice(firstIdx) as number[];
    const sig = ema(tail, signalPeriod);
    for (let i = 0; i < sig.length; i++) signal[firstIdx + i] = sig[i];
  }
  const hist = macdLine.map((v, i) =>
    v != null && signal[i] != null ? v - (signal[i] as number) : null,
  );
  return { macd: macdLine, signal, hist };
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const m = mid[i] as number;
    const variance = window.reduce((s, x) => s + (x - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export type PriceRow = {
  trade_date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number;
  volume: number | null;
  daily_return: number | null;
};

export type EnrichedRow = PriceRow & {
  ma20: number | null;
  ma50: number | null;
  rsi14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
};

export function enrich(rows: PriceRow[]): EnrichedRow[] {
  const closes = rows.map((r) => r.close_price);
  const m20 = sma(closes, 20);
  const m50 = sma(closes, 50);
  const r14 = rsi(closes, 14);
  const md = macd(closes);
  const bb = bollinger(closes, 20, 2);
  return rows.map((r, i) => ({
    ...r,
    ma20: m20[i],
    ma50: m50[i],
    rsi14: r14[i],
    macd: md.macd[i],
    macd_signal: md.signal[i],
    macd_hist: md.hist[i],
    bb_upper: bb.upper[i],
    bb_lower: bb.lower[i],
  }));
}
