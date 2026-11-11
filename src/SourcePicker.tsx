import { useEffect, useReducer, useRef, useState } from "react";
import { PAGE_SIZE, SOURCES, onMarketUpdate, pageCount } from "./market";

interface Props {
  exchange: string;
  page: number;
  onChange: (exchange: string, page: number) => void;
}

const pageLabel = (p: number) => `${(p - 1) * PAGE_SIZE + 1} - ${p * PAGE_SIZE}`;
export default function SourcePicker({ exchange, page, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Cập nhật số trang khi danh sách của sàn tải xong
  useEffect(() => onMarketUpdate(rerender), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const exName = SOURCES.find((e) => e.id === exchange)?.name ?? exchange;

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {exName} · {pageLabel(page)} <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="picker-panel" role="dialog" aria-label="Pages and exchanges">
          <div className="picker-col">
            <div className="picker-head">Pages</div>
            {Array.from({ length: pageCount(exchange) }, (_, i) => i + 1).map((p) => (
              <label key={p} className={`picker-row${p === page ? " on" : ""}`}>
                <input
                  type="radio"
                  name="page"
                  checked={p === page}
                  onChange={() => onChange(exchange, p)}
                />
                <span className="radio" aria-hidden="true" />
                <span className="name">{pageLabel(p)}</span>
              </label>
            ))}
          </div>

          <div className="picker-col">
            <div className="picker-head">Exchanges</div>
            {SOURCES.map((e) => (
              <label key={e.id} className={`picker-row${e.id === exchange ? " on" : ""}`}>
                <input
                  type="radio"
                  name="exchange"
                  checked={e.id === exchange}
                  onChange={() => onChange(e.id, 1)}
                />
                <span className="radio" aria-hidden="true" />
                <span className="name">{e.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
