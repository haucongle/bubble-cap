import { useEffect, useMemo, useRef, useState } from "react";
import BubbleChart from "./BubbleChart";
import { STABLECOINS } from "./utils";
import type { CoinsFile, SizeBy, Timeframe } from "./types";

const REFRESH_MS = 5 * 60 * 1000;

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; text: string }[];
  onChange: (v: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<CoinsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("24h");
  const [sizeBy, setSizeBy] = useState<SizeBy>("movement");
  const [hideStable, setHideStable] = useState(true);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd + K để focus ô tìm kiếm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const url = `${import.meta.env.BASE_URL}data/coins.json?t=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as CoinsFile;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const coins = useMemo(
    () =>
      data ? data.coins.filter((c) => !hideStable || !STABLECOINS.has(c.symbol.toUpperCase())) : [],
    [data, hideStable],
  );

  const updated = data
    ? new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="app">
      <header className="bar">
        <h1>Bubblecap</h1>
        <div className="search">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search token…"
            aria-label="Search token"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="controls">
          <Segmented<Timeframe>
            label="Change over"
            value={timeframe}
            onChange={setTimeframe}
            options={[
              { value: "1h", text: "1h" },
              { value: "24h", text: "24h" },
              { value: "7d", text: "7d" },
            ]}
          />
          <Segmented<SizeBy>
            label="Bubble size"
            value={sizeBy}
            onChange={setSizeBy}
            options={[
              { value: "movement", text: "Movement" },
              { value: "marketCap", text: "Market cap" },
            ]}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={hideStable}
              onChange={(e) => setHideStable(e.target.checked)}
            />
            Hide stablecoins
          </label>
        </div>
        {data && (
          <div className="meta">
            Updated {updated} from {data.source}
          </div>
        )}
      </header>

      {data ? (
        <BubbleChart coins={coins} timeframe={timeframe} sizeBy={sizeBy} query={query} />
      ) : (
        <div className="chart status" role="status">
          {error
            ? "Couldn't load prices. Run `npm run fetch` to create public/data/coins.json, then reload."
            : "Loading prices…"}
        </div>
      )}
    </div>
  );
}
