import { useState, type ReactNode } from "react";
import type { TotalSplit } from "@/lib/totalSplit";
import { motion } from "framer-motion";
import { Receipt, Lightbulb, ChevronDown, AlertTriangle, Clock, RefreshCw, BadgeCheck, Sparkles, Compass } from "lucide-react";
import type { QuoteTrust } from "@/lib/quoteTrust";
import type { TripTotalSummary } from "@/lib/tripTotal";
import { plainProviderText } from "@/lib/provenance";

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
  /**
   * Estado del total (tripTotalSummary): estimado / de tu selección / ya comprado. Sin él se deduce
   * de selectionDesglose (con selección = "de tu selección", sin ella = "estimado").
   */
  summary?: TripTotalSummary | null;
  /** Lo que tiene precio real y lo estimado del mismo total (totalSplit.ts; claude/viaje-corto). */
  split?: TotalSplit | null;
  /** Desglose (plegado debajo de este mismo total, sin repetir título ni cifra). */
  children?: ReactNode;
};

const fmtMXN = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

// tripTotals vive en lib/tripPageTotal.ts (lo usan también Inicio y Mis viajes); se re-exporta aquí.
export { tripTotals } from "@/lib/tripPageTotal";
import { tripTotals } from "@/lib/tripPageTotal";

