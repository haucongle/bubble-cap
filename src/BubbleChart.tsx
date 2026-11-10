import { useEffect, useRef, useState } from "react";
import { forceSimulation } from "d3-force";
import type { Simulation, SimulationNodeDatum } from "d3-force";
import PriceChart from "./PriceChart";
import type { Coin, SizeBy, Timeframe } from "./types";
import { bubbleColors, changeFor, computeRadii, fmtCap, fmtPct, fmtPrice } from "./utils";

interface BubbleNode extends SimulationNodeDatum {
  id: string;
  coin: Coin;
  r: number; // bán kính đang hiển thị (animate dần về targetR)
  targetR: number;
}

interface Props {
  coins: Coin[];
  timeframe: Timeframe;
  sizeBy: SizeBy;
  query: string;
}

interface Tip {
  coin: Coin;
  x: number;
  y: number;
}

const MIN_SPEED = 8; // px/s — bubble luôn trôi, không bao giờ đứng yên
const MAX_SPEED = 45;
const FONT = '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif';

// Logo coin: thử CoinCap trước, lỗi thì thử bộ icon spothq; cả hai lỗi thì bỏ qua (null)
const logoCache = new Map<string, { img: HTMLImageElement; ok: boolean }>();
function getLogo(symbol: string): HTMLImageElement | null {
  const key = symbol.toLowerCase();
  let e = logoCache.get(key);
  if (!e) {
    const img = new Image();
    const entry = { img, ok: false };
    const urls = [
      `https://assets.coincap.io/assets/icons/${encodeURIComponent(key)}@2x.png`,
      `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${encodeURIComponent(key)}.png`,
    ];
    let i = 0;
    img.onload = () => { entry.ok = true; };
    img.onerror = () => { if (++i < urls.length) img.src = urls[i]; };
    img.src = urls[0];
    logoCache.set(key, entry);
    e = entry;
  }
  return e.ok ? e.img : null;
}

function pctClass(v: number) {
  return v > 0 ? "gain" : v < 0 ? "loss" : "";
}

