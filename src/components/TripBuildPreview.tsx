import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Route as RouteIcon, Calendar, Users, Wallet, Sparkles, Plane, Hotel, Utensils, Compass, Train } from "lucide-react";
import { detectRouteIntent } from "@/lib/detectRouteIntent";

type Props = {
  origin?: string;
  destinoRaw?: string;
  destinations?: string[]; // override (multi page)
  fechaSalida?: string;
  fechaRegreso?: string;
  viajeros?: number;
  presupuesto?: number | null;
};

const fmtDate = (s?: string) => {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  } catch {
    return s;
  }
};

export const TripBuildPreview = ({
  origin,
  destinoRaw,
  destinations,
  fechaSalida,
  fechaRegreso,
  viajeros,
  presupuesto,
}: Props) => {
  const dests = (() => {
    if (destinations && destinations.length) return destinations.filter(Boolean);
    if (destinoRaw && destinoRaw.trim()) {
      const intent = detectRouteIntent(destinoRaw);
      return intent.destinations.filter(Boolean);
    }
    return [];
  })();

  const isMulti = dests.length >= 2;
  const nights =
    fechaSalida && fechaRegreso
      ? Math.max(
          0,
          Math.round((new Date(fechaRegreso).getTime() - new Date(fechaSalida).getTime()) / 86400000),
        )
      : null;

  const hasAny = !!(origin || dests.length || fechaSalida || viajeros);

  return (
    <aside className="rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 md:p-6 space-y-5 premium-shadow">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-primary/80">IATOS AI · construyendo</p>
          <h3 className="font-display text-lg md:text-xl mt-1">Tu viaje en vivo</h3>
        </div>
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-2 h-2 rounded-full bg-primary"
        />
      </header>

      {!hasAny && (
        <p className="text-sm text-muted-foreground italic">
          Empieza a escribir y verás aquí cómo IATOS AI estructura tu travesía paso a paso…
        </p>
      )}

      {/* Ruta */}
      {(origin || dests.length > 0) && (
        <div className="space-y-2">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
            {isMulti ? <RouteIcon className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
            {isMulti ? `Travesía · ${dests.length} ciudades` : "Destino"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence mode="popLayout">
              {origin && (
                <motion.span
                  key={`o-${origin}`}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-2.5 py-1 rounded-full bg-surface border border-border text-xs"
                >
                  {origin}
                </motion.span>
              )}
              {dests.map((d, i) => (
                <motion.span
                  key={`d-${d}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1.5 text-xs"
                >
                  <span className="text-primary/60">→</span>
                  <span className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary">
                    {d}
                  </span>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Meta */}
      {(fechaSalida || viajeros || presupuesto != null) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {fechaSalida && (
            <div className="rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-primary/70" />
              <div className="leading-tight">
                <p className="text-muted-foreground text-[10px]">Fechas</p>
                <p>
                  {fmtDate(fechaSalida)}
                  {fechaRegreso ? ` → ${fmtDate(fechaRegreso)}` : ""}
                  {nights ? ` · ${nights}n` : ""}
                </p>
              </div>
            </div>
          )}
          {viajeros ? (
            <div className="rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-primary/70" />
              <div className="leading-tight">
                <p className="text-muted-foreground text-[10px]">Viajeros</p>
                <p>{viajeros}</p>
              </div>
            </div>
          ) : null}
          {presupuesto != null && (
            <div className="col-span-2 rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-primary/70" />
              <div className="leading-tight">
                <p className="text-muted-foreground text-[10px]">Presupuesto</p>
                <p>${presupuesto.toLocaleString("es-MX")} MXN</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lo que la IA generará */}
      {dests.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary" /> IATOS AI generará desde 0
          </p>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2"><Plane className="w-3.5 h-3.5 text-primary/70" /> Vuelos por ciudad (3 tiers) + escalas reales</li>
            {isMulti && (
              <li className="flex items-center gap-2"><Train className="w-3.5 h-3.5 text-primary/70" /> Trenes / roadtrips entre destinos</li>
            )}
            <li className="flex items-center gap-2"><Hotel className="w-3.5 h-3.5 text-primary/70" /> 3 hoteles por ciudad (ahorro · equilibrio · premium)</li>
            <li className="flex items-center gap-2"><Utensils className="w-3.5 h-3.5 text-primary/70" /> 4-6 restaurantes según tu paladar</li>
            <li className="flex items-center gap-2"><Compass className="w-3.5 h-3.5 text-primary/70" /> Tours, experiencias e itinerario día por día</li>
          </ul>
        </div>
      )}
    </aside>
  );
};

export default TripBuildPreview;
