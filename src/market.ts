import type { Coin, CoinsFile } from "./types";

/**
 * Danh sách coin, giá, % 24h và khối lượng lấy trực tiếp từ API của sàn đó,
 * xếp theo khối lượng giao dịch 24h. % 1h/7d lấy từ Binance (rolling window ticker).
 */

export const PAGE_SIZE = 100;
export const MAX_PAGES = 12;
const TTL = 4 * 60 * 1000;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const listeners = new Set<() => void>();
export const onMarketUpdate = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const notify = () => listeners.forEach((fn) => fn());

export function clearMarketCache() {
  tickerCache.clear();
  geckoCache.clear();
  notify();
}

// ---------- Sàn: lấy trực tiếp từ API của sàn ----------

interface Ticker {
  base: string;
  price: number;
  change24h: number; // %
  volume: number; // quote volume 24h (USD)
}

const QUOTES = ["USDT", "USDC", "USD"];
const baseOf = (sym: string): string | null => {
  for (const q of QUOTES) if (sym.endsWith(q) && sym.length > q.length) return sym.slice(0, -q.length);
  return null;
};
const splitPair = (id: string): [string, string] | null => {
  const [b, q] = id.split(/[-_/]/);
  return b && q && QUOTES.includes(q) ? [b, q] : null;
};

/** Gộp nhiều cặp cùng coin (USDT/USDC/USD) -> giữ cặp có khối lượng lớn nhất, xếp giảm dần. */
function finalize(rows: Ticker[]): Ticker[] {
  const best = new Map<string, Ticker>();
  for (const r of rows) {
    if (!(r.price > 0) || !(r.volume > 0) || !Number.isFinite(r.change24h)) continue;
    const key = r.base.toUpperCase();
    const cur = best.get(key);
    if (!cur || r.volume > cur.volume) best.set(key, { ...r, base: key });
  }
  return [...best.values()].sort((a, b) => b.volume - a.volume);
}

export interface ExchangeDef {
  id: string;
  name: string;
  load: () => Promise<Ticker[]>;
}

const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;
const BINANCE_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];
async function binanceJson(path: string): Promise<any> {
  let last: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      return await getJson(host + path);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Binance unavailable");
}

