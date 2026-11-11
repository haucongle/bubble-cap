export type Timeframe = "1h" | "24h" | "7d";

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  price: number;
  marketCap: number; // 0 khi lấy từ sàn (không có vốn hoá)
  volume24h?: number; // quote volume 24h (USD) khi lấy từ sàn
  change1h: number;
  change24h: number;
  change7d: number;
}

export interface CoinsFile {
  updatedAt: string;
  source: string;
  coins: Coin[];
}
