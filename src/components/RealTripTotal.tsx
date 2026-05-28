import { useState } from "react";
import { motion } from "framer-motion";
import { Receipt, Lightbulb, ChevronDown } from "lucide-react";

type Props = {
  trip: any;
  noches: number;
  viajeros: number;
  onUpdated?: () => void;
};

const fmtMXN = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

export function RealTripTotal({ trip, noches, viajeros, onUpdated }: Props) {


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
  const totalReal = sumNumber(trip?.total_estimado) || explicitBreakdownTotal || itemSubtotal;

  // Tope de presupuesto: si el usuario definió uno, no rebasarlo
  const presupuestoObjetivo = sumNumber(trip?.presupuesto_objetivo);
  const cappedToBudget = presupuestoObjetivo > 0 && totalReal > presupuestoObjetivo;
  const total = cappedToBudget ? presupuestoObjetivo : totalReal;
  const porPersona = viajeros > 0 ? total / viajeros : total;

  const [showAnalisis, setShowAnalisis] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-8 md:p-10 mb-8 relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <p className="text-xs tracking-[0.2em] uppercase text-primary">
          Inversión real · grupo de {viajeros} {viajeros === 1 ? "persona" : "personas"}
        </p>
        <span className="text-[10px] tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1">
          <Receipt className="w-3 h-3 text-primary" />
          {cappedToBudget ? "ajustado a tu presupuesto" : "cotización base respetada"}
        </span>
      </div>

      {/* Costo por persona protagonista */}
      <p className="font-display text-5xl md:text-6xl gold-text mb-1 leading-tight">
        {fmtMXN(porPersona)}
        <span className="text-base md:text-lg text-muted-foreground font-sans ml-2">/ persona</span>
      </p>

      {/* Total del viaje secundario */}
      <p className="text-sm text-muted-foreground mb-1">
        Total del viaje · <span className="text-foreground font-medium">{fmtMXN(total)}</span> ·{" "}
        {viajeros} {viajeros === 1 ? "persona" : "personas"} · {noches} noches
      </p>
      <p className="text-[11px] text-muted-foreground/80 mb-2 italic">
        {cappedToBudget
          ? `Tope respetado: tu presupuesto es ${fmtMXN(presupuestoObjetivo)}. IATOS AI ajusta selección para no rebasarlo.`
          : "Calculado solo con los importes de la cotización y tus selecciones; no se agregan extras automáticos"}
      </p>

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