export const EXCHANGES: ExchangeDef[] = [
  {
    id: "binance",
    name: "Binance",
    load: async () => {
      const rows: any[] = await binanceJson("/api/v3/ticker/24hr");
      return finalize(
        rows
          .filter((r) => typeof r.symbol === "string" && r.symbol.endsWith("USDT"))
          .filter((r) => !LEVERAGED.test(r.symbol.slice(0, -4)))
          .map((r) => ({
            base: r.symbol.slice(0, -4),
            price: num(r.lastPrice),
            change24h: num(r.priceChangePercent),
            volume: num(r.quoteVolume),
          })),
      );
    },
  },
  {
    id: "bybit",
    name: "Bybit",
    load: async () => {
      const j = await getJson("https://api.bybit.com/v5/market/tickers?category=spot");
      return finalize(
        j.result.list
          .map((r: any) => ({ b: baseOf(r.symbol), r }))
          .filter((x: any) => x.b)
          .map(({ b, r }: any) => ({
            base: b,
            price: num(r.lastPrice),
            change24h: num(r.price24hPcnt) * 100,
            volume: num(r.turnover24h),
          })),
      );
    },
  },
  {
    id: "okx",
    name: "OKX",
    load: async () => {
      const j = await getJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
      return finalize(
        j.data
          .map((r: any) => ({ p: splitPair(r.instId), r }))
          .filter((x: any) => x.p)
          .map(({ p, r }: any) => ({
            base: p[0],
            price: num(r.last),
            change24h: num(r.open24h) > 0 ? ((num(r.last) - num(r.open24h)) / num(r.open24h)) * 100 : NaN,
            volume: num(r.volCcy24h),
          })),
      );
    },
  },
  {
    id: "kraken",
    name: "Kraken",
    load: async () => {
      const [pairs, tick] = await Promise.all([
        getJson("https://api.kraken.com/0/public/AssetPairs"),
        getJson("https://api.kraken.com/0/public/Ticker"),
      ]);
      const alias: Record<string, string> = { XBT: "BTC", XDG: "DOGE" };
      const rows: Ticker[] = [];
      for (const [key, t] of Object.entries<any>(tick.result)) {
        const p = splitPair(String(pairs.result[key]?.wsname ?? ""));
        if (!p) continue;
        const last = num(t.c?.[0]);
        const open = num(t.o); // giá mở cửa đầu ngày (UTC): Kraken không có mốc 24h
        rows.push({
          base: alias[p[0]] ?? p[0],
          price: last,
          change24h: open > 0 ? ((last - open) / open) * 100 : NaN,
          volume: num(t.v?.[1]) * num(t.p?.[1]),
        });
      }
      return finalize(rows);
    },
  },
  {
    id: "gate",
    name: "Gate",
    load: async () => {
      const rows: any[] = await getJson("https://api.gateio.ws/api/v4/spot/tickers");
      return finalize(
        rows
          .filter((r) => r.currency_pair?.endsWith("_USDT"))
          .map((r) => ({
            base: r.currency_pair.slice(0, -5),
            price: num(r.last),
            change24h: num(r.change_percentage),
            volume: num(r.quote_volume),
          })),
      );
    },
  },
  {
    id: "bitget",
    name: "Bitget",
    load: async () => {
      const j = await getJson("https://api.bitget.com/api/v2/spot/market/tickers");
      return finalize(
        j.data
          .filter((r: any) => r.symbol?.endsWith("USDT"))
          .map((r: any) => ({
            base: r.symbol.slice(0, -4),
            price: num(r.lastPr),
            change24h: num(r.change24h) * 100,
            volume: num(r.usdtVolume),
          })),
      );
    },
  },
  {
    id: "cryptocom",
    name: "Crypto.com",
    load: async () => {
      const j = await getJson("https://api.crypto.com/exchange/v1/public/get-tickers");
      return finalize(
        j.result.data
          .map((r: any) => ({ p: splitPair(String(r.i)), r }))
          .filter((x: any) => x.p)
          .map(({ p, r }: any) => ({
            base: p[0],
            price: num(r.a),
            change24h: num(r.c) * 100,
            volume: num(r.vv),
          })),
      );
    },
  },
];

const tickerCache = new Map<string, { at: number; p: Promise<Ticker[]> }>();
const tickersLoaded = new Map<string, Ticker[]>();

export function loadTickers(id: string): Promise<Ticker[]> {
  const hit = tickerCache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const def = EXCHANGES.find((e) => e.id === id);
  if (!def) return Promise.reject(new Error("Unknown exchange"));
  const p = def.load().then((list) => {
    if (list.length < 10) throw new Error("Unexpected exchange data");
    tickersLoaded.set(id, list);
    notify();
    return list;
  });
  tickerCache.set(id, { at: Date.now(), p });
  p.catch(() => {
    if (tickerCache.get(id)?.p === p) tickerCache.delete(id);
  });
  return p;
}

/** % thay đổi 1h và 7d của Binance cho các ký hiệu; coin không có trên Binance bị bỏ qua. */
async function binanceWindows(bases: string[]) {
  const out = new Map<string, { h1: number; d7: number }>();
  const known = new Set((await loadTickers("binance")).map((t) => t.base));
  const syms = bases.filter((b) => known.has(b)).map((b) => b + "USDT");
  for (let i = 0; i < syms.length; i += 100) {
    const q = encodeURIComponent(JSON.stringify(syms.slice(i, i + 100)));
    const [h1, d7] = await Promise.all([
      binanceJson(`/api/v3/ticker?symbols=${q}&windowSize=1h&type=MINI`),
      binanceJson(`/api/v3/ticker?symbols=${q}&windowSize=7d&type=MINI`),
    ]);
    // kiểu MINI không có priceChangePercent -> tự tính từ giá mở/đóng của cửa sổ
    const pct = (r: any) => (num(r.openPrice) > 0 ? ((num(r.lastPrice) - num(r.openPrice)) / num(r.openPrice)) * 100 : NaN);
    const m7 = new Map<string, number>(d7.map((r: any) => [r.symbol, pct(r)]));
    for (const r of h1) {
      out.set(String(r.symbol).slice(0, -4), { h1: pct(r), d7: m7.get(r.symbol) ?? NaN });
    }
  }
  return out;
}

