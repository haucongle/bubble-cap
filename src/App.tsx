import { useEffect, useMemo, useRef, useState } from "react";
import BubbleChart from "./BubbleChart";
import { STABLECOINS } from "./utils";
import SourcePicker from "./SourcePicker";
import { clearMarketCache, loadView } from "./market";
import type { CoinsFile, Timeframe } from "./types";

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
  const [exchange, setExchange] = useState("binance");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    const load = async () => {
      try {
        const json = await loadView(exchange, page);
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [exchange, page, reloadKey]);

  const fetchLatest = () => {
    clearMarketCache();
    setReloadKey((k) => k + 1);
  };

  const coins = useMemo(
    () =>
      data
        ? data.coins
            .filter((c) => !hideStable || !STABLECOINS.has(c.symbol.toUpperCase()))
            .sort((a, b) => a.rank - b.rank)
        : [],
    [data, hideStable],
  );

  const updated = data
    ? new Date(data.updatedAt).toLocaleString([], {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
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
          <SourcePicker
            exchange={exchange}
            page={page}
            onChange={(ex, p) => {
              setExchange(ex);
              setPage(p);
            }}
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
        <div className="meta">
          <button type="button" className="fetch-btn" onClick={fetchLatest} disabled={loading}>
            {loading ? "Fetching…" : "Fetch latest"}
          </button>
          {error && data && <span className="fetch-err"> Fetch failed: {error}</span>}
          {data && (
            <span>
              {" "}
              Updated {updated} from {data.source}
            </span>
          )}
        </div>
      </header>

      {data ? (
        <BubbleChart coins={coins} timeframe={timeframe} exchange={exchange} query={query} />
      ) : (
        <div className="chart status" role="status">
          {error
            ? `Couldn't load prices (${error}). Try Fetch latest.`
            : "Loading prices…"}
        </div>
      )}
    </div>
  );
}
