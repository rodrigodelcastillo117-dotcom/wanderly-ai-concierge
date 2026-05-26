import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, MapPin, Calendar, Phone, Languages, Crown,
  Navigation, Clock, Utensils, Hotel, Plane, Activity, AlertCircle, Sparkles, Luggage,
  Cloud, BookHeart, Users
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { DestinationVideo } from "@/components/DestinationVideo";

// Números de emergencia por país (datos reales básicos)
const EMERGENCY_NUMBERS: Record<string, { policia: string; ambulancia: string; bomberos: string }> = {
  "México": { policia: "911", ambulancia: "911", bomberos: "911" },
  "Estados Unidos": { policia: "911", ambulancia: "911", bomberos: "911" },
  "España": { policia: "112", ambulancia: "112", bomberos: "112" },
  "Francia": { policia: "17", ambulancia: "15", bomberos: "18" },
  "Italia": { policia: "113", ambulancia: "118", bomberos: "115" },
  "Reino Unido": { policia: "999", ambulancia: "999", bomberos: "999" },
  "Japón": { policia: "110", ambulancia: "119", bomberos: "119" },
  "Grecia": { policia: "100", ambulancia: "166", bomberos: "199" },
  "Tailandia": { policia: "191", ambulancia: "1669", bomberos: "199" },
  "Indonesia": { policia: "110", ambulancia: "118", bomberos: "113" },
  "Brasil": { policia: "190", ambulancia: "192", bomberos: "193" },
  "Argentina": { policia: "911", ambulancia: "107", bomberos: "100" },
  "Colombia": { policia: "123", ambulancia: "125", bomberos: "119" },
  "Perú": { policia: "105", ambulancia: "106", bomberos: "116" },
  "Marruecos": { policia: "19", ambulancia: "15", bomberos: "15" },
  "Turquía": { policia: "155", ambulancia: "112", bomberos: "110" },
};

const getEmergency = (pais?: string) => {
  if (!pais) return { policia: "112", ambulancia: "112", bomberos: "112" };
  const k = Object.keys(EMERGENCY_NUMBERS).find(c => pais.toLowerCase().includes(c.toLowerCase()));
  return k ? EMERGENCY_NUMBERS[k] : { policia: "112", ambulancia: "112", bomberos: "112" };
};

