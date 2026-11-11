import { useEffect, useMemo, useRef, useState } from "react";
import { ASSETS, loadOnchain, type OnchainPoint } from "./onchain";

type Key = "price" | "realized" | "delta";
type Range = "1y" | "4y" | "all";

const SERIES: { key: Key; label: string; color: string }[] = [
  { key: "price", label: "Price", color: "#e8edf5" },
  { key: "realized", label: "Realized price", color: "#f59e0b" },
  { key: "delta", label: "Delta price", color: "#38bdf8" },
];

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "1y", label: "1Y", days: 365 },
  { id: "4y", label: "4Y", days: 365 * 4 },
  { id: "all", label: "All", days: Infinity },
];

const PAD = { l: 64, r: 16, t: 16, b: 28 };
const DAY = 86_400_000;
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const money = (v: number) =>
  !Number.isFinite(v) ? "–" : "$" + (v >= 100 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(3));
const axis = (v: number) => "$" + (v < 1 ? String(Number(v.toPrecision(2))) : compact.format(v));
const dateStr = (t: number) => new Date(t).toISOString().slice(0, 10);

function niceLinearTicks(min: number, max: number, n = 5): number[] {
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let k = Math.floor(Math.log10(min)); k <= Math.ceil(Math.log10(max)); k++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, k);
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out;
}

function timeTicks(t0: number, t1: number): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = [];
  const y0 = new Date(t0).getUTCFullYear();
  const y1 = new Date(t1).getUTCFullYear();
  if (t1 - t0 < 2.5 * 365 * DAY) {
    for (let y = y0; y <= y1; y++) {
      for (let m = 0; m < 12; m += 3) {
        const t = Date.UTC(y, m, 1);
        if (t >= t0 && t <= t1) {
          const d = new Date(t);
          out.push({ t, label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + " '" + String(y).slice(2) });
        }
      }
    }
    return out;
  }
  const step = Math.max(1, Math.ceil((y1 - y0) / 8));
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const t = Date.UTC(y, 0, 1);
    if (t >= t0 && t <= t1) out.push({ t, label: String(y) });
  }
  return out;
}

