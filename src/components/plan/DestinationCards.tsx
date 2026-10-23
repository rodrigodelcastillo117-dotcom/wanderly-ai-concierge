// Tarjetas de "Vuelos baratos desde…" y filas de "Explorar destinos". Cada precio dice de dónde
// salió y cuándo: "desde $X MXN · consultado HH:MM", su frescura y que es precio de referencia.
import { Plane } from "lucide-react";
import { SmartImage } from "@/components/media/SmartImage";
import {
  consultedHHMM, dateRangeShort, durationLabel, freshnessLabel, priceLabel, shortCity, stopsLabel, type ExploreDestino,
} from "@/lib/exploreFlights";

export function FareCard({ origin, d, consultadoAt, onOpen }: {
  origin: string; d: ExploreDestino; consultadoAt: string | null; onOpen: () => void;
}) {
  const meta = [dateRangeShort(d.salida, d.regreso), stopsLabel(d.escalas)].filter(Boolean).join(" · ");
  const price = priceLabel(d, consultadoAt);
  return (
    <button type="button" onClick={onOpen} data-testid="fare-card"
      aria-label={`${shortCity(origin)} a ${d.destino}${meta ? `, ${meta}` : ""}, ${price}. Abrir la búsqueda de este vuelo`}
      className="group flex w-full min-w-0 flex-col gap-1 rounded-2xl border border-primary/15 bg-gradient-to-b from-white/[0.03] to-transparent p-3.5 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
        <span className="truncate">{shortCity(origin)}</span>
        <Plane aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate">{d.destino}</span>
      </span>
      {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      <span className={`text-sm ${d.precio_mxn != null ? "text-primary" : "text-muted-foreground"}`}>{price}</span>
      {d.precio_mxn != null && (
        <span className="text-[11px] leading-snug text-muted-foreground">Precio de referencia · {freshnessLabel(consultadoAt)}</span>
      )}
    </button>
  );
}

export function DestinationRow({ d, consultadoAt, selected, onOpen, onHover }: {
  d: ExploreDestino; consultadoAt: string | null; selected?: boolean; onOpen: () => void; onHover?: () => void;
}) {
  const dates = dateRangeShort(d.salida, d.regreso);
  const facts = [stopsLabel(d.escalas), durationLabel(d.duracion_min), d.aerolinea].filter(Boolean).join(" · ");
  return (
    <li>
      <button type="button" onClick={onOpen} onMouseEnter={onHover} onFocus={onHover} data-testid="explore-row"
        aria-label={`${d.destino}${d.pais ? `, ${d.pais}` : ""}. ${priceLabel(d, consultadoAt)}. Abrir la búsqueda de este vuelo`}
        className={`flex w-full min-w-0 items-stretch gap-3 rounded-2xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? "border-primary/50 bg-primary/[0.06]" : "border-border/50 hover:border-primary/30"}`}>
        <SmartImage alt={d.destino} imageUrl={d.foto} imageKind="real" stockQuery={d.foto ? null : `${d.destino} ${d.pais ?? ""}`.trim()}
          size="thumb" className="h-20 w-24 shrink-0 rounded-xl" />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="break-words text-sm font-medium leading-snug text-foreground">{d.destino}</span>
          {d.pais && <span className="truncate text-xs text-muted-foreground">{d.pais}</span>}
          {dates && <span className="text-xs text-foreground/80">{dates}</span>}
          {facts && <span className="truncate text-xs text-muted-foreground">{facts}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end justify-center gap-0.5 text-right">
          {d.precio_mxn != null ? (
            <>
              <span className="text-sm font-medium text-primary">{priceLabel(d, null)}</span>
              <span className="max-w-[9rem] text-[11px] leading-snug text-muted-foreground">{[consultedHHMM(consultadoAt), "referencia"].filter(Boolean).join(" · ")}</span>
              <span className="max-w-[9rem] text-[11px] leading-snug text-muted-foreground">{freshnessLabel(consultadoAt)}</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Sin precio ahora</span>
          )}
        </span>
      </button>
    </li>
  );
}
