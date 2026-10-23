// Campo con sugerencias de ciudades (catálogo de aeropuertos y la lista curada) y países. Accesible:
// role="combobox", flechas, Enter y Escape. Escribir no consulta nada en la red.
import { useId, useMemo, useState } from "react";
import { MapPin, Globe2 } from "lucide-react";
import { searchPlaces, type PlaceOption } from "@/lib/exploreFlights";

export function PlaceCombobox({ label, value, onChange, placeholder, citiesOnly = false, icon, className = "", inputClassName = "" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  citiesOnly?: boolean;
  icon?: React.ReactNode;
  className?: string;
  inputClassName?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = useMemo(
    () => (open ? searchPlaces(value, 8).filter((o) => !citiesOnly || o.kind === "city") : []),
    [open, value, citiesOnly],
  );
  const pick = (o: PlaceOption) => {
    onChange(o.value);
    setOpen(false);
  };
  const listId = `${id}-lista`;
  return (
    <div className={`relative min-w-0 ${className}`}>
      <label htmlFor={`${id}-in`} className="sr-only">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-black/40 px-3 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40">
        <span aria-hidden className="text-primary/80 shrink-0">{icon ?? <MapPin className="h-4 w-4" />}</span>
        <input
          id={`${id}-in`}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-op-${active}` : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder ?? label}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!open || !options.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
            else if (e.key === "Enter") { e.preventDefault(); pick(options[active]); }
            else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
          }}
          className={`h-12 w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none ${inputClassName}`}
        />
      </div>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" aria-label={label}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-primary/20 bg-[#0b0b0b] p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]">
          {options.map((o, i) => (
            <li key={`${o.kind}-${o.value}`} id={`${id}-op-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-primary/10 text-foreground" : "text-foreground/90"}`}>
              {o.kind === "country" ? <Globe2 aria-hidden className="h-4 w-4 text-primary/80 shrink-0" /> : <MapPin aria-hidden className="h-4 w-4 text-primary/60 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{o.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