export default function OnchainChart() {
  const [points, setPoints] = useState<OnchainPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState("btc");
  const [range, setRange] = useState<Range>("all");
  const [log, setLog] = useState(true);
  const [on, setOn] = useState<Record<Key, boolean>>({ price: true, realized: true, delta: true });
  const [hover, setHover] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setError(null);
    setHover(null);
    loadOnchain(asset)
      .then((p) => {
        if (cancelled) return;
        setPoints(p);
        // Delta price âm không vẽ được trên thang Log -> tự chuyển sang Linear
        setLog(p[p.length - 1].delta > 0);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [asset]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [points]);

  const visible = useMemo(() => {
    if (!points) return [];
    const days = RANGES.find((r) => r.id === range)!.days;
    if (!Number.isFinite(days)) return points;
    const from = points[points.length - 1].t - days * DAY;
    return points.filter((p) => p.t >= from);
  }, [points, range]);

  const view = useMemo(() => {
    const { w, h } = size;
    if (!visible.length || w < 50 || h < 50) return null;
    const t0 = visible[0].t;
    const t1 = visible[visible.length - 1].t;
    const active = SERIES.filter((s) => on[s.key]);
    let min = Infinity;
    let max = -Infinity;
    for (const p of visible)
      for (const s of active) {
        const v = p[s.key];
        if (Number.isFinite(v) && (!log || v > 0)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    if (!Number.isFinite(min)) return null;
    if (log) {
      min = Math.pow(10, Math.log10(min) - 0.05);
      max = Math.pow(10, Math.log10(max) + 0.05);
    } else {
      min = Math.min(0, min);
      max *= 1.05;
    }
    const pw = w - PAD.l - PAD.r;
    const ph = h - PAD.t - PAD.b;
    const X = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * pw;
    const Y = log
      ? (v: number) => PAD.t + ph - ((Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * ph
      : (v: number) => PAD.t + ph - ((v - min) / (max - min)) * ph;
    const paths = active.map((s) => {
      let d = "";
      let pen = false;
      for (const p of visible) {
        const v = p[s.key];
        if (!Number.isFinite(v) || (log && v <= 0)) {
          pen = false;
          continue;
        }
        d += `${pen ? "L" : "M"}${X(p.t).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      }
      return { ...s, d };
    });
    const yTicks = log ? logTicks(min, max) : niceLinearTicks(min, max);
    return { t0, t1, X, Y, paths, yTicks, xTicks: timeTicks(t0, t1), pw, ph };
  }, [visible, size, on, log]);

  const last = points?.[points.length - 1];
  const hp = hover !== null ? visible[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!view || !visible.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = view.t0 + ((x - PAD.l) / view.pw) * (view.t1 - view.t0);
    let lo = 0;
    let hi = visible.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (visible[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(visible[lo - 1].t - t) < Math.abs(visible[lo].t - t)) lo--;
    setHover(lo);
  };

  const meta = ASSETS.find((a) => a.id === asset)!;
  const picker = (
    <select className="oc-asset" aria-label="Coin" value={asset} onChange={(e) => setAsset(e.target.value)}>
      {ASSETS.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.symbol})
        </option>
      ))}
    </select>
  );

  if (error || !points || !last)
    return (
      <div className="oc">
        <div className="oc-bar">{picker}</div>
        <div className="oc-plot status" role="status">
          {error ? `Couldn't load on-chain data for ${meta.name} (${error}).` : "Loading on-chain data…"}
        </div>
      </div>
    );

  return (
    <div className="oc">
      <div className="oc-bar">
        <div className="oc-stats">
          {picker}
          <div>
            <span>Price</span>
            <strong>{money(last.price)}</strong>
          </div>
          <div>
            <span>Realized price</span>
            <strong style={{ color: SERIES[1].color }}>{money(last.realized)}</strong>
          </div>
          <div>
            <span>Delta price</span>
            <strong style={{ color: SERIES[2].color }}>{money(last.delta)}</strong>
          </div>
          <div>
            <span>MVRV</span>
            <strong>{(last.price / last.realized).toFixed(2)}</strong>
          </div>
        </div>
        <div className="oc-controls">
          <div className="seg" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={r.id === range} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Scale">
            <button type="button" aria-pressed={log} onClick={() => setLog(true)}>
              Log
            </button>
            <button type="button" aria-pressed={!log} onClick={() => setLog(false)}>
              Linear
            </button>
          </div>
          {SERIES.map((s) => (
            <label key={s.key} className="check">
              <input
                type="checkbox"
                checked={on[s.key]}
                onChange={(e) => setOn((o) => ({ ...o, [s.key]: e.target.checked }))}
              />
              <span className="oc-swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="oc-plot" ref={wrapRef}>
        {view && (
          <svg width={size.w} height={size.h} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${meta.name} price, realized price and delta price`}>
            {view.yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={size.w - PAD.r} y1={view.Y(v)} y2={view.Y(v)} className="oc-grid" />
                <text x={PAD.l - 8} y={view.Y(v)} className="oc-tick" textAnchor="end" dominantBaseline="middle">
                  {axis(v)}
                </text>
              </g>
            ))}
            {view.xTicks.map((x) => (
              <text key={x.t} x={view.X(x.t)} y={size.h - 8} className="oc-tick" textAnchor="middle">
                {x.label}
              </text>
            ))}
            {view.paths.map((p) => (
              <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={p.key === "price" ? 1.4 : 1.8} strokeLinejoin="round" />
            ))}
            {hp && (
              <g pointerEvents="none">
                <line x1={view.X(hp.t)} x2={view.X(hp.t)} y1={PAD.t} y2={size.h - PAD.b} className="oc-cross" />
                {view.paths.map((p) => {
                  const v = hp[p.key];
                  return Number.isFinite(v) && (!log || v > 0) ? (
                    <circle key={p.key} cx={view.X(hp.t)} cy={view.Y(v)} r={3.5} fill={p.color} />
                  ) : null;
                })}
              </g>
            )}
          </svg>
        )}
        {hp && view && (
          <div className="oc-tip" style={{ left: Math.min(Math.max(view.X(hp.t) + 14, 8), size.w - 190) }}>
            <strong>{dateStr(hp.t)}</strong>
            {SERIES.filter((s) => on[s.key]).map((s) => (
              <div key={s.key}>
                <span style={{ color: s.color }}>{s.label}</span>
                <span>{Number.isFinite(hp[s.key]) ? money(hp[s.key]) : "–"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="oc-note">
        Data: CoinMetrics community API (daily, from {dateStr(points[0].t)}). Realized price = price ÷ MVRV. Delta price
        = realized price − average price (mean market cap since the first day ÷ supply). Balanced price is not shown: it
        needs on-chain transfer volume, which the free API does not provide.
      </p>
    </div>
  );
}
