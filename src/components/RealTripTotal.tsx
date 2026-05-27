import { motion } from "framer-motion";
import { Plane, Hotel, Ship, Utensils, Sparkles } from "lucide-react";

type Props = {
  trip: any;
  noches: number;
  viajeros: number;
};

const fmtMXN = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

// Estimaciones de comida + transporte local por persona/día (MXN)
// Conservadoras y realistas para Europa.
const FOOD_PER_PERSON_PER_DAY = 1100;     // ≈ €55
const LOCAL_TRANSPORT_PER_DAY = 350;      // metro, taxis ligeros

export function RealTripTotal({ trip, noches, viajeros }: Props) {
  const vuelos: any[] = Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : [];
  const hoteles: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const cruceros: any[] = Array.isArray(trip?.cruceros_json) ? trip.cruceros_json : [];

  const sumNumber = (n: any) => Number(n) || 0;

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

  // Días aprox para comida/transporte = noches + 1
  const dias = Math.max(1, noches + 1);
  const totalComida = FOOD_PER_PERSON_PER_DAY * viajeros * dias;
  const totalTransporte = LOCAL_TRANSPORT_PER_DAY * dias;

  const total = totalVuelos + totalHoteles + totalCruceros + totalComida + totalTransporte;
  const porPersona = viajeros > 0 ? total / viajeros : total;

  const hotelesGratis = hoteles.filter((h) => h.costo_cero).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-2xl p-8 md:p-10 mb-8"
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <p className="text-xs tracking-[0.2em] uppercase text-primary">
          Inversión real · grupo de {viajeros} {viajeros === 1 ? "persona" : "personas"}
        </p>
        <span className="text-[10px] tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-primary" /> basado en tu PDF · precios confirmados
        </span>
      </div>

      <p className="font-display text-5xl md:text-6xl gold-text mb-2">{fmtMXN(total)}</p>
      <p className="text-sm text-muted-foreground mb-1">
        Para <span className="text-foreground font-medium">{viajeros} {viajeros === 1 ? "persona" : "personas"}</span> · {noches} noches
      </p>
      <p className="text-[11px] text-muted-foreground/80 mb-6 italic">
        Precio total del grupo · ≈ {fmtMXN(porPersona)} por persona · incluye comida y transporte local estimados
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Plane} label={`Vuelos · ${vuelos.length}`} value={fmtMXN(totalVuelos)} muted={!totalVuelos} />
        <Tile
          icon={Hotel}
          label={`Hoteles · ${hoteles.length}${hotelesGratis ? ` (${hotelesGratis} sin costo)` : ""}`}
          value={fmtMXN(totalHoteles)}
          muted={!totalHoteles}
        />
        {cruceros.length > 0 && (
          <Tile icon={Ship} label={`Crucero · ${cruceros.length}`} value={fmtMXN(totalCruceros)} muted={!totalCruceros} />
        )}
        <Tile icon={Utensils} label={`Comida + transporte (${dias}d)`} value={fmtMXN(totalComida + totalTransporte)} />
      </div>
    </motion.div>
  );
}

function Tile({ icon: Icon, label, value, muted }: { icon: any; label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface/50 p-4">
      <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-primary/80 mb-2">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <p className={`font-display text-lg ${muted ? "text-muted-foreground" : "gold-text"}`}>{value}</p>
    </div>
  );
}
