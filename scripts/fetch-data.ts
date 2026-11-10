/**
 * Lấy top 100 coin và ghi ra public/data/coins.json
 * Nguồn chính: CoinLore (không cần key). Dự phòng: CoinPaprika.
 * Chạy: npm run fetch
 */
import { mkdir, writeFile } from "node:fs/promises";

interface Coin {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  price: number;
  marketCap: number;
  change1h: number;
  change24h: number;
  change7d: number;
}

const LIMIT = 100;
const OUT = "public/data/coins.json";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "bubblecap" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fromCoinLore(): Promise<Coin[]> {
  const json = await getJson(`https://api.coinlore.net/api/tickers/?start=0&limit=${LIMIT}`);
  return json.data.map((c: any) => ({
    id: String(c.nameid ?? c.id),
    symbol: String(c.symbol),
    name: String(c.name),
    rank: num(c.rank),
    price: num(c.price_usd),
    marketCap: num(c.market_cap_usd),
    change1h: num(c.percent_change_1h),
    change24h: num(c.percent_change_24h),
    change7d: num(c.percent_change_7d),
  }));
}

async function fromCoinPaprika(): Promise<Coin[]> {
  const json: any[] = await getJson("https://api.coinpaprika.com/v1/tickers?quotes=USD");
  return json
    .filter((c) => c.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, LIMIT)
    .map((c) => {
      const q = c.quotes?.USD ?? {};
      return {
        id: String(c.id),
        symbol: String(c.symbol),
        name: String(c.name),
        rank: num(c.rank),
        price: num(q.price),
        marketCap: num(q.market_cap),
        change1h: num(q.percent_change_1h),
        change24h: num(q.percent_change_24h),
        change7d: num(q.percent_change_7d),
      };
    });
}

const SOURCES: { name: string; run: () => Promise<Coin[]> }[] = [
  { name: "CoinLore", run: fromCoinLore },
  { name: "CoinPaprika", run: fromCoinPaprika },
];

async function main() {
  for (const src of SOURCES) {
    try {
      const coins = await src.run();
      if (coins.length < 50 || coins.some((c) => !(c.marketCap > 0))) {
        throw new Error(`dữ liệu bất thường (${coins.length} coin)`);
      }
      await mkdir("public/data", { recursive: true });
      await writeFile(
        OUT,
        JSON.stringify({ updatedAt: new Date().toISOString(), source: src.name, coins }),
      );
      console.log(`OK: ${coins.length} coin từ ${src.name} -> ${OUT}`);
      return;
    } catch (e) {
      console.warn(`${src.name} lỗi:`, e instanceof Error ? e.message : e);
    }
  }
  // Thoát lỗi để workflow không deploy dữ liệu hỏng; bản cũ vẫn giữ nguyên trên Pages
  console.error("Tất cả nguồn đều lỗi.");
  process.exit(1);
}

main();
