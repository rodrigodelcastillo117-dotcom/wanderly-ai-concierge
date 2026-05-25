import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Calendar, Users, Plane, Hotel, Utensils, Compass, Lightbulb, Star, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { EditableBudget } from "@/components/EditableBudget";
import santorini from "@/assets/hero-santorini.jpg";

const fmtMXN = (n: number) =>
  `$${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;

const TripDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Selecciones del usuario
  const [selVuelo, setSelVuelo] = useState<number>(0);
  const [selHospedaje, setSelHospedaje] = useState<number>(0);
  const [selTours, setSelTours] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(data);
      // Por defecto seleccionar todas las experiencias
      const tours = (data as any)?.tours_json;
      if (Array.isArray(tours) && tours.length) {
        setSelTours(new Set(tours.map((_: any, i: number) => i)));
      }

      setLoading(false);
    })();
  }, [id]);

  const dias = trip?.itinerario_json?.length ?? 0;
  const noches = Math.max(1, dias - 1);
  const viajeros = trip?.num_viajeros ?? 1;
  const baseDesglose = trip?.desglose_presupuesto ?? {};

  // Recalcular desglose en base a selecciones
  const computedDesglose = useMemo(() => {
    if (!trip) return {};
    const vuelo = trip.vuelos_json?.[selVuelo];
    const hosp = trip.hospedaje_json?.[selHospedaje];
    const toursSum = (trip.tours_json ?? []).reduce(
      (s: number, t: any, i: number) =>
        selTours.has(i) ? s + Number(t.precio_por_persona ?? 0) * viajeros : s,
      0,
    );
    return {
      vuelos: vuelo ? Number(vuelo.precio_por_persona ?? 0) * viajeros : Number(baseDesglose.vuelos ?? 0),
      hospedaje: hosp ? Number(hosp.precio_por_noche ?? 0) * noches : Number(baseDesglose.hospedaje ?? 0),
      comida: Number(baseDesglose.comida ?? 0),
      tours: toursSum || Number(baseDesglose.tours ?? 0),
      transporte_local: Number(baseDesglose.transporte_local ?? 0),
      extras: Number(baseDesglose.extras ?? 0),
    };
  }, [trip, selVuelo, selHospedaje, selTours, viajeros, noches]);

  const computedTotal = Object.values(computedDesglose).reduce((s: number, v) => s + Number(v ?? 0), 0);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (!trip) {
    return (
      <DashboardLayout>
        <div className="p-10 text-center">
          <p className="text-muted-foreground mb-4">Viaje no encontrado.</p>
          <button onClick={() => navigate("/dashboard")} className="text-primary hover:underline">
            Volver al inicio
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const toggleTour = (i: number) => {
    setSelTours((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const selectedClass = (active: boolean) =>
    `cursor-pointer transition relative ${active ? "gold-border ring-1 ring-primary/50" : "hover:gold-border"}`;

  return (
    <DashboardLayout>
      {/* HERO */}
      <div className="relative h-[60vh] min-h-[420px] overflow-hidden">
        <DestinationVideo query={`${trip.destino} ${trip.pais_destino ?? ""} travel`} fallbackImage={trip.cover_image_url ?? santorini} alt={trip.destino} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-overlay" />
        <button
          onClick={() => navigate("/dashboard")}
          className="absolute top-6 left-6 inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card text-sm hover:gold-border transition"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="absolute inset-x-0 bottom-0 p-6 md:p-12 max-w-5xl">
          {trip.match_score && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium mb-4">
              <Star className="w-3 h-3 fill-current" /> {trip.match_score}% match con tu perfil
            </div>
          )}
          <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">{trip.pais_destino}</p>
          <h1 className="font-display text-5xl md:text-7xl leading-none mb-4">{trip.destino}</h1>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {new Date(trip.fecha_salida).toLocaleDateString("es-MX")} – {new Date(trip.fecha_regreso).toLocaleDateString("es-MX")}</span>
            <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {viajeros} {viajeros === 1 ? "viajero" : "viajeros"}</span>
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Desde {trip.ciudad_origen}</span>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-12 max-w-5xl space-y-12">
        {/* Total + Análisis narrativo */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="glass-card rounded-2xl p-8 md:p-10 mb-8">
            <p className="text-xs tracking-[0.2em] uppercase text-primary mb-2">Inversión total estimada</p>
            <p className="font-display text-5xl md:text-6xl gold-text mb-4">{fmtMXN(computedTotal)}</p>
            <p className="text-sm text-muted-foreground">
              Para {viajeros} {viajeros === 1 ? "persona" : "personas"} · {dias} días · basado en tus selecciones
            </p>
          </div>
          {trip.analisis_ai && (
            <div className="prose prose-invert max-w-none">
              <p className="text-lg leading-relaxed text-foreground/90 whitespace-pre-line">{trip.analisis_ai}</p>
            </div>
          )}
        </motion.section>

        {/* Vuelos */}
        {trip.vuelos_json?.length > 0 && (
          <Section icon={Plane} title="Vuelos sugeridos" hint="Selecciona uno">
            <div className="grid md:grid-cols-3 gap-4">
              {trip.vuelos_json.map((v: any, i: number) => {
                const active = selVuelo === i;
                return (
                  <div
                    key={i}
                    onClick={() => setSelVuelo(i)}
                    className={`glass-card rounded-xl p-6 ${selectedClass(active)}`}
                  >
                    {active && <SelectedBadge />}
                    <p className="text-xs tracking-[0.15em] uppercase text-primary mb-2">{v.tier}</p>
                    <p className="font-display text-xl mb-1">{v.aerolinea}</p>
                    <p className="text-sm text-muted-foreground mb-4">{v.duracion} · {v.escalas}</p>
                    <p className="font-medium text-lg">{fmtMXN(v.precio_por_persona)}<span className="text-xs text-muted-foreground ml-1">/ persona</span></p>
                    {v.notas && <p className="text-xs text-muted-foreground mt-3">{v.notas}</p>}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Hospedaje */}
        {trip.hospedaje_json?.length > 0 && (
          <Section icon={Hotel} title="Hospedaje" hint="Selecciona uno">
            <div className="grid md:grid-cols-3 gap-4">
              {trip.hospedaje_json.map((h: any, i: number) => {
                const active = selHospedaje === i;
                return (
                  <div
                    key={i}
                    onClick={() => setSelHospedaje(i)}
                    className={`glass-card rounded-xl p-6 ${selectedClass(active)}`}
                  >
                    {active && <SelectedBadge />}
                    <p className="text-xs tracking-[0.15em] uppercase text-primary mb-2">{h.tipo}</p>
                    <p className="font-display text-xl mb-1">{h.nombre}</p>
                    <p className="text-sm text-muted-foreground mb-3">{h.barrio} · ★ {h.rating}</p>
                    <p className="font-medium mb-3">{fmtMXN(h.precio_por_noche)}<span className="text-xs text-muted-foreground ml-1">/ noche</span></p>
                    <p className="text-xs text-muted-foreground italic">{h.por_que}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Itinerario */}
        {trip.itinerario_json?.length > 0 && (
          <Section icon={Calendar} title="Itinerario día por día">
            <div className="space-y-3">
              {trip.itinerario_json.map((d: any) => (
                <details key={d.dia} className="glass-card rounded-xl group">
                  <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                    <div className="flex items-center gap-4">
                      <span className="font-display text-2xl gold-text w-10">{String(d.dia).padStart(2, "0")}</span>
                      <span className="font-medium">{d.titulo}</span>
                    </div>
                  </summary>
                  <div className="px-5 pb-5 pt-1 border-t border-border/40 space-y-3 text-sm">
                    <div><span className="text-primary text-xs tracking-wider uppercase">Mañana</span><p className="mt-1 text-muted-foreground">{d.mañana}</p></div>
                    <div><span className="text-primary text-xs tracking-wider uppercase">Tarde</span><p className="mt-1 text-muted-foreground">{d.tarde}</p></div>
                    <div><span className="text-primary text-xs tracking-wider uppercase">Noche</span><p className="mt-1 text-muted-foreground">{d.noche}</p></div>
                  </div>
                </details>
              ))}
            </div>
          </Section>
        )}

        {/* Tours / Experiencias */}
        {trip.tours_json?.length > 0 && (
          <Section icon={Compass} title="Experiencias" hint="Selecciona las que quieras">
            <div className="grid sm:grid-cols-2 gap-4">
              {trip.tours_json.map((t: any, i: number) => {
                const active = selTours.has(i);
                return (
                  <div
                    key={i}
                    onClick={() => toggleTour(i)}
                    className={`glass-card rounded-xl p-5 ${selectedClass(active)}`}
                  >
                    {active && <SelectedBadge />}
                    <div className="flex items-start justify-between mb-2 pr-8">
                      <p className="font-medium">{t.nombre}</p>
                      <span className="text-xs text-primary whitespace-nowrap">{fmtMXN(t.precio_por_persona)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{t.duracion}</p>
                    <p className="text-sm text-muted-foreground italic">{t.por_que}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Restaurantes */}
        {trip.restaurantes_json?.length > 0 && (
          <Section icon={Utensils} title="Mesa reservada">
            <div className="grid sm:grid-cols-2 gap-4">
              {trip.restaurantes_json.map((r: any, i: number) => (
                <div key={i} className="glass-card rounded-xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium">{r.nombre}</p>
                    <span className="text-xs text-primary">{r.rango_precio}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{r.cocina}</p>
                  <p className="text-sm text-muted-foreground italic">{r.por_que}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Tips */}
        {trip.tips_personalizados?.length > 0 && (
          <Section icon={Lightbulb} title="Tips de tu concierge">
            <div className="glass-card rounded-2xl p-6 md:p-8 space-y-4">
              {trip.tips_personalizados.map((t: string, i: number) => (
                <div key={i} className="flex gap-4">
                  <span className="font-display gold-text text-xl flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-foreground/90 leading-relaxed">{t}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Desglose AL FINAL, calculado en base a selecciones */}
        {computedTotal > 0 && (
          <Section icon={Compass} title="Desglose de presupuesto">
            <EditableBudget
              key={`${selVuelo}-${selHospedaje}-${Array.from(selTours).sort().join(",")}`}
              tripId={trip.id}
              initialDesglose={computedDesglose}
              initialTotal={computedTotal}
            />
          </Section>
        )}
      </div>
    </DashboardLayout>
  );
};

const SelectedBadge = () => (
  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
    <Check className="w-3.5 h-3.5" />
  </div>
);

const Section = ({ icon: Icon, title, hint, children }: any) => (
  <motion.section initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
    <div className="flex items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-primary" />
        <h2 className="font-display text-3xl">{title}</h2>
      </div>
      {hint && <span className="text-xs text-muted-foreground italic">{hint}</span>}
    </div>
    {children}
  </motion.section>
);

export default TripDetail;