// ---------- CoinGecko: toàn thị trường, xếp theo vốn hoá ----------

const GECKO = "coingecko";
export const SOURCES: { id: string; name: string }[] = [{ id: GECKO, name: "CoinGecko" }, ...EXCHANGES];
const geckoCache = new Map<number, { at: number; p: Promise<Coin[]> }>();

function loadGeckoPage(page: number): Promise<Coin[]> {
  const hit = geckoCache.get(page);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = getJson(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc` +
      `&per_page=${PAGE_SIZE}&page=${page}&price_change_percentage=1h,24h,7d`,
  ).then((rows: any[]) => {
    if (!rows.length) throw new Error("Empty data from CoinGecko");
    return rows.map((c, i): Coin => ({
      id: String(c.id),
      symbol: String(c.symbol).toUpperCase(),
      name: String(c.name),
      rank: num(c.market_cap_rank) || (page - 1) * PAGE_SIZE + i + 1,
      price: num(c.current_price),
      marketCap: num(c.market_cap),
      volume24h: num(c.total_volume),
      change1h: c.price_change_percentage_1h_in_currency == null ? NaN : num(c.price_change_percentage_1h_in_currency),
      change24h: c.price_change_percentage_24h_in_currency == null ? NaN : num(c.price_change_percentage_24h_in_currency),
      change7d: c.price_change_percentage_7d_in_currency == null ? NaN : num(c.price_change_percentage_7d_in_currency),
    }));
  });
  geckoCache.set(page, { at: Date.now(), p });
  p.catch(() => {
    if (geckoCache.get(page)?.p === p) geckoCache.delete(page);
  });
  return p;
}

const exName = (id: string) => SOURCES.find((e) => e.id === id)?.name ?? id;

/** Trang `page` (1-based) của sàn `exchange`. */
export async function loadView(exchange: string, page: number): Promise<CoinsFile> {
  if (exchange === GECKO) {
    const coins = await loadGeckoPage(page).catch((e) => {
      throw e instanceof Error && e.message.includes("429") ? new Error("CoinGecko rate limit, try again in a minute") : e;
    });
    return { updatedAt: new Date().toISOString(), source: "CoinGecko", coins };
  }
  const list = await loadTickers(exchange);
  const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  if (!slice.length) throw new Error(`${exName(exchange)} has no page ${page}`);
  const win = await binanceWindows(slice.map((t) => t.base)).catch(
    () => new Map<string, { h1: number; d7: number }>(),
  );
  const coins: Coin[] = slice.map((t, i) => {
    const w = win.get(t.base);
    return {
      id: t.base.toLowerCase(),
      symbol: t.base,
      name: t.base,
      rank: (page - 1) * PAGE_SIZE + i + 1,
      price: t.price,
      marketCap: 0,
      volume24h: t.volume,
      change1h: w?.h1 ?? NaN,
      change24h: t.change24h,
      change7d: w?.d7 ?? NaN,
    };
  });
  return { updatedAt: new Date().toISOString(), source: exName(exchange), coins };
}

/** Số trang của một sàn theo số coin có, tối đa 12. */
export function pageCount(exchange: string): number {
  if (exchange === GECKO) return MAX_PAGES;
  const list = tickersLoaded.get(exchange);
  return list ? Math.max(1, Math.min(MAX_PAGES, Math.ceil(list.length / PAGE_SIZE))) : 1;
}
