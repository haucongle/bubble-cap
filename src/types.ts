export type Timeframe = "1h" | "24h" | "7d";
export type SizeBy = "movement" | "marketCap";

export interface Coin {
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

export interface CoinsFile {
  updatedAt: string;
  source: string;
  coins: Coin[];
}
