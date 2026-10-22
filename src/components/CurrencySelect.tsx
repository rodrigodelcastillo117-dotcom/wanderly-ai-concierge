import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { currencyLabel, matchesCurrency, orderedCurrencies, type CurrencyInfo } from "@/lib/currencies";

type Props = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  /** Moneda del destino del viaje: sale arriba como "Sugerida para tu viaje". */
  suggested?: string | null;
  /** Monedas de los gastos ya registrados: las más usadas suben. */
  used?: string[];
  /** Para formularios sin <label for>. */
  ariaLabel?: string;
  className?: string;
};

/**
 * Selector de moneda con búsqueda. Es un <select> nativo (en el celular abre el selector del
 * sistema y funciona con lector de pantalla) con un buscador encima que filtra la lista por
 * código, nombre o país ("yen", "JPY", "Japón").
 */
export function CurrencySelect({ id, value, onChange, suggested, used, ariaLabel, className }: Props) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => orderedCurrencies({ suggested, used }), [suggested, used]);
  const filter = (list: CurrencyInfo[]) => list.filter((c) => c.code === value || matchesCurrency(c, q));
  const sug = groups.suggested && filter([groups.suggested]);
  const frequent = filter(groups.frequent);
  const rest = filter(groups.rest);
  const known = [groups.suggested, ...groups.frequent, ...groups.rest].some((c) => c?.code === value);
  const nothing = !!q.trim() && ![groups.suggested, ...groups.frequent, ...groups.rest].some((c) => c && matchesCurrency(c, q));

  const pick = (code: string) => {
    onChange(code);
    setQ("");
  };

  return (
    <div className={className}>
      <div className="relative mb-1.5">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            const nq = e.target.value;
            setQ(nq);
            // Si la búsqueda deja una sola moneda, se elige sola (escribir "yen" basta).
            const all = [...(groups.suggested ? [groups.suggested] : []), ...groups.frequent, ...groups.rest];
            const hits = all.filter((c) => matchesCurrency(c, nq));
            if (nq.trim() && hits.length === 1) onChange(hits[0].code);
          }}
          placeholder="Buscar moneda o país"
          aria-label="Buscar moneda"
          aria-controls={id}
          className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs"
        />
      </div>
      <select
        id={id}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => pick(e.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {!known && value && <option value={value}>{currencyLabel(value)}</option>}
        {sug && sug.length > 0 && (
          <optgroup label="Sugerida para tu viaje">
            {sug.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c.code)}</option>)}
          </optgroup>
        )}
        {frequent.length > 0 && (
          <optgroup label="Más usadas">
            {frequent.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c.code)}</option>)}
          </optgroup>
        )}
        {rest.length > 0 && (
          <optgroup label="Todas las monedas">
            {rest.map((c) => <option key={c.code} value={c.code}>{currencyLabel(c.code)}</option>)}
          </optgroup>
        )}
      </select>
      {nothing && <p className="text-[11px] text-muted-foreground mt-1">No encontramos esa moneda.</p>}
    </div>
  );
}
