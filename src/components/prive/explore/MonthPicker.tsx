// Selector de mes (doce opciones, patrón radiogroup: flechas, Inicio y Fin). `allowAny` agrega "Cualquier mes".
import { useRef, type KeyboardEvent } from "react";
import { usePriveT } from "@/components/prive/PriveLang";

/** ?mes=1–12 → 0–11; sin valor válido, el mes que sigue (se planea con anticipación). */
export function parseMonth(v: string | null | undefined, today = new Date()): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n - 1 : (today.getMonth() + 1) % 12;
}

export function MonthPicker({ value, onChange, label, allowAny = false, anyLabel }: {
  value: number | null; onChange: (m: number | null) => void; label: string; allowAny?: boolean; anyLabel?: string;
}) {
  const t = usePriveT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const opts: (number | null)[] = [...(allowAny ? [null] : []), ...Array.from({ length: 12 }, (_, i) => i)];
  const idx = Math.max(0, opts.indexOf(value));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = opts.length;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (idx + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (idx - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(opts[to]);
    refs.current[to]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="pv-x-months" data-testid="prive-month-picker">
      {opts.map((m, i) => (
        <button key={m ?? "any"} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={i === idx} tabIndex={i === idx ? 0 : -1}
          aria-label={m == null ? anyLabel : t.map.months[m]} className="pv-x-chip" onClick={() => onChange(m)} onKeyDown={onKey}>
          {m == null ? anyLabel : t.map.monthsShort[m]}
        </button>
      ))}
    </div>
  );
}
