import type { Coin, Timeframe } from "./types";

export type Point = { t: number; p: number };

/** Lịch sử giá: thử nến của sàn đang chọn -> Binance -> CoinGecko (chỉ khi nguồn là CoinGecko). */

const RANGE: Record<Timeframe, { n: number; bin: string; gate: string; bybit: string; okx: string; bitget: string }> = {
  "1h": { n: 60, bin: "1m", gate: "1m", bybit: "1", okx: "1m", bitget: "1min" },
  "24h": { n: 96, bin: "15m", gate: "15m", bybit: "15", okx: "15m", bitget: "15min" },
  "7d": { n: 168, bin: "1h", gate: "1h", bybit: "60", okx: "1H", bitget: "1h" },
};

async function getJson(url: string, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const byTime = (pts: Point[]) => pts.filter((x) => Number.isFinite(x.t) && x.p > 0).sort((a, b) => a.t - b.t);

type Loader = (sym: string, tf: Timeframe, signal: AbortSignal) => Promise<Point[]>;

const binance: Loader = async (sym, tf, signal) => {
  const q = `/api/v3/klines?symbol=${sym}USDT&interval=${RANGE[tf].bin}&limit=${RANGE[tf].n}`;
  let last: unknown;
  for (const host of ["https://api.binance.com", "https://data-api.binance.vision"]) {
    try {
      const rows = (await getJson(host + q, signal)) as [number, string, string, string, string][];
      return byTime(rows.map((r) => ({ t: r[0], p: Number(r[4]) })));
    } catch (e) {
      if (signal.aborted) throw e;
      last = e;
    }
  }
  throw last;
};

const BY_EXCHANGE: Record<string, Loader> = {
  binance,
  gate: async (sym, tf, signal) => {
    const rows = await getJson(
      `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${sym}_USDT&interval=${RANGE[tf].gate}&limit=${RANGE[tf].n}`,
      signal,
    );
    return byTime(rows.map((r: string[]) => ({ t: Number(r[0]) * 1000, p: Number(r[2]) })));
  },
  bybit: async (sym, tf, signal) => {
    const j = await getJson(
      `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}USDT&interval=${RANGE[tf].bybit}&limit=${RANGE[tf].n}`,
      signal,
    );
    return byTime(j.result.list.map((r: string[]) => ({ t: Number(r[0]), p: Number(r[4]) })));
  },
  okx: async (sym, tf, signal) => {
    const j = await getJson(
      `https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=${RANGE[tf].okx}&limit=${RANGE[tf].n}`,
      signal,
    );
    return byTime(j.data.map((r: string[]) => ({ t: Number(r[0]), p: Number(r[4]) })));
  },
  bitget: async (sym, tf, signal) => {
    const j = await getJson(
      `https://api.bitget.com/api/v2/spot/market/candles?symbol=${sym}USDT&granularity=${RANGE[tf].bitget}&limit=${RANGE[tf].n}`,
      signal,
    );
    return byTime(j.data.map((r: string[]) => ({ t: Number(r[0]), p: Number(r[4]) })));
  },
};

async function coingecko(id: string, tf: Timeframe, signal: AbortSignal): Promise<Point[]> {
  const days = tf === "7d" ? 7 : 1;
  const j = await getJson(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`,
    signal,
  );
  let pts = byTime(j.prices.map((r: [number, number]) => ({ t: r[0], p: r[1] })));
  if (tf === "1h") {
    const from = Date.now() - 60 * 60 * 1000;
    pts = pts.filter((x) => x.t >= from);
  }
  return pts;
}

export async function loadSeries(coin: Coin, exchange: string, tf: Timeframe, signal: AbortSignal): Promise<Point[]> {
  const sym = coin.symbol.toUpperCase();
  const attempts: (() => Promise<Point[]>)[] = [];
  const own = BY_EXCHANGE[exchange];
  if (own) attempts.push(() => own(sym, tf, signal));
  if (exchange !== "binance") attempts.push(() => binance(sym, tf, signal));
  if (exchange === "coingecko") attempts.push(() => coingecko(coin.id, tf, signal));

  for (const run of attempts) {
    try {
      const pts = await run();
      if (pts.length > 1) return pts;
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  throw new Error("no data");
}
