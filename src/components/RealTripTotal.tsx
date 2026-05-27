import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Lightbulb, ChevronDown } from "lucide-react";

type Props = {
  trip: any;
  noches: number;
  viajeros: number;
  onUpdated?: () => void;
};

const fmtMXN = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

// Estimaciones de comida + transporte local por persona/día (MXN)
const FOOD_PER_PERSON_PER_DAY = 1100;
const LOCAL_TRANSPORT_PER_DAY = 350;

const EMOCIONES_SUGERIDAS = [
  "Aventura adrenalina",
  "Romance y conexión",
  "Lujo y descanso",
  "Cultura profunda",
  "Naturaleza y desconexión",
  "Fiesta y vida nocturna",
  "Gastronomía",
  "Espiritual / mindfulness",
];

export function RealTripTotal({ trip, noches, viajeros, onUpdated }: Props) {
  const [emocion, setEmocion] = useState("");
  const [selectedEmociones, setSelectedEmociones] = useState<string[]>([]);
  const [adapting, setAdapting] = useState(false);

  const toggleEmocion = (s: string) => {
    setSelectedEmociones((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

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

  const dias = Math.max(1, noches + 1);
  const totalComida = FOOD_PER_PERSON_PER_DAY * viajeros * dias;
  const totalTransporte = LOCAL_TRANSPORT_PER_DAY * dias;

  const totalReal = totalVuelos + totalHoteles + totalCruceros + totalComida + totalTransporte;

  // Tope de presupuesto: si el usuario definió uno, no rebasarlo
  const presupuestoObjetivo = sumNumber(trip?.presupuesto_objetivo);
  const cappedToBudget = presupuestoObjetivo > 0 && totalReal > presupuestoObjetivo;
  const total = cappedToBudget ? presupuestoObjetivo : totalReal;
  const porPersona = viajeros > 0 ? total / viajeros : total;

  const adaptarEmocion = async () => {
    const combinadas = [
      ...selectedEmociones,
      ...(emocion.trim() ? [emocion.trim()] : []),
    ];
    if (combinadas.length === 0 || adapting) return;
    setAdapting(true);
    try {
      const emocionesTxt = combinadas.join(", ");
      const instruction = `Acopla este viaje completamente a las siguientes emociones / vibras del viajero: "${emocionesTxt}". Reorganiza experiencias, restaurantes, tours y hospedaje para que cada día refleje y mezcle esas emociones de forma coherente. Mantén destinos y fechas. Si el viaje tiene presupuesto_objetivo definido (${presupuestoObjetivo || "sin tope"}), NO lo sobrepases.`;
      const { data, error } = await supabase.functions.invoke("editar-viaje-ai", {
        body: { trip_id: trip.id, instruction },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Viaje acoplado a: ${emocionesTxt}`);
      setEmocion("");
      setSelectedEmociones([]);
      onUpdated?.();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo adaptar el viaje");
    } finally {
      setAdapting(false);
    }
  };

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
          <Sparkles className="w-3 h-3 text-primary" />
          {cappedToBudget ? "ajustado a tu presupuesto" : "precios confirmados"}
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
      <p className="text-[11px] text-muted-foreground/80 mb-6 italic">
        {cappedToBudget
          ? `Tope respetado: tu presupuesto es ${fmtMXN(presupuestoObjetivo)}. IATOS AI ajusta selección para no rebasarlo.`
          : "Calculado con vuelos, hospedaje y experiencias seleccionadas · incluye comida y transporte local estimados"}
      </p>

      {/* Search de emoción - sin caja, fondo transparente, multi-select */}
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <Heart className="w-4 h-4 text-primary" />
          <p className="text-xs tracking-[0.2em] uppercase text-primary">
            ¿Cuál es tu emoción del viaje?
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={emocion}
            onChange={(e) => setEmocion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adaptarEmocion()}
            placeholder="ej. quiero sentir libertad total y aventura"
            className="flex-1 bg-transparent border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-primary transition"
            disabled={adapting}
          />
          <button
            onClick={adaptarEmocion}
            disabled={(selectedEmociones.length === 0 && !emocion.trim()) || adapting}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            {adapting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {adapting ? "Acoplando..." : "Acoplar viaje"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EMOCIONES_SUGERIDAS.map((s) => {
            const active = selectedEmociones.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleEmocion(s)}
                disabled={adapting}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition disabled:opacity-50 ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border hover:border-primary/60 hover:text-primary"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
          Puedes elegir varias emociones · IATOS AI las mezcla y reorganiza experiencias, restaurantes y ritmo.
        </p>
      </div>
    </motion.div>
  );
}
