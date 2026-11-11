/**
 * Chỉ số on-chain tính từ dữ liệu miễn phí của CoinMetrics (community API):
 *   Realized price = Price / MVRV            (MVRV = Market cap / Realized cap)
 *   Average price  = trung bình vốn hoá từ đầu lịch sử / Supply hiện tại
 *   Delta price    = Realized price - Average price   ( = (Realized cap - Average cap) / Supply )
 * Chỉ dùng cho coin có MVRV trong API miễn phí (xem ASSETS).
 * Balanced price cần dữ liệu transfer on-chain (bị chặn ở gói miễn phí) nên chưa có.
 */

export interface OnchainPoint {
  t: number; // ms
  price: number;
  realized: number; // NaN nếu chưa có MVRV
  average: number;
  delta: number; // NaN nếu chưa có MVRV
}

/** Coin có MVRV cập nhật trong CoinMetrics community API (đã bỏ stablecoin, token bọc và token đã chết). */
export const ASSETS: { id: string; name: string; symbol: string }[] = [
  { id: "btc", name: "Bitcoin", symbol: "BTC" },
  { id: "eth", name: "Ethereum", symbol: "ETH" },
  { id: "xrp", name: "XRP", symbol: "XRP" },
  { id: "ada", name: "Cardano", symbol: "ADA" },
  { id: "doge", name: "Dogecoin", symbol: "DOGE" },
  { id: "ltc", name: "Litecoin", symbol: "LTC" },
  { id: "bch", name: "Bitcoin Cash", symbol: "BCH" },
  { id: "link", name: "Chainlink", symbol: "LINK" },
  { id: "xlm", name: "Stellar", symbol: "XLM" },
  { id: "avaxc", name: "Avalanche (C-Chain)", symbol: "AVAX" },
  { id: "uni", name: "Uniswap", symbol: "UNI" },
  { id: "aave", name: "Aave", symbol: "AAVE" },
  { id: "icp", name: "Internet Computer", symbol: "ICP" },
  { id: "etc", name: "Ethereum Classic", symbol: "ETC" },
  { id: "zec", name: "Zcash", symbol: "ZEC" },
  { id: "dash", name: "Dash", symbol: "DASH" },
  { id: "algo", name: "Algorand", symbol: "ALGO" },
  { id: "shib_eth", name: "Shiba Inu", symbol: "SHIB" },
  { id: "snx", name: "Synthetix", symbol: "SNX" },
  { id: "crv", name: "Curve DAO", symbol: "CRV" },
  { id: "ldo", name: "Lido DAO", symbol: "LDO" },
  { id: "mana", name: "Decentraland", symbol: "MANA" },
  { id: "comp", name: "Compound", symbol: "COMP" },
  { id: "yfi", name: "yearn.finance", symbol: "YFI" },
  { id: "sushi", name: "SushiSwap", symbol: "SUSHI" },
  { id: "1inch", name: "1inch", symbol: "1INCH" },
  { id: "bal", name: "Balancer", symbol: "BAL" },
  { id: "bat", name: "Basic Attention Token", symbol: "BAT" },
  { id: "zrx", name: "0x", symbol: "ZRX" },
  { id: "knc", name: "Kyber Network", symbol: "KNC" },
  { id: "cro", name: "Cronos", symbol: "CRO" },
  { id: "leo_eth", name: "UNUS SED LEO", symbol: "LEO" },
  { id: "qnt", name: "Quant", symbol: "QNT" },
  { id: "gno", name: "Gnosis", symbol: "GNO" },
  { id: "uma", name: "UMA", symbol: "UMA" },
  { id: "pol_eth", name: "POL (Polygon)", symbol: "POL" },
  { id: "dcr", name: "Decred", symbol: "DCR" },
  { id: "dgb", name: "DigiByte", symbol: "DGB" },
];

const url = (asset: string) =>
  "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics" +
  `?assets=${encodeURIComponent(asset)}&metrics=PriceUSD,CapMVRVCur,CapMrktCurUSD,SplyCur&frequency=1d&page_size=10000`;

const DAY = 86_400_000;

export function compute(rows: any[]): OnchainPoint[] {
  const out: OnchainPoint[] = [];
  let capSum = 0;
  let n = 0;
  for (const r of rows) {
    const price = Number(r.PriceUSD);
    const mcap = Number(r.CapMrktCurUSD);
    const supply = Number(r.SplyCur);
    const mvrv = Number(r.CapMVRVCur);
    if (!(price > 0) || !(mcap > 0) || !(supply > 0)) continue;
    capSum += mcap;
    n++;
    const average = capSum / n / supply;
    const realized = mvrv > 0 ? price / mvrv : NaN;
    out.push({
      t: Date.parse(r.time),
      price,
      realized,
      average,
      delta: Number.isFinite(realized) ? realized - average : NaN,
    });
  }
  return out;
}

const cache = new Map<string, { at: number; p: Promise<OnchainPoint[]> }>();

export function loadOnchain(asset: string): Promise<OnchainPoint[]> {
  const hit = cache.get(asset);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.p;
  const p = (async () => {
    const res = await fetch(url(asset));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message ?? "CoinMetrics error");
    if (json.next_page_token) throw new Error("Unexpected paging from CoinMetrics");
    const pts = compute(json.data ?? []);
    if (pts.length < 100) throw new Error("Not enough on-chain data for this coin");
    const age = (Date.now() - pts[pts.length - 1].t) / DAY;
    if (age > 14) throw new Error("On-chain data for this coin is out of date");
    return pts;
  })();
  cache.set(asset, { at: Date.now(), p });
  p.catch(() => {
    if (cache.get(asset)?.p === p) cache.delete(asset);
  });
  return p;
}