export function RealTripTotal({ trip, noches, viajeros, staleMessage, validityLabel, validityExpired, fxNote, onRequote, selectionDesglose, trust, summary, split, children }: Props) {
  const { total, porPersona, presupuesto, excedente, fromSelection } = tripTotals(trip, viajeros, selectionDesglose);

  const [showAnalisis, setShowAnalisis] = useState(false);
  // Un solo total con su estado: estimado (falta elegir), de tu selección o con lo ya comprado.
  const title = summary?.title ?? (fromSelection ? "Total de tu selección" : "Total estimado");
  const hint = summary?.hint ?? (fromSelection ? null : "Elige vuelo y hotel en Comprar para ver el total real.");
  const estimated = summary?.state === "estimado" || !!summary?.sinPrecioReal?.length || (!summary && !fromSelection);
  const quien = viajeros > 1 ? `Total para ${viajeros} personas` : "Total para 1 persona";
  const splitLine = !!split && split.estimado > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-5 sm:p-8 md:p-10 mb-8 relative overflow-hidden max-w-full"
      data-testid="trip-total-card" data-state={summary?.state ?? (fromSelection ? "seleccion" : "estimado")}
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <p className="text-xs tracking-[0.2em] uppercase text-primary" data-testid="trip-total-title">{title}</p>
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
        {quien}{estimated && <span className="ml-2 rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-wider">aproximado</span>}
      </p>
      <p className="font-display text-4xl sm:text-5xl md:text-6xl gold-text mb-1 leading-tight break-words" data-testid="trip-total-amount"
        aria-label={`${quien}: ${fmtMXN(total)}`}>
        {fmtMXN(total)}
      </p>
      {/* Por persona y noches en una sola línea (R3 viajes P1-3: «demasiado texto»). */}
      <p className="text-sm text-muted-foreground mb-1">
        {viajeros > 1 && (
          <><span className="text-base text-foreground/90" data-testid="trip-total-pp">{fmtMXN(porPersona)} <span className="text-muted-foreground">por persona</span></span>{" · "}</>
        )}
        {noches} {noches === 1 ? "noche" : "noches"}
      </p>
      {hint && <p className="text-sm text-foreground/90 mb-2" data-testid="trip-total-hint">{hint}</p>}
      {/* El mismo total, separado, en UNA línea secundaria (R3 viajes P1-3: antes «Total con precios reales:
          $76,984» bajo el total y luego otra vez «$76,984 con precio consultado en vivo · $40,200 estimado»). */}
      {splitLine ? (
        <p className="mb-2 text-sm text-muted-foreground" data-testid="trip-total-reparto">
          {split!.real > 0
            ? <span data-testid="trip-total-real">De eso, <span className="tabular-nums text-foreground/90">{fmtMXN(split!.real)}</span> con precio en vivo y <span className="tabular-nums" data-testid="trip-total-estimado">{fmtMXN(split!.estimado)}</span> estimado.</span>
            : <span data-testid="trip-total-sin-reales">Aún sin precios consultados en vivo: todo el total es estimado.</span>}
        </p>
      ) : trust?.known ? (
        <p className="mb-2 text-sm text-muted-foreground" data-testid="trip-total-reparto">{trust.summary}</p>
      ) : null}
      {/* Ya comprado: lo pagado y lo que falta suman el mismo total de arriba. */}
      {summary && summary.state === "comprado" && (
        <p className="mb-2 flex flex-col gap-0.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm sm:inline-flex sm:flex-row sm:gap-3" data-testid="trip-total-pagado">
          <span className="text-emerald-400">Ya compraste {fmtMXN(summary.paid)}</span>
          <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">·</span>
          <span>Falta {fmtMXN(summary.pending)}</span>
        </p>
      )}
      {validityLabel && (
        <p className={`text-[11px] mb-2 flex items-center gap-1 ${validityExpired ? "text-amber-500" : "text-muted-foreground"}`}>
          <Clock className="w-3 h-3 shrink-0" /> {validityLabel}
        </p>
      )}
      {/* Si la cotización ya no corresponde, UNA línea discreta junto al total (sin otra cifra). */}
      {staleMessage && (
        <p role="status" className="mb-2 text-[11px] leading-relaxed text-amber-500" data-testid="trip-total-stale">
          <AlertTriangle className="mr-1 inline-block w-3 h-3 -mt-0.5" aria-hidden="true" />
          <span>{staleMessage}.</span>
          {onRequote && (
            <button type="button" onClick={onRequote}
              className="ml-2 inline-flex items-center gap-1 underline underline-offset-2 hover:text-amber-400">
              <RefreshCw className="w-3 h-3" aria-hidden="true" /> Actualizar cotización
            </button>
          )}
        </p>
      )}
      {excedente > 0 && (
        <p className="text-xs text-amber-500 mb-2" role="status">
          Este total rebasa tu presupuesto de {fmtMXN(presupuesto)} por {fmtMXN(excedente)}. Puedes editar el
          viaje (fechas, hotel o actividades) para acercarlo.
        </p>
      )}

      {/* Desglose plegado debajo de ESTE total (antes era otro bloque con "Total estimado" y la cifra repetida).
          Lo consultado en vivo renglón por renglón también va aquí: arriba ya lo dice una sola línea. */}
      {(children || trust?.known) && (
        <details className="group mt-5 border-t border-border/40" data-testid="trip-desglose">
          <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 pt-3">
            <span className="inline-flex items-center gap-2 text-sm"><Compass className="w-4 h-4 text-primary shrink-0" aria-hidden="true" /> Ver desglose del total</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-primary transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="pt-2">
          {/* Qué está verificado y qué es estimado (de los renglones de la cotización guardada). */}
          {trust?.known && (
            <div className="mb-3 rounded-xl border border-white/[0.06] bg-black/20 p-3 sm:p-4" aria-label="Qué tan confiable es este total">
              {trust.known ? (
                <>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                    {trust.verified > 0 && <span className="h-full bg-primary" style={{ width: `${(trust.verified / (trust.verified + trust.estimated + trust.toVerify)) * 100}%` }} />}
                    {trust.toVerify > 0 && <span className="h-full bg-amber-500/80" style={{ width: `${(trust.toVerify / (trust.verified + trust.estimated + trust.toVerify)) * 100}%` }} />}
                    {trust.estimated > 0 && <span className="h-full bg-white/25" style={{ width: `${(trust.estimated / (trust.verified + trust.estimated + trust.toVerify)) * 100}%` }} />}
                  </div>
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
              ) : null}
            </div>
          )}
            {children}
            {fxNote && <p className="mt-3 text-[11px] text-muted-foreground">{fxNote}</p>}
          </div>
        </details>
      )}
      {!children && !trust?.known && fxNote && <p className="text-[11px] text-muted-foreground mb-2">{fxNote}</p>}
      {!trust?.known && trust && <p className="mb-2 text-xs text-muted-foreground">{trust.summary}</p>}

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
              {plainProviderText(trip.analisis_ai)}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
