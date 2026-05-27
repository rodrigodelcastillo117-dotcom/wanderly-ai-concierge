import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Calendar, Users, Plane, Hotel, Utensils, Compass, Lightbulb, Star, Check, X, Train, Car, Mountain, ArrowRight, Bus, Ship, Route as RouteIcon, ChevronDown, Download, Radio, Map as MapIcon, Backpack, Cloud, Languages, BookHeart, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { ReadonlyBudget } from "@/components/ReadonlyBudget";
import { CityCollapsible, useCityImage } from "@/components/CityCollapsible";
import { ExpandableItemCard } from "@/components/ExpandableItemCard";
import { EditWithAIDialog } from "@/components/EditWithAIDialog";
import { LiveTripQuote } from "@/components/LiveTripQuote";
import { InviteFriendDialog } from "@/components/InviteFriendDialog";
import { useAuth } from "@/contexts/AuthContext";
import { generateTripPDF } from "@/lib/tripPdf";
import { toast } from "sonner";
import santorini from "@/assets/hero-santorini.jpg";

const fmtMXN = (n: number) =>
  `$${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;

const TripDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Selecciones del usuario
  const [selVuelo, setSelVuelo] = useState<number>(0);
  const [selHospedaje, setSelHospedaje] = useState<number>(0);
  const [nochesHospedaje, setNochesHospedaje] = useState<number | null>(null); // null = usar todas las noches
  const [selTours, setSelTours] = useState<Set<number>>(new Set());
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const toggleCity = (city: string) => {
    setActiveCity((prev) => {
      const next = prev === city ? null : city;
      if (next) {
        // Scroll suave al inicio del destino abierto
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = cityRefs.current[next];
            if (el) {
              const y = el.getBoundingClientRect().top + window.scrollY - 88;
              window.scrollTo({ top: y, behavior: "smooth" });
            }
          }, 80);
        });
      }
      return next;
    });
  };
  const cityRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [generatingPdf, setGeneratingPdf] = useState(false);

  const loadTrip = async () => {
    if (!id) return;
    const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
    setTrip(data);
    // Experiencias arrancan sin seleccionar — el usuario elige cuál le interesa.
    setLoading(false);
  };

  useEffect(() => {
    loadTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Abrir el primer destino por default al cargar el viaje
  useEffect(() => {
    if (!trip) return;
    const itinObj = trip.itinerario_json;
    const isMultiTrip = !!(itinObj && !Array.isArray(itinObj) && itinObj.multi);
    const cities = isMultiTrip ? (itinObj.destinations ?? []) : [trip.destino];
    if (cities.length > 0) {
      setActiveCity((prev) => prev ?? cities[0]);
    }
  }, [trip]);

  const handleDownloadPdf = async () => {
    if (!trip) return;
    setGeneratingPdf(true);
    try {
      await generateTripPDF(trip, { selVuelo, selHospedaje, nochesEfectivas, selTours }, { desglose: computedDesglose, total: computedTotal });
      toast.success("PDF descargado");
    } catch (e: any) {
      console.error(e);
      toast.error("No pude generar el PDF", { description: e?.message });
    } finally {
      setGeneratingPdf(false);
    }
  };

  // itinerario_json puede ser array (single) o objeto { multi, days, logistics, destinations } (multi)
  const itinObj = trip?.itinerario_json;
  const isMulti = !!(itinObj && !Array.isArray(itinObj) && itinObj.multi);
  const itinDays: any[] = Array.isArray(itinObj)
    ? itinObj
    : Array.isArray(itinObj?.days)
      ? itinObj.days
      : [];
  const logistics = isMulti ? itinObj.logistics : null;
  const destinationsMulti: string[] = isMulti ? itinObj.destinations ?? [] : [];

  // Resuelve la "ciudad" usada dentro de hospedaje/tours/restaurantes/itin para cada destino del viaje
  // (el destino puede ser país como "Grecia" y los items guardarse como "Atenas").
  const cityKeyFor = (label: string): string => {
    if (!isMulti) return label;
    const norm = (s: string) => (s || "").toLowerCase().trim();
    const collect = (arr: any) => Array.isArray(arr) ? arr.map((x: any) => x?.ciudad).filter(Boolean) : [];
    const allCiudades: string[] = Array.from(new Set([
      ...collect(trip?.hospedaje_json),
      ...collect(trip?.tours_json),
      ...collect(trip?.restaurantes_json),
      ...collect(itinDays),
    ]));
    // 1) match exacto / substring en cualquier dirección
    const direct = allCiudades.find(c => norm(c) === norm(label) || norm(c).includes(norm(label)) || norm(label).includes(norm(c)));
    if (direct) return direct;
    // 2) fallback por índice (orden) entre ciudades no usadas por otros destinos
    const used = new Set(
      destinationsMulti
        .filter(d => d !== label)
        .map(d => {
          const m = allCiudades.find(c => norm(c) === norm(d) || norm(c).includes(norm(d)) || norm(d).includes(norm(c)));
          return m ?? null;
        })
        .filter(Boolean) as string[]
    );
    const remaining = allCiudades.filter(c => !used.has(c));
    const idx = destinationsMulti.indexOf(label);
    return remaining[Math.min(idx, remaining.length - 1)] ?? label;
  };

  const dias = itinDays.length;
  const noches = Math.max(1, dias - 1);
  const viajeros = trip?.num_viajeros ?? 1;
  const baseDesglose = trip?.desglose_presupuesto ?? {};

  const nochesEfectivas = nochesHospedaje ?? noches;

  // Recalcular desglose en base a selecciones (-1 = "ya lo tengo / no aplica")
  const computedDesglose = useMemo(() => {
    if (!trip) return {};
    const vuelo = selVuelo >= 0 ? trip.vuelos_json?.[selVuelo] : null;
    const hosp = selHospedaje >= 0 ? trip.hospedaje_json?.[selHospedaje] : null;
    const toursSum = (trip.tours_json ?? []).reduce(
      (s: number, t: any, i: number) =>
        selTours.has(i) ? s + Number(t.precio_por_persona ?? 0) * viajeros : s,
      0,
    );
    // Comida y transporte se prorratean a los días realmente "fuera"
    // Si tiene hospedaje propio parte del viaje, asumimos que sigue gastando en comida/transporte todos los días
    const factorDias = dias > 0 ? dias / Math.max(1, dias) : 1;
    return {
      vuelos: selVuelo === -1 ? 0 : vuelo ? Number(vuelo.precio_por_persona ?? 0) * viajeros : Number(baseDesglose.vuelos ?? 0),
      hospedaje: selHospedaje === -1 ? 0 : hosp ? Number(hosp.precio_por_noche ?? 0) * nochesEfectivas : Number(baseDesglose.hospedaje ?? 0),
      comida: Number(baseDesglose.comida ?? 0) * factorDias,
      tours: toursSum || Number(baseDesglose.tours ?? 0),
      transporte_local: Number(baseDesglose.transporte_local ?? 0) * factorDias,
      extras: Number(baseDesglose.extras ?? 0),
    };
  }, [trip, selVuelo, selHospedaje, selTours, viajeros, nochesEfectivas, dias]);


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


        <div className="absolute top-6 right-6 flex items-center gap-2">
          <button
            onClick={handleDownloadPdf}
            disabled={generatingPdf}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-full glass-card text-xs hover:gold-border transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-primary" />
            {generatingPdf ? "Generando…" : "Compartir PDF"}
          </button>
          <InviteFriendDialog tripId={trip.id} isOwner={user?.id === trip.user_id} />
          <EditWithAIDialog tripId={trip.id} onUpdated={loadTrip} />
        </div>
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

      <div className="p-6 md:p-12 max-w-5xl space-y-8">
        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 md:grid-cols-7 gap-3"
        >
          {[
            { icon: Radio, label: "Live", to: `/dashboard/viajes/${id}/live` },
            { icon: MapIcon, label: "Mapa", to: `/dashboard/viajes/${id}/mapa` },
            { icon: Backpack, label: "Packing", to: `/dashboard/viajes/${id}/packing` },
            { icon: Cloud, label: "Clima", to: `/dashboard/viajes/${id}/clima` },
            { icon: Languages, label: "Traductor", to: `/dashboard/viajes/${id}/traductor` },
            { icon: BookHeart, label: "Diario", to: `/dashboard/viajes/${id}/diario` },
            { icon: Wallet, label: "Split", to: `/dashboard/viajes/${id}/split` },
          ].map(({ icon: Icon, label, to }) => (
            <button
              key={label}
              onClick={() => navigate(to)}
              className="glass-card rounded-2xl p-3 hover:border-primary/60 transition-all group flex flex-col items-center gap-2"
            >
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </motion.div>


        {/* Total + Análisis narrativo */}
        <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <LiveTripQuote
            origin={trip.ciudad_origen}
            destination={isMulti ? destinationsMulti[0] : trip.destino}
            depart={trip.fecha_salida}
            return_date={trip.fecha_regreso}
            nights={noches}
            travelers={viajeros}
            fallbackMxn={computedTotal}
          />
          {trip.analisis_ai && (
            <details className="glass-card rounded-2xl group">
              <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                <div className="flex items-center gap-3">
                  <Lightbulb className="w-5 h-5 text-primary" />
                  <h2 className="font-display text-xl">Análisis de tu concierge</h2>
                </div>
                <ChevronDown className="w-5 h-5 text-primary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-5 pt-1 border-t border-border/40">
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">{trip.analisis_ai}</p>
              </div>
            </details>
          )}
        </motion.section>

        {/* Selector noches (solo single + hospedaje seleccionado) */}
        {!isMulti && selHospedaje >= 0 && noches > 1 && trip.hospedaje_json?.length > 0 && (
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium">¿Cuántas noches en este hospedaje?</p>
                <p className="text-xs text-muted-foreground">Tu viaje son {noches} noches.</p>
              </div>
              <span className="font-display text-2xl gold-text">{nochesEfectivas}<span className="text-sm text-muted-foreground"> / {noches}</span></span>
            </div>
            <input type="range" min={0} max={noches} value={nochesEfectivas}
              onChange={(e) => setNochesHospedaje(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        )}

        {/* TODO POR DESTINO — un menú único, plegable, colapsado por default */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-1">
            <RouteIcon className="w-5 h-5 text-primary" />
            <h2 className="font-display text-3xl">Tu viaje por destino</h2>
            <span className="ml-auto text-xs text-muted-foreground italic">Toca cada destino para explorar</span>
          </div>

          {(isMulti ? destinationsMulti : [trip.destino]).map((city: string, cityIdx: number, allCities: string[]) => {
            const cityKey = isMulti ? cityKeyFor(city) : city;
            const cityVuelos = isMulti
              ? (trip.vuelos_json ?? []).filter((v: any) => (v.ciudad || v.to) === cityKey || (v.ciudad || v.to) === city)
              : (trip.vuelos_json ?? []);
            const cityHosp = isMulti
              ? (trip.hospedaje_json ?? []).filter((h: any) => h.ciudad === cityKey)
              : (trip.hospedaje_json ?? []);
            const cityDays = isMulti
              ? itinDays.filter((d: any) => d.ciudad === cityKey)
              : itinDays;
            const cityTours = isMulti
              ? (trip.tours_json ?? []).filter((t: any) => t.ciudad === cityKey)
              : (trip.tours_json ?? []);
            const cityRest = isMulti
              ? (trip.restaurantes_json ?? []).filter((r: any) => r.ciudad === cityKey)
              : (trip.restaurantes_json ?? []);

            const totalItems =
              cityVuelos.length + cityHosp.length + cityDays.length + cityTours.length + cityRest.length;

            return (
              <div key={city}>
              <CityCollapsible
                city={city}
                subtitle={`${cityDays.length || "·"} días · ${cityHosp.length} hoteles · ${cityTours.length} experiencias · ${cityRest.length} mesas`}
                imageQuery={`${city} skyline landmark travel`}
                open={activeCity === city}
                onToggle={() => toggleCity(city)}
                count={totalItems}
                wrapperRef={(el) => { cityRefs.current[city] = el; }}
              >
                <div className="space-y-6">
                  {/* Cómo llegar */}
                  {cityVuelos.length > 0 && (
                    <SubBlock icon={isMulti ? RouteIcon : Plane} title={isMulti ? "Cómo llegar" : "Vuelos sugeridos"}>
                      <div className="grid md:grid-cols-2 gap-3">
                        {cityVuelos.map((v: any) => {
                          const i = (trip.vuelos_json ?? []).indexOf(v);
                          const active = selVuelo === i;
                          return isMulti ? (
                            <ArrivalOptionCard key={i} option={v} active={active} onClick={() => setSelVuelo(i)} />
                          ) : (
                            <ExpandableItemCard
                              key={i}
                              imageQuery={`${v.aerolinea} airplane airline`}
                              eyebrow={v.tier}
                              title={v.aerolinea}
                              subtitle={`${v.duracion} · ${v.escalas}`}
                              price={`${fmtMXN(v.precio_por_persona)} / persona`}
                              active={active}
                              selectable
                              onToggle={() => setSelVuelo(i)}
                            >
                              {v.notas && <p>{v.notas}</p>}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const u = `/dashboard/vuelos?origin=${encodeURIComponent(trip.ciudad_origen ?? "Mexico City")}&destination=${encodeURIComponent(city)}&depart=${trip.fecha_salida}&return=${trip.fecha_regreso}&travelers=${trip.viajeros ?? 1}&auto=1`;
                                  window.location.href = u;
                                }}
                                className="mt-2 text-xs px-3 py-1.5 rounded-md bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 transition"
                              >
                                Buscar vuelos reales y reservar →
                              </button>
                            </ExpandableItemCard>
                          );
                        })}
                        {!isMulti && (
                          <SkipCard active={selVuelo === -1} onClick={() => setSelVuelo(-1)}
                            title="Ya tengo vuelo" subtitle="O viajo por mi cuenta" />
                        )}
                      </div>
                    </SubBlock>
                  )}

                  {/* Hospedaje */}
                  {cityHosp.length > 0 && (
                    <SubBlock icon={Hotel} title="Hospedaje">
                      <div className="grid md:grid-cols-3 gap-3">
                        {cityHosp.map((h: any) => {
                          const i = (trip.hospedaje_json ?? []).indexOf(h);
                          const active = selHospedaje === i;
                          return (
                            <HotelCard key={i} hotel={h} city={city} active={active} onClick={() => setSelHospedaje(i)} />
                          );
                        })}
                        {!isMulti && (
                          <SkipCard active={selHospedaje === -1} onClick={() => setSelHospedaje(-1)}
                            title="Ya tengo dónde quedarme" subtitle="Casa de un amigo, Airbnb propio…" />
                        )}
                      </div>
                    </SubBlock>
                  )}

                  {/* Itinerario día por día */}
                  {cityDays.length > 0 && (
                    <SubBlock icon={Calendar} title="Itinerario día por día">
                      <div className="space-y-2">
                        {cityDays.map((d: any) => (
                          <details key={d.dia} className="rounded-xl border border-border/60 bg-surface/40 group">
                            <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
                              <div className="flex items-center gap-3">
                                <span className="font-display text-xl gold-text w-8">{String(d.dia).padStart(2, "0")}</span>
                                <span className="font-medium text-sm">{d.titulo}</span>
                              </div>
                              <ChevronDown className="w-4 h-4 text-primary transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-2 text-xs">
                              <div><span className="text-primary tracking-wider uppercase">Mañana</span><p className="mt-0.5 text-muted-foreground">{d["mañana"] ?? d.manana}</p></div>
                              <div><span className="text-primary tracking-wider uppercase">Tarde</span><p className="mt-0.5 text-muted-foreground">{d.tarde}</p></div>
                              <div><span className="text-primary tracking-wider uppercase">Noche</span><p className="mt-0.5 text-muted-foreground">{d.noche}</p></div>
                            </div>
                          </details>
                        ))}
                      </div>
                    </SubBlock>
                  )}

                  {/* Experiencias */}
                  {cityTours.length > 0 && (
                    <SubBlock icon={Compass} title="Experiencias">
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {cityTours.map((t: any) => {
                          const i = (trip.tours_json ?? []).indexOf(t);
                          const active = selTours.has(i);
                          return (
                            <ExpandableItemCard
                              key={i}
                              imageQuery={`${t.nombre} ${city} experience tour`}
                              eyebrow={t.duracion}
                              title={t.nombre}
                              price={t.precio_por_persona > 0 ? fmtMXN(t.precio_por_persona) : undefined}
                              active={active}
                              selectable
                              onToggle={() => toggleTour(i)}
                            >
                              <p className="italic">{t.por_que}</p>
                            </ExpandableItemCard>
                          );
                        })}
                      </div>
                    </SubBlock>
                  )}

                  {/* Mesa reservada */}
                  {cityRest.length > 0 && (
                    <SubBlock icon={Utensils} title="Mesa reservada">
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {cityRest.map((r: any, i: number) => (
                          <ExpandableItemCard
                            key={i}
                            imageQuery={`${r.nombre} ${city} restaurant food`}
                            eyebrow={r.cocina}
                            title={r.nombre.replace(` · ${city}`, "")}
                            price={r.rango_precio}
                          >
                            <p className="italic">{r.por_que}</p>
                          </ExpandableItemCard>
                        ))}
                      </div>
                    </SubBlock>
                  )}
                </div>
              </CityCollapsible>
              {isMulti && cityIdx < allCities.length - 1 && (
                <FlightConnector from={city} to={allCities[cityIdx + 1]} />
              )}
              </div>
            );
          })}
        </div>

        {/* Cruceros alternativos */}
        {Array.isArray(trip.cruceros_json) && trip.cruceros_json.length > 0 && (
          <details className="glass-card rounded-2xl group" open>
            <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <Ship className="w-5 h-5 text-primary" />
                <h2 className="font-display text-xl">¿Y si lo haces en crucero?</h2>
                <span className="text-xs text-muted-foreground">({trip.cruceros_json.length} alternativas reales)</span>
              </div>
              <ChevronDown className="w-5 h-5 text-primary transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 pt-1 border-t border-border/40 space-y-3">
              <p className="text-xs text-muted-foreground italic">
                Reemplazan parte del itinerario por isla/puerto con un crucero todo-incluido. Precios cotizados por persona.
              </p>
              {trip.cruceros_json.map((c: any, i: number) => {
                const ahorro = Number(c.ahorro_vs_islas_independiente) || 0;
                const dest = encodeURIComponent(c.puerto_salida?.includes("Atenas") || c.puerto_salida?.toLowerCase().includes("pir") ? "Greek Isles" : "Mediterranean");
                const cruceroUrl = `/dashboard/cruceros?dest=${dest}${c.fecha_salida_sugerida ? `&depart=${c.fecha_salida_sugerida}` : ""}`;
                return (
                  <div key={i} className="rounded-xl border border-border/60 bg-surface/40 p-4 md:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="text-[10px] tracking-[0.2em] uppercase text-primary">{c.naviera}{c.barco ? ` · ${c.barco}` : ""}</p>
                        <h3 className="font-display text-lg leading-tight mt-0.5">{c.nombre_itinerario}</h3>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 whitespace-nowrap">
                        {c.noches} noches · {c.categoria_cabina}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <span className="font-medium text-foreground/80">Sale de:</span> {c.puerto_salida}
                      {c.fecha_salida_sugerida && <> · <span className="font-medium text-foreground/80">Fecha:</span> {c.fecha_salida_sugerida}</>}
                    </p>
                    {Array.isArray(c.puertos_visitados) && c.puertos_visitados.length > 0 && (
                      <p className="text-xs mb-2"><span className="text-muted-foreground">Ruta:</span> {c.puertos_visitados.join(" → ")}</p>
                    )}
                    {Array.isArray(c.incluye) && c.incluye.length > 0 && (
                      <p className="text-xs mb-2"><span className="text-muted-foreground">Incluye:</span> {c.incluye.join(", ")}</p>
                    )}
                    <p className="text-sm italic text-foreground/80 mb-3">{c.por_que}</p>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="font-display text-2xl">{fmtMXN(c.precio_por_persona)}</p>
                        <p className="text-[11px] text-muted-foreground">por persona</p>
                        {ahorro !== 0 && (
                          <p className={`text-xs mt-1 ${ahorro > 0 ? "text-emerald-400" : "text-amber-400"}`}>
                            {ahorro > 0 ? "Ahorras ≈ " : "Cuesta ≈ "}{fmtMXN(Math.abs(ahorro))} vs island-hop independiente
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => navigate(cruceroUrl)}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition"
                      >
                        Ver y reservar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* Tips */}
        {trip.tips_personalizados?.length > 0 && (
          <details className="glass-card rounded-2xl group">
            <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <Lightbulb className="w-5 h-5 text-primary" />
                <h2 className="font-display text-xl">Tips de tu concierge</h2>
                <span className="text-xs text-muted-foreground">({trip.tips_personalizados.length})</span>
              </div>
              <ChevronDown className="w-5 h-5 text-primary transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 pt-1 border-t border-border/40 space-y-3">
              {trip.tips_personalizados.map((t: string, i: number) => (
                <div key={i} className="flex gap-3">
                  <span className="font-display gold-text text-lg flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm text-foreground/90 leading-relaxed">{t}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Desglose */}
        {computedTotal > 0 && (
          <details className="glass-card rounded-2xl group">
            <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <Compass className="w-5 h-5 text-primary" />
                <h2 className="font-display text-xl">Desglose de presupuesto</h2>
              </div>
              <ChevronDown className="w-5 h-5 text-primary transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 pt-1 border-t border-border/40">
              <ReadonlyBudget
                desglose={computedDesglose}
                total={computedTotal}
                vuelos={trip.vuelos_json ?? []}
                travelers={viajeros}
              />

            </div>
          </details>
        )}
      </div>
    </DashboardLayout>
  );
};

// Sub-bloque dentro de un destino: header pequeño + contenido
const SubBlock = ({ icon: Icon, title, children }: any) => (
  <div>
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="font-display text-lg">{title}</h3>
    </div>
    {children}
  </div>
);

// Elegante conector de vuelo entre destinos (multi-ciudad)
const FlightConnector = ({ from, to }: { from: string; to: string }) => (
  <div className="relative my-5 md:my-7 select-none" aria-hidden="true">
    <div className="flex items-center gap-4 px-2">
      <span className="hidden sm:inline text-[10px] tracking-[0.3em] uppercase text-muted-foreground/70 whitespace-nowrap">
        {from}
      </span>
      <div className="relative flex-1 h-px">
        {/* línea base sutil */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* línea punteada dorada */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--primary) / 0.5) 50%, transparent 0%)",
            backgroundSize: "8px 1px",
            backgroundRepeat: "repeat-x",
          }}
        />
        {/* avión deslizándose */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          initial={{ left: "0%" }}
          animate={{ left: ["0%", "100%"] }}
          transition={{ duration: 6, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.5 }}
        >
          <div className="-translate-x-1/2 relative">
            {/* glow */}
            <div className="absolute inset-0 blur-md bg-primary/40 rounded-full" />
            <Plane className="relative w-4 h-4 text-primary rotate-90 drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]" />
          </div>
        </motion.div>
      </div>
      <span className="hidden sm:inline text-[10px] tracking-[0.3em] uppercase text-primary whitespace-nowrap">
        {to}
      </span>
    </div>
  </div>
);


// Agrupa items por su campo `ciudad`, respetando el orden de `cityOrder`
const groupByCity = <T extends { ciudad?: string }>(items: T[], cityOrder: string[]): [string, T[]][] => {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const c = it.ciudad || "Otros";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(it);
  }
  const ordered: [string, T[]][] = [];
  for (const c of cityOrder) {
    if (groups.has(c)) {
      ordered.push([c, groups.get(c)!]);
      groups.delete(c);
    }
  }
  for (const [c, arr] of groups) ordered.push([c, arr]);
  return ordered;
};

const SelectedBadge = () => (
  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
    <Check className="w-3.5 h-3.5" />
  </div>
);

const SkipCard = ({ active, onClick, title, subtitle }: { active: boolean; onClick: () => void; title: string; subtitle: string }) => (
  <div
    onClick={onClick}
    className={`rounded-xl p-6 border-2 border-dashed cursor-pointer transition flex flex-col items-center justify-center text-center min-h-[160px] ${
      active ? "border-primary bg-primary/5" : "border-border/40 hover:border-primary/50 hover:bg-surface/40"
    }`}
  >
    <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${active ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground"}`}>
      {active ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
    </div>
    <p className="font-medium text-sm mb-1">{title}</p>
    <p className="text-xs text-muted-foreground">{subtitle}</p>
    <p className="text-[11px] text-primary mt-2">No suma al presupuesto</p>
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

const MODE_ICON: Record<string, any> = {
  vuelo: Plane,
  tren: Train,
  roadtrip: Car,
  bus: Bus,
  ferry: Ship,
  vuelo_interno: Plane,
};

const MODE_LABEL: Record<string, string> = {
  vuelo: "Vuelo",
  tren: "Tren",
  roadtrip: "Roadtrip",
  bus: "Bus",
  ferry: "Ferry",
  vuelo_interno: "Vuelo interno",
};

const ArrivalOptionCard = ({ option, active, onClick }: { option: any; active: boolean; onClick: () => void }) => {
  const Icon = MODE_ICON[option.mode] || Plane;
  const modeLabel = MODE_LABEL[option.mode] || "Transporte";
  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl p-5 cursor-pointer transition border ${
        active ? "border-primary ring-1 ring-primary/40 bg-primary/5" : "border-border/60 bg-surface/40 hover:border-primary/50"
      }`}
    >
      {active && (
        <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Check className="w-3.5 h-3.5" />
        </div>
      )}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-primary">{modeLabel}{option.tier ? ` · ${option.tier}` : ""}</p>
          <p className="font-medium text-sm">{option.aerolinea || option.provider}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        {option.from && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            {option.from} <ArrowRight className="w-3 h-3" /> {option.to || option.ciudad}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {option.duracion && <span className="px-2 py-0.5 rounded-full bg-background border border-border">{option.duracion}</span>}
        {option.escalas && <span className="px-2 py-0.5 rounded-full bg-background border border-border">{option.escalas}</span>}
      </div>
      {option.precio_por_persona > 0 && (
        <p className="font-medium text-base">
          {fmtMXN(option.precio_por_persona)}
          <span className="text-xs text-muted-foreground ml-1">/ persona</span>
        </p>
      )}
      {option.notas && <p className="text-xs text-muted-foreground mt-2 italic">{option.notas}</p>}
    </div>
  );
};

const HotelCard = ({ hotel, city, active, onClick }: { hotel: any; city: string; active: boolean; onClick: () => void }) => {
  const img = useCityImage(`${hotel.nombre} ${city} hotel`);
  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl overflow-hidden cursor-pointer transition border ${
        active ? "border-primary ring-1 ring-primary/40" : "border-border/60 hover:border-primary/50"
      }`}
    >
      <div className="relative h-32 w-full overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: img
              ? `url(${img})`
              : "linear-gradient(135deg, hsl(var(--surface)), hsl(var(--card)))",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
        {active && (
          <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
            <Check className="w-3.5 h-3.5" />
          </div>
        )}
        <p className="absolute top-3 left-3 text-[10px] tracking-[0.2em] uppercase text-primary bg-background/70 backdrop-blur-sm px-2 py-0.5 rounded-full border border-primary/30">
          {hotel.tier || hotel.tipo}
        </p>
      </div>
      <div className="p-5 bg-card">
        <p className="font-display text-lg mb-1 leading-tight">{hotel.nombre}</p>
        <p className="text-xs text-muted-foreground mb-2">{hotel.barrio} · ★ {hotel.rating}</p>
        <p className="font-medium text-sm mb-2">
          {fmtMXN(hotel.precio_por_noche)}
          <span className="text-xs text-muted-foreground ml-1">/ noche</span>
        </p>
        <p className="text-xs text-muted-foreground italic line-clamp-3">{hotel.por_que}</p>
      </div>
    </div>
  );
};

export default TripDetail;
