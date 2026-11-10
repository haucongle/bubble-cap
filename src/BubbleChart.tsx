import { useEffect, useRef, useState } from "react";
import { forceCollide, forceSimulation, forceX, forceY } from "d3-force";
import type { Simulation, SimulationNodeDatum } from "d3-force";
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
}

interface Tip {
  coin: Coin;
  x: number;
  y: number;
}

const IDLE_ALPHA = 0.012; // giữ simulation "sống" nhẹ để bubble trôi lơ lửng
const FONT = '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif';

function pctClass(v: number) {
  return v > 0 ? "gain" : v < 0 ? "loss" : "";
}

export default function BubbleChart({ coins, timeframe, sizeBy }: Props) {
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
  const [tip, setTip] = useState<Tip | null>(null);

  latest.current = { coins, timeframe, sizeBy };

  // Khởi tạo simulation, vòng lặp vẽ và theo dõi kích thước khung
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceRef.current = reduce;

    const fx = forceX<BubbleNode>(0).strength(0.05);
    const fy = forceY<BubbleNode>(0).strength(0.06);
    // forceCollide chỉ tính bán kính một lần khi khởi tạo, mà r của ta đang animate,
    // nên mỗi frame phải gọi lại collide.radius(...) để nó cập nhật bán kính mới.
    const collide = forceCollide<BubbleNode>().strength(0.9).iterations(2);
    const applyRadius = () => collide.radius((d) => d.r + 1.5);
    applyRadius();
    const sim = forceSimulation<BubbleNode>([])
      .force("x", fx)
      .force("y", fy)
      .force("collide", collide)
      .velocityDecay(0.32)
      .alphaTarget(reduce ? 0 : IDLE_ALPHA)
      .stop(); // tự gọi sim.tick() trong requestAnimationFrame
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
        if (existing) {
          existing.coin = c;
          existing.targetR = targetR;
        } else {
          map.set(c.id, {
            id: c.id,
            coin: c,
            r: reduce ? targetR : 2,
            targetR,
            x: w / 2 + (Math.random() - 0.5) * w * 0.4,
            y: h / 2 + (Math.random() - 0.5) * h * 0.4,
          });
        }
      }
      for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
      sim.nodes([...map.values()]);
      sim.alpha(Math.max(sim.alpha(), 0.5));
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

        ctx.beginPath();
        ctx.arc(x, y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = col.fill;
        ctx.fill();
        ctx.lineWidth = isHover ? 2.5 : 1.25;
        ctx.strokeStyle = isHover ? "#e8edf5" : col.stroke;
        ctx.stroke();

        const sym = n.coin.symbol.toUpperCase();
        const size = Math.min(n.r * 0.5, (n.r * 1.7) / (sym.length * 0.62), 28);
        if (size < 8) return;
        const showPct = n.r >= 26;
        ctx.fillStyle = "#e8edf5";
        ctx.font = `600 ${size}px ${FONT}`;
        ctx.fillText(sym, x, showPct ? y - size * 0.3 : y);
        if (showPct) {
          ctx.font = `500 ${Math.max(size * 0.7, 9)}px ${FONT}`;
          ctx.fillStyle = "rgba(232, 237, 245, 0.8)";
          ctx.fillText(fmtPct(ch), x, y + size * 0.6);
        }
      };

      const nodes = sim.nodes();
      for (const n of nodes) if (n.id !== hovered) drawOne(n);
      const hn = hovered ? nodesRef.current.get(hovered) : undefined;
      if (hn) drawOne(hn); // bubble đang hover vẽ sau cùng để nằm trên
    };

    let raf = 0;
    const frame = () => {
      const { w, h } = sizeRef.current;
      const nodes = sim.nodes();
      for (const n of nodes) n.r += (n.targetR - n.r) * (reduce ? 1 : 0.12);
      applyRadius();
      sim.tick();
      for (const n of nodes) {
        // giữ bubble trong khung
        n.x = Math.min(Math.max(n.x ?? 0, n.r), Math.max(w - n.r, n.r));
        n.y = Math.min(Math.max(n.y ?? 0, n.r), Math.max(h - n.r, n.r));
      }
      draw();
      raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      fx.x(rect.width / 2);
      fy.y(rect.height / 2);
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
    dragRef.current = n;
    n.fx = x;
    n.fy = y;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
    simRef.current?.alphaTarget(0.25);
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
    dragged.fx = null;
    dragged.fy = null;
    dragRef.current = null;
    e.currentTarget.style.cursor = "grab";
    simRef.current?.alphaTarget(reduceRef.current ? 0 : IDLE_ALPHA);
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
      {tip && (
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
