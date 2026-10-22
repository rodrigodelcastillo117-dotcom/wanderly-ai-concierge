import { useState } from "react";
import { motion } from "framer-motion";
import { Receipt, Lightbulb, ChevronDown, AlertTriangle, Clock, RefreshCw, BadgeCheck, Sparkles } from "lucide-react";
import type { QuoteTrust } from "@/lib/quoteTrust";

type Props = {
  trip: any;
  noches: number;
  /** Viajeros con los que se calculó el total (no los actuales si el usuario los cambió). */
  viajeros: number;
  onUpdated?: () => void;
  /** "Cotización para N viajeros del …; actualiza la cotización" cuando cambiaron viajeros/fechas. */
  staleMessage?: string | null;
  /** Fecha de la cotización y vigencia. */
  validityLabel?: string | null;
  validityExpired?: boolean;
  /** Tipo de cambio con que se cotizó, si se conoce. */
  fxNote?: string | null;
  onRequote?: () => void;
  /**
   * Desglose con las selecciones del usuario (vuelo, hotel, experiencias) cuando eligió algo
   * distinto de la cotización. null = sin selección: se muestra la cotización guardada.
   */
  selectionDesglose?: Record<string, number> | null;
  /** Cuánto de la cotización se consultó en vivo y cuánto es estimado (trip_quotes.line_items). */
  trust?: QuoteTrust | null;
};

const fmtMXN = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

/**
 * Total del viaje a partir de la cotización guardada. Nunca se recorta al presupuesto: si la
 * cotización lo rebasa se informa la diferencia (antes se mostraba el presupuesto como si fuera
 * el precio y se decía que la IA "ajustaba la selección", sin ajustar nada).
 */
export function tripTotals(trip: any, viajeros: number, selectionDesglose?: Record<string, number> | null) {
  const vuelos: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const hoteles: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const cruceros: any[] = Array.isArray(trip?.cruceros_json) ? trip.cruceros_json : [];

  const sumNumber = (n: any) => Number(n) || 0;
  const desglose = trip?.desglose_presupuesto ?? {};
  const explicitBreakdownTotal = Object.values(desglose).reduce((s: number, v) => s + sumNumber(v), 0);

  const totalVuelos = vuelos.reduce((s, v) => {
    if (v.precio_total) return s + sumNumber(v.precio_total);
    if (v.precio_por_persona) return s + sumNumber(v.precio_por_persona) * viajeros;
    return s;
  }, 0);

  const totalHoteles = hoteles.reduce((s, h) => {
    if (h.costo_cero) return s;
    if (h.precio_total) return s + sumNumber(h.precio_total);
    if (h.precio_por_noche && h.noches) return s + sumNumber(h.precio_por_noche) * sumNumber(h.noches);
    return s;
  }, 0);

  const totalCruceros = cruceros.reduce((s, c) => {
    if (c.precio_total) return s + sumNumber(c.precio_total);
    if (c.precio_por_persona) return s + sumNumber(c.precio_por_persona) * viajeros;
    return s;
  }, 0);

  const itemSubtotal = totalVuelos + totalHoteles + totalCruceros;
  const quotedTotal = sumNumber(trip?.total_estimado) || explicitBreakdownTotal || itemSubtotal;
  // Con selección del usuario (E-12) el total es el de su selección; la cotización guardada se
  // conserva aparte para decir de cuánto era.
  const fromSelection = !!selectionDesglose && Object.keys(selectionDesglose).length > 0;
  const total = fromSelection
    ? Object.values(selectionDesglose!).reduce((s: number, v) => s + sumNumber(v), 0)
    : quotedTotal;
  const presupuesto = sumNumber(trip?.presupuesto_objetivo);
  const excedente = presupuesto > 0 && total > presupuesto ? total - presupuesto : 0;
  const porPersona = viajeros > 0 ? total / viajeros : total;
  return { total, porPersona, presupuesto, excedente, quotedTotal, fromSelection };
}

