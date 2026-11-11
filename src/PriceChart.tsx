import { useEffect, useState } from "react";
import type { Coin, Timeframe } from "./types";
import { fmtCap, fmtPct, fmtPrice } from "./utils";
import { loadSeries, type Point } from "./history";

interface Props {
  coin: Coin;
  exchange: string;
  timeframe: Timeframe;
  onClose: () => void;
}

type State = { status: "loading" } | { status: "error" } | { status: "ok"; points: Point[] };

const W = 520;
const H = 220;
const PAD = { l: 8, r: 8, t: 12, b: 20 };

export default function PriceChart({ coin, exchange, timeframe, onClose }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    setHover(null);
    loadSeries(coin, exchange, timeframe, ac.signal)
      .then((points) => setState({ status: "ok", points }))
      .catch(() => {
        if (!ac.signal.aborted) setState({ status: "error" });
      });
    return () => ac.abort();
  }, [coin.id, coin.symbol, exchange, timeframe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = <div className="pc-msg">Loading chart…</div>;
  } else if (state.status === "error") {
    body = <div className="pc-msg">No price history available for {coin.symbol.toUpperCase()}.</div>;
  } else {
    const pts = state.points;
    const ps = pts.map((d) => d.p);
    const min = Math.min(...ps);
    const max = Math.max(...ps);
    const span = max - min || 1;
    const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
    const y = (p: number) => PAD.t + (1 - (p - min) / span) * (H - PAD.t - PAD.b);
    const line = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.p).toFixed(1)}`).join("");
    const up = pts[pts.length - 1].p >= pts[0].p;
    const color = up ? "var(--gain)" : "var(--loss)";
    const area = `${line}L${x(pts.length - 1)},${H - PAD.b}L${x(0)},${H - PAD.b}Z`;
    const hp = hover != null ? pts[hover] : null;
    const fmtT = (t: number) =>
      new Date(t).toLocaleString(
        [],
        timeframe === "7d"
          ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
          : { hour: "2-digit", minute: "2-digit" },
      );
    body = (
      <>
        <div className="pc-hover">
          {hp ? `${fmtPrice(hp.p)} · ${fmtT(hp.t)}` : `${fmtPrice(pts[pts.length - 1].p)} · now`}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="pc-svg"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const fx = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (pts.length - 1));
            setHover(Math.min(Math.max(i, 0), pts.length - 1));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.3" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#pcfill)" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {hp && hover != null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(hp.p)} r="4" fill={color} />
            </>
          )}
          <text x={PAD.l} y={H - 4} className="pc-axis">{fmtT(pts[0].t)}</text>
          <text x={W - PAD.r} y={H - 4} textAnchor="end" className="pc-axis">
            {fmtT(pts[pts.length - 1].t)}
          </text>
        </svg>
        <div className="pc-range">
          <span>Low {fmtPrice(min)}</span>
          <span>High {fmtPrice(max)}</span>
        </div>
      </>
    );
  }

  const ch = timeframe === "1h" ? coin.change1h : timeframe === "24h" ? coin.change24h : coin.change7d;
  return (
    <div className="pc-backdrop" onClick={onClose}>
      <div
        className="pc"
        role="dialog"
        aria-label={`${coin.name} price chart`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pc-head">
          <div>
            <strong>{coin.name}</strong> <span className="pc-sym">{coin.symbol.toUpperCase()}</span>
            <div className="pc-sub">
              {fmtPrice(coin.price)} ·{" "}
              <span className={ch >= 0 ? "gain" : "loss"}>
                {fmtPct(ch)} ({timeframe})
              </span>{" "}
              · {coin.marketCap > 0 ? `Cap ${fmtCap(coin.marketCap)}` : `Vol ${fmtCap(coin.volume24h ?? 0)}`}
            </div>
          </div>
          <button type="button" className="pc-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
