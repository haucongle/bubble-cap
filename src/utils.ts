import type { Coin, SizeBy, Timeframe } from "./types";

export const STABLECOINS = new Set([
  "USDT", "USDC", "DAI", "USDE", "USD1", "PYUSD", "USDG", "RLUSD", "USDY", "USYC",
  "USDF", "U", "USDD", "BFUSD", "USDGO", "OUSD", "GHO", "USD0", "FDUSD", "TUSD",
  "USDS", "EURC",
]);

export function changeFor(coin: Coin, tf: Timeframe): number {
  const v = tf === "1h" ? coin.change1h : tf === "24h" ? coin.change24h : coin.change7d;
  return Number.isFinite(v) ? v : 0;
}

// % thay đổi tương ứng với màu đậm nhất, theo từng khung thời gian
const COLOR_RANGE: Record<Timeframe, number> = { "1h": 1.5, "24h": 6, "7d": 15 };

export function bubbleColors(change: number, tf: Timeframe) {
  const t = Math.min(Math.abs(change) / COLOR_RANGE[tf], 1);
  const hue = change >= 0 ? 160 : 355;
  return {
    fill: `hsl(${hue}, ${18 + 42 * t}%, ${19 + 17 * t}%)`,
    stroke: `hsl(${hue}, ${30 + 45 * t}%, ${38 + 22 * t}%)`,
  };
}

/**
 * Tính bán kính từng bubble sao cho tổng diện tích chiếm ~42% khung vẽ.
 * Số mũ < 1 để nén chênh lệch (BTC không nuốt hết chỗ của các coin nhỏ).
 */
export function computeRadii(
  coins: Coin[],
  tf: Timeframe,
  sizeBy: SizeBy,
  w: number,
  h: number,
): Map<string, number> {
  const raw = coins.map((c) =>
    sizeBy === "marketCap"
      ? Math.pow(Math.max(c.marketCap, 1), 0.28)
      : Math.pow(Math.max(Math.abs(changeFor(c, tf)), 0.5), 0.6),
  );
  const sumSq = raw.reduce((s, v) => s + v * v, 0) || 1;
  const k = Math.sqrt((0.42 * w * h) / (Math.PI * sumSq));
  const minR = 13;
  const maxR = Math.max(minR, Math.min(w, h) * 0.2);
  const out = new Map<string, number>();
  coins.forEach((c, i) => out.set(c.id, Math.min(maxR, Math.max(minR, raw[i] * k))));
  return out;
}

export function fmtPct(v: number): string {
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${v > 0 ? "+" : ""}${s}%`;
}

export function fmtPrice(p: number): string {
  if (p >= 1) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 0.01) return "$" + p.toFixed(4);
  return "$" + p.toPrecision(3);
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export function fmtCap(v: number): string {
  return "$" + compact.format(v);
}