export default function BubbleChart({ coins, timeframe, sizeBy, query }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<BubbleNode, undefined> | null>(null);
  const nodesRef = useRef(new Map<string, BubbleNode>());
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<BubbleNode | null>(null);
  const reduceRef = useRef(false);
  const syncRef = useRef<() => void>(() => {});
  const latest = useRef({ coins, timeframe, sizeBy });
  const queryRef = useRef("");
  queryRef.current = query.trim().toLowerCase();
  const [tip, setTip] = useState<Tip | null>(null);
  const [selected, setSelected] = useState<Coin | null>(null);
  const downRef = useRef({ x: 0, y: 0 });

  latest.current = { coins, timeframe, sizeBy };

  // Khởi tạo simulation, vòng lặp vẽ và theo dõi kích thước khung
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceRef.current = reduce;
    // d3 chỉ dùng làm kho chứa node; chuyển động do vật lý tự viết bên dưới
    const sim = forceSimulation<BubbleNode>([]).velocityDecay(0).stop();
    simRef.current = sim;

    // Đồng bộ dữ liệu coin -> node, giữ vị trí cũ để bubble không nhảy
    syncRef.current = () => {
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;
      const { coins, timeframe, sizeBy } = latest.current;
      const radii = computeRadii(coins, timeframe, sizeBy, w, h);
      const map = nodesRef.current;
      const seen = new Set<string>();
      for (const c of coins) {
        seen.add(c.id);
        const targetR = radii.get(c.id) ?? 13;
        const existing = map.get(c.id);
        const c_r = targetR;
        if (existing) {
          existing.coin = c;
          existing.targetR = targetR;
        } else {
          map.set(c.id, {
            id: c.id,
            coin: c,
            r: reduce ? targetR : 2,
            targetR,
            vx: (Math.random() - 0.5) * 30,
            vy: (Math.random() - 0.5) * 30,
            x: c_r + Math.random() * Math.max(w - 2 * c_r, 1),
            y: c_r + Math.random() * Math.max(h - 2 * c_r, 1),
          });
        }
      }
      for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
      sim.nodes([...map.values()]);
    };

    const draw = () => {
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const tf = latest.current.timeframe;
      const hovered = hoverRef.current;

      const drawOne = (n: BubbleNode) => {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const ch = changeFor(n.coin, tf);
        const col = bubbleColors(ch, tf);
        const isHover = n.id === hovered;
        const q = queryRef.current;
        const match =
          !q || n.coin.symbol.toLowerCase().includes(q) || n.coin.name.toLowerCase().includes(q);
        ctx.save();
        ctx.globalAlpha = match ? 1 : 0.12;

        // Thân bubble: gradient xuyên tâm tối ở giữa, sáng dần ra rìa + viền phát sáng
        // Hiệu ứng 3D: chỉ tô màu ở viền, mờ dần thành trong suốt vào tâm
        const alpha = (c: string, a: number) => c.replace("hsl(", "hsla(").replace(")", `, ${a})`);
        const grad = ctx.createRadialGradient(x, y, n.r * 0.62, x, y, n.r);
        grad.addColorStop(0, alpha(col.outer, 0));
        grad.addColorStop(0.55, alpha(col.outer, 0.08));
        grad.addColorStop(0.85, alpha(col.outer, 0.5));
        grad.addColorStop(1, alpha(col.outer, 0.95));
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = col.glowBlur;
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
        // Không có viền; chỉ vẽ vòng trắng khi hover hoặc khớp kết quả tìm kiếm
        if (isHover || (q && match)) {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(n.r - 1, 0), 0, Math.PI * 2);
          ctx.lineWidth = isHover ? 3 : 2;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }

        const sym = n.coin.symbol.toUpperCase();
        const pct = fmtPct(ch);
        const r = n.r;
        // Cỡ chữ scale theo bán kính, bị giới hạn bởi bề rộng bubble
        const size = Math.min(r * 0.36, (r * 1.55) / (sym.length * 0.62));
        if (size < 3.5) {
          ctx.restore();
          return;
        }
        const ps = Math.max(size * 0.72, 3.5);
        const img = r >= 24 ? getLogo(n.coin.symbol) : null;
        const logo = img ? r * 0.44 : 0;
        const gap = size * 0.18;
        const total = (logo ? logo + gap : 0) + size + gap + ps;
        let cy = y - total / 2;
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, cy + logo / 2, logo / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, x - logo / 2, cy, logo, logo);
          ctx.restore();
          cy += logo + gap;
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = `600 ${size}px ${FONT}`;
        ctx.fillText(sym, x, cy + size / 2);
        ctx.font = `500 ${ps}px ${FONT}`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillText(pct, x, cy + size + gap + ps / 2);
        ctx.restore();
      };

      const nodes = sim.nodes();
      for (const n of nodes) if (n.id !== hovered) drawOne(n);
      const hn = hovered ? nodesRef.current.get(hovered) : undefined;
      if (hn) drawOne(hn); // bubble đang hover vẽ sau cùng để nằm trên
    };

    let raf = 0;
    const randomVelocity = () => {
      const a = Math.random() * Math.PI * 2;
      const v = MIN_SPEED + Math.random() * 15;
      return [Math.cos(a) * v, Math.sin(a) * v] as const;
    };

    // Vật lý: di chuyển, nảy tường, va chạm đàn hồi giữa các bubble (khối lượng ~ r²)
    const step = (dt: number) => {
      const { w, h } = sizeRef.current;
      const nodes = sim.nodes();
      for (const n of nodes) {
        n.r += (n.targetR - n.r) * (reduce ? 1 : 0.12);
        if (n.fx != null && n.fy != null) {
          // đang bị kéo: bám theo con trỏ và ghi lại vận tốc để "ném" khi thả
          const nvx = (n.fx - (n.x ?? 0)) / dt;
          const nvy = (n.fy - (n.y ?? 0)) / dt;
          n.vx = (n.vx ?? 0) * 0.6 + nvx * 0.4;
          n.vy = (n.vy ?? 0) * 0.6 + nvy * 0.4;
          n.x = n.fx;
          n.y = n.fy;
          continue;
        }
        if (reduce) continue;
        let vx = n.vx ?? 0;
        let vy = n.vy ?? 0;
        // dao động ngẫu nhiên nhẹ để chuyển động tự nhiên
        vx += (Math.random() - 0.5) * 30 * dt * 3;
        vy += (Math.random() - 0.5) * 30 * dt * 3;
        let sp = Math.hypot(vx, vy);
        if (sp < 1e-6) [vx, vy] = randomVelocity();
        sp = Math.hypot(vx, vy);
        const target = Math.min(Math.max(sp, MIN_SPEED), MAX_SPEED);
        // đưa tốc độ từ từ về khoảng [MIN, MAX]
        const k = 1 + ((target / sp) - 1) * Math.min(1, dt * 3);
        n.vx = vx * k;
        n.vy = vy * k;
        n.x = (n.x ?? 0) + n.vx * dt;
        n.y = (n.y ?? 0) + n.vy * dt;
      }

      for (let iter = 0; iter < 2; iter++) {
        // va chạm với tường -> bật ngược
        for (const n of nodes) {
          const r = n.r;
          if ((n.x ?? 0) < r) { n.x = r; n.vx = Math.abs(n.vx ?? 0); }
          else if ((n.x ?? 0) > w - r) { n.x = Math.max(w - r, r); n.vx = -Math.abs(n.vx ?? 0); }
          if ((n.y ?? 0) < r) { n.y = r; n.vy = Math.abs(n.vy ?? 0); }
          else if ((n.y ?? 0) > h - r) { n.y = Math.max(h - r, r); n.vy = -Math.abs(n.vy ?? 0); }
        }
        // va chạm giữa các bubble
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = (b.x ?? 0) - (a.x ?? 0);
            let dy = (b.y ?? 0) - (a.y ?? 0);
            const min = a.r + b.r;
            if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
            let d = Math.hypot(dx, dy);
            if (d >= min) continue;
            if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
            const nx = dx / d;
            const ny = dy / d;
            const aFixed = a.fx != null;
            const bFixed = b.fx != null;
            const ma = aFixed ? 1e9 : a.r * a.r;
            const mb = bFixed ? 1e9 : b.r * b.r;
            // tách chồng lấn theo tỉ lệ nghịch khối lượng
            const overlap = min - d;
            const wa = mb / (ma + mb);
            const wb = ma / (ma + mb);
            if (!aFixed) { a.x = (a.x ?? 0) - nx * overlap * wa; a.y = (a.y ?? 0) - ny * overlap * wa; }
            if (!bFixed) { b.x = (b.x ?? 0) + nx * overlap * wb; b.y = (b.y ?? 0) + ny * overlap * wb; }
            // xung lượng đàn hồi dọc pháp tuyến
            const rvx = (b.vx ?? 0) - (a.vx ?? 0);
            const rvy = (b.vy ?? 0) - (a.vy ?? 0);
            const vn = rvx * nx + rvy * ny;
            if (vn >= 0) continue; // đang tách ra
            const jImp = (-2 * vn) / (1 / ma + 1 / mb);
            if (!aFixed) { a.vx = (a.vx ?? 0) - (jImp / ma) * nx; a.vy = (a.vy ?? 0) - (jImp / ma) * ny; }
            if (!bFixed) { b.vx = (b.vx ?? 0) + (jImp / mb) * nx; b.vy = (b.vy ?? 0) + (jImp / mb) * ny; }
          }
        }
      }
    };

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const old = sizeRef.current;
      if (old.w > 0 && old.h > 0) {
        // giữ bubble phân bố đều khi đổi kích thước khung
        for (const n of sim.nodes()) {
          n.x = ((n.x ?? 0) / old.w) * rect.width;
          n.y = ((n.y ?? 0) / old.h) * rect.height;
        }
      }
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      syncRef.current();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sim.stop();
      simRef.current = null;
    };
  }, []);

  // Dữ liệu / timeframe / kiểu kích thước đổi -> tính lại bán kính
  useEffect(() => {
    syncRef.current();
  }, [coins, timeframe, sizeBy]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pick = (x: number, y: number): BubbleNode | null => {
    const nodes = simRef.current?.nodes() ?? [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (Math.hypot((n.x ?? 0) - x, (n.y ?? 0) - y) <= n.r) return n;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e);
    const n = pick(x, y);
    hoverRef.current = n?.id ?? null;
    setTip(n ? { coin: n.coin, x, y } : null);
    if (!n) return;
    downRef.current = { x, y };
    dragRef.current = n;
    n.fx = x;
    n.fy = y;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e);
    const dragged = dragRef.current;
    if (dragged) {
      dragged.fx = x;
      dragged.fy = y;
    }
    const n = dragged ?? pick(x, y);
    hoverRef.current = n?.id ?? null;
    e.currentTarget.style.cursor = dragged ? "grabbing" : n ? "grab" : "default";
    setTip(n ? { coin: n.coin, x, y } : null);
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dragged = dragRef.current;
    if (!dragged) return;
    const { x, y } = pos(e);
    // Nhấp (gần như không kéo) -> mở biểu đồ giá
    if (Math.hypot(x - downRef.current.x, y - downRef.current.y) < 5) {
      setSelected(dragged.coin);
      setTip(null);
    }
    dragged.fx = null;
    dragged.fy = null;
    dragRef.current = null;
    e.currentTarget.style.cursor = "grab";
  };

  const onLeave = () => {
    if (dragRef.current) return;
    hoverRef.current = null;
    setTip(null);
  };

  const { w, h } = sizeRef.current;
  const tipStyle = tip
    ? {
        left: Math.max(8, Math.min(tip.x + 14, w - 216)),
        top: Math.max(8, Math.min(tip.y + 14, h - 150)),
      }
    : undefined;

  return (
    <div className="chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="canvas"
        role="img"
        aria-label="Bubble chart of the top 100 cryptocurrencies"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
      />
      {selected && <PriceChart coin={selected} timeframe={timeframe} onClose={() => setSelected(null)} />}
      {tip && !selected && (
        <div className="tip" style={tipStyle}>
          <div className="tip-head">
            <strong>{tip.coin.name}</strong>
            <span>{tip.coin.symbol.toUpperCase()}</span>
          </div>
          <dl>
            <dt>Price</dt>
            <dd>{fmtPrice(tip.coin.price)}</dd>
            <dt>Market cap</dt>
            <dd>{fmtCap(tip.coin.marketCap)}</dd>
            <dt>1h</dt>
            <dd className={pctClass(tip.coin.change1h)}>{fmtPct(tip.coin.change1h)}</dd>
            <dt>24h</dt>
            <dd className={pctClass(tip.coin.change24h)}>{fmtPct(tip.coin.change24h)}</dd>
            <dt>7d</dt>
            <dd className={pctClass(tip.coin.change7d)}>{fmtPct(tip.coin.change7d)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