const LiveTrip = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sosOpen, setSosOpen] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(data);
      setLoading(false);
    })();
  }, [id, user]);

  const { dayIndex, totalDays, todayDate, isFuture, isPast, todayPlan } = useMemo(() => {
    if (!trip) return { dayIndex: 0, totalDays: 0, todayDate: new Date(), isFuture: false, isPast: false, todayPlan: null as any };
    const start = trip.fecha_salida ? new Date(trip.fecha_salida + "T00:00:00") : new Date();
    const end = trip.fecha_regreso ? new Date(trip.fecha_regreso + "T00:00:00") : start;
    const today = new Date(); today.setHours(0,0,0,0);
    const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const diff = Math.round((today.getTime() - start.getTime()) / 86400000);
    const idx = Math.min(Math.max(diff, 0), total - 1);
    const itin = trip.itinerario_json;
    const days = Array.isArray(itin) ? itin : Array.isArray(itin?.days) ? itin.days : [];
    return {
      dayIndex: idx,
      totalDays: total,
      todayDate: today,
      isFuture: today < start,
      isPast: today > end,
      todayPlan: days[idx] ?? null,
    };
  }, [trip]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground/60">Cargando tu viaje…</div>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">
        Viaje no encontrado
      </div>
    );
  }

  const emergency = getEmergency(trip.pais_destino);
  const acts: any[] = todayPlan?.actividades ?? todayPlan?.plan ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-primary/[0.08] blur-[140px]" />
        <div className="absolute bottom-0 -left-40 w-[480px] h-[480px] rounded-full bg-primary/[0.05] blur-[160px]" />
      </div>

      {/* Hero cinematic */}
      <div className="relative h-[42vh] min-h-[320px] w-full overflow-hidden">
        <DestinationVideo
          query={`${trip.destino} cinematic travel aerial luxury`}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-background" />

        <div className="relative z-10 px-4 md:px-8 pt-5 pb-6 h-full flex flex-col">
          <button
            onClick={() => navigate(-1)}
            className="self-start flex items-center gap-2 px-3 py-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/90 text-sm hover:bg-black/60 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Volver
          </button>

          <div className="mt-auto">
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/90 backdrop-blur text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.18em] mb-3"
            >
              <Sparkles className="w-3 h-3" /> Modo Viaje en Vivo
            </motion.div>
            <h1 className="text-3xl md:text-5xl font-serif text-white drop-shadow-lg leading-tight">
              {trip.destino}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-white/85 text-sm">
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Día {dayIndex + 1} de {totalDays}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {trip.pais_destino ?? "—"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8 max-w-[1200px] mx-auto -mt-6 relative z-20 space-y-5 md:space-y-7">
        {/* Estado del viaje */}
        {isFuture && (
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] backdrop-blur-xl p-4 md:p-5 flex items-center gap-3">
            <Clock className="w-5 h-5 text-primary shrink-0" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">Aún no empieza</div>
              <div className="text-foreground/60">Tu viaje comienza el {new Date(trip.fecha_salida).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.</div>
            </div>
          </div>
        )}
        {isPast && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-4 md:p-5 flex items-center gap-3">
            <Activity className="w-5 h-5 text-foreground/60 shrink-0" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">Viaje finalizado</div>
              <div className="text-foreground/60">Esperamos que haya sido inolvidable.</div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction icon={Navigation} label="Mapa" sublabel="Día por día" onClick={() => navigate(`/dashboard/viajes/${trip.id}/mapa`)} />
          <QuickAction icon={Luggage} label="Packing" sublabel="Checklist" onClick={() => navigate(`/dashboard/viajes/${trip.id}/packing`)} />
          <QuickAction icon={Cloud} label="Clima" sublabel="14 días" onClick={() => navigate(`/dashboard/viajes/${trip.id}/clima`)} />
          <QuickAction icon={Languages} label="Traductor" sublabel="Frases clave" onClick={() => navigate(`/dashboard/viajes/${trip.id}/traductor`)} />
          <QuickAction icon={BookHeart} label="Diario" sublabel="Memorias" onClick={() => navigate(`/dashboard/viajes/${trip.id}/diario`)} />
          <QuickAction icon={Users} label="Split" sublabel="Gastos" onClick={() => navigate(`/dashboard/viajes/${trip.id}/split`)} />
          <QuickAction icon={Phone} label="SOS" sublabel="Emergencias" danger onClick={() => setSosOpen(true)} />
          <QuickAction icon={Crown} label="Concierge" sublabel="24/7" gold onClick={() => navigate("/dashboard/concierge")} />
        </div>


        {/* Hoy en tu viaje */}
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-5 md:p-7">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Hoy</div>
              <h2 className="text-2xl md:text-3xl font-serif mt-1">Tu día en {trip.destino.split(",")[0]}</h2>
            </div>
            <div className="text-right text-xs text-foreground/60 hidden sm:block">
              {todayDate.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>

          {todayPlan ? (
            <div className="space-y-3">
              {todayPlan.titulo && (
                <div className="text-foreground/80 italic">{todayPlan.titulo}</div>
              )}
              {acts.length > 0 ? (
                <ul className="space-y-2.5">
                  {acts.map((a: any, i: number) => {
                    const text = typeof a === "string" ? a : (a.actividad ?? a.titulo ?? a.descripcion ?? JSON.stringify(a));
                    const hora = typeof a === "object" ? (a.hora ?? a.horario ?? null) : null;
                    return (
                      <li key={i} className="flex gap-3 p-3 rounded-xl bg-black/30 border border-white/[0.04]">
                        <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {hora && <div className="text-[11px] text-primary/80 font-semibold mb-0.5">{hora}</div>}
                          <div className="text-sm text-foreground/90">{text}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-sm text-foreground/60">Tu día está libre. Aprovecha para explorar.</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-foreground/60">
              No hay un plan detallado para hoy. Pídele uno al Concierge.
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/viajes/${trip.id}`)}>
              Ver itinerario completo
            </Button>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate("/dashboard/concierge")}>
              <Crown className="w-3.5 h-3.5 mr-1.5" /> Pedir al Concierge
            </Button>
          </div>
        </section>

        {/* Accesos rápidos a info del viaje */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <InfoCard icon={Hotel} label="Hospedaje" count={(trip.hospedaje_json ?? []).length} onClick={() => navigate(`/dashboard/viajes/${trip.id}`)} />
          <InfoCard icon={Plane} label="Vuelos" count={(trip.vuelos_json ?? []).length} onClick={() => navigate(`/dashboard/viajes/${trip.id}`)} />
          <InfoCard icon={Utensils} label="Restaurantes" count={(trip.restaurantes_json ?? []).length} onClick={() => navigate(`/dashboard/viajes/${trip.id}`)} />
        </div>
      </div>

      {/* SOS overlay */}
      {sosOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end md:items-center justify-center p-4" onClick={() => setSosOpen(false)}>
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-md rounded-3xl border border-red-500/20 bg-zinc-950 p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Emergencias</h3>
                <p className="text-xs text-foreground/60">{trip.pais_destino ?? "Local"}</p>
              </div>
            </div>
            <div className="space-y-2">
              <SosBtn label="Policía" number={emergency.policia} />
              <SosBtn label="Ambulancia" number={emergency.ambulancia} />
              <SosBtn label="Bomberos" number={emergency.bomberos} />
            </div>
            <Button variant="ghost" className="w-full mt-4" onClick={() => setSosOpen(false)}>Cerrar</Button>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const QuickAction = ({ icon: Icon, label, sublabel, onClick, gold, danger }: any) => (
  <button
    onClick={onClick}
    className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
      gold
        ? "border-primary/30 bg-gradient-to-br from-primary/15 to-primary/[0.04] hover:border-primary/50"
        : danger
          ? "border-red-500/20 bg-red-500/[0.06] hover:border-red-500/40"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
    }`}
  >
    <Icon className={`w-5 h-5 mb-2 ${gold ? "text-primary" : danger ? "text-red-400" : "text-foreground/80"}`} />
    <div className="text-sm font-semibold">{label}</div>
    <div className="text-[11px] text-foreground/55">{sublabel}</div>
  </button>
);

const InfoCard = ({ icon: Icon, label, count, onClick }: any) => (
  <button onClick={onClick} className="flex items-center justify-between p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] transition text-left">
    <div className="flex items-center gap-3">
      <Icon className="w-5 h-5 text-primary" />
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-[11px] text-foreground/55">{count} opciones</div>
      </div>
    </div>
    <span className="text-foreground/40">›</span>
  </button>
);

const SosBtn = ({ label, number }: { label: string; number: string }) => (
  <a
    href={`tel:${number}`}
    className="flex items-center justify-between p-4 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition"
  >
    <span className="text-sm font-medium">{label}</span>
    <span className="text-lg font-bold text-red-400">{number}</span>
  </a>
);

export default LiveTrip;