export function RealTripTotal({ trip, noches, viajeros, staleMessage, validityLabel, validityExpired, fxNote, onRequote, selectionDesglose, trust }: Props) {


  const { total, porPersona, presupuesto, excedente, quotedTotal, fromSelection } = tripTotals(trip, viajeros, selectionDesglose);

  const [showAnalisis, setShowAnalisis] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-5 sm:p-8 md:p-10 mb-8 relative overflow-hidden max-w-full"
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <p className="text-xs tracking-[0.2em] uppercase text-primary">Total de tu viaje</p>
        {/* Solo se habla de presupuesto si el usuario puso uno ("cotización base respetada" no
            le decía nada a nadie). */}
        {presupuesto > 0 && (
          <span className={`text-[10px] tracking-widest uppercase inline-flex items-center gap-1 ${excedente > 0 ? "text-amber-500" : "text-muted-foreground"}`}>
            <Receipt className="w-3 h-3 text-primary" />
            {excedente > 0 ? "Rebasa tu presupuesto" : "Dentro de tu presupuesto"}
          </span>
        )}
      </div>

      {/* El total de TODO el viaje es la cifra grande; el precio por persona va debajo, con su
          etiqueta. Antes la cifra grande era "/persona" y el dueño no sabía si era por 1 o por 2. */}
      <p className="text-sm text-muted-foreground" data-testid="trip-total-label">
        {viajeros > 1 ? `Total para ${viajeros} personas` : "Total para 1 persona"}
      </p>
      <p className="font-display text-4xl sm:text-5xl md:text-6xl gold-text mb-1 leading-tight break-words" data-testid="trip-total-amount"
        aria-label={`${viajeros > 1 ? `Total para ${viajeros} personas` : "Total para 1 persona"}: ${fmtMXN(total)}`}>
        {fmtMXN(total)}
      </p>
      {viajeros > 1 && (
        <p className="text-base text-foreground/90 mb-1" data-testid="trip-total-pp">
          {fmtMXN(porPersona)} <span className="text-muted-foreground">por persona</span>
        </p>
      )}
      <p className="text-sm text-muted-foreground mb-1">
        {noches} {noches === 1 ? "noche" : "noches"}
      </p>
      <p className="text-[11px] text-muted-foreground/80 mb-2 italic">
        {fromSelection
          ? `Total con tu selección de vuelo, hotel o experiencias (estimado con los precios de la cotización de ${fmtMXN(quotedTotal)}).`
          : "Total de la cotización guardada; no se agregan extras automáticos."}
      </p>
      {validityLabel && (
        <p className={`text-[11px] mb-2 inline-flex items-center gap-1 ${validityExpired ? "text-amber-500" : "text-muted-foreground"}`}>
          <Clock className="w-3 h-3 shrink-0" /> {validityLabel}
        </p>
      )}
      {fxNote && <p className="text-[10px] text-muted-foreground/80 mb-2">{fxNote}</p>}
      {staleMessage && (
        <div role="alert" className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-500 flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="flex items-start gap-2 flex-1">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{staleMessage}. {fromSelection
              ? "El total de arriba ya suma tu selección; los precios se confirman al actualizar la cotización."
              : viajeros > 1 ? "El total y el precio por persona de arriba son los de esa cotización." : "El total de arriba es el de esa cotización."}</span>
          </span>
          {onRequote && (
            <button type="button" onClick={onRequote}
              className="inline-flex items-center justify-center gap-1 rounded-full border border-amber-500/50 px-3 py-1.5 text-[11px] font-medium hover:bg-amber-500/10 shrink-0">
              <RefreshCw className="w-3 h-3" /> Actualizar cotización
            </button>
          )}
        </div>
      )}
      {excedente > 0 && (
        <p className="text-xs text-amber-500 mb-2" role="status">
          Esta cotización rebasa tu presupuesto de {fmtMXN(presupuesto)} por {fmtMXN(excedente)}. Puedes editar el
          viaje (fechas, hotel o actividades) para acercarlo.
        </p>
      )}

      {/* Qué está verificado y qué es estimado (de los renglones de la cotización guardada). */}
      {trust && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3 sm:p-4" aria-label="Qué tan confiable es este total">
          {trust.known ? (
            <>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                {trust.verified > 0 && <span className="h-full bg-primary" style={{ width: `${(trust.verified / (trust.verified + trust.estimated + trust.toVerify)) * 100}%` }} />}
                {trust.toVerify > 0 && <span className="h-full bg-amber-500/80" style={{ width: `${(trust.toVerify / (trust.verified + trust.estimated + trust.toVerify)) * 100}%` }} />}
                {trust.estimated > 0 && <span className="h-full bg-white/25" style={{ width: `${(trust.estimated / (trust.verified + trust.estimated + trust.toVerify)) * 100}%` }} />}
              </div>
              <p className="mt-2 text-xs text-foreground/90">{fromSelection ? "De la cotización guardada: " : ""}{trust.summary}</p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-[11px] text-muted-foreground">
                {trust.lines.map((l) => (
                  <li key={l.category} className="flex items-center justify-between gap-2" data-trust={l.trust}>
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      {l.trust === "verificado"
                        ? <BadgeCheck className="w-3 h-3 text-primary shrink-0" aria-hidden />
                        : l.trust === "por_verificar"
                          ? <Clock className="w-3 h-3 text-amber-500 shrink-0" aria-hidden />
                          : <Sparkles className="w-3 h-3 shrink-0" aria-hidden />}
                      <span className="truncate">{l.label}</span>
                      <span className="text-muted-foreground/70">· {l.trust === "verificado" ? "en vivo" : l.trust === "por_verificar" ? "por verificar" : "estimado"}</span>
                    </span>
                    <span className="text-foreground/80 tabular-nums">{fmtMXN(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{trust.summary}</p>
          )}
        </div>
      )}

      {/* Análisis del concierge integrado en la misma tarjeta */}
      {trip?.analisis_ai && (
        <div className="mt-6 pt-5 border-t border-border/40">
          <button
            type="button"
            onClick={() => setShowAnalisis((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <div className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              <span className="text-xs tracking-[0.2em] uppercase text-primary">
                Análisis de tu concierge
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-primary transition-transform ${showAnalisis ? "rotate-180" : ""}`}
            />
          </button>
          {showAnalisis && (
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line mt-3">
              {trip.analisis_ai}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}

