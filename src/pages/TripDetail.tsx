import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Calendar, Users, Plane, Hotel, Utensils, Compass, Lightbulb, Star, Check, X, Train, Car, Mountain, ArrowRight, Bus, Ship, Route as RouteIcon, ChevronDown, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { ReadonlyBudget } from "@/components/ReadonlyBudget";
import { CityCollapsible, useCityImage } from "@/components/CityCollapsible";
import { ExpandableItemCard } from "@/components/ExpandableItemCard";
import { EditWithAIDialog } from "@/components/EditWithAIDialog";
import { LiveTripQuote } from "@/components/LiveTripQuote";
import { generateTripPDF } from "@/lib/tripPdf";
import { toast } from "sonner";
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
  const [nochesHospedaje, setNochesHospedaje] = useState<number | null>(null); // null = usar todas las noches
  const [selTours, setSelTours] = useState<Set<number>>(new Set());
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const toggleCity = (city: string) => {
    setAutoScroll(false); // user took manual control
    setActiveCity((prev) => (prev === city ? null : city));
    // Re-enable auto after a short moment so future scrolling works normally
    window.setTimeout(() => setAutoScroll(true), 1500);
  };
  const cityRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const loadTrip = async () => {
    if (!id) return;
    const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
    setTrip(data);
    const tours = (data as any)?.tours_json;
    if (Array.isArray(tours) && tours.length) {
      setSelTours(new Set(tours.map((_: any, i: number) => i)));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-accordion: open the city whose header is near the top of the viewport
  useEffect(() => {
    if (!trip) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!autoScroll) return;
        // Find the entry closest to top that is intersecting
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const city = (visible[0].target as HTMLElement).dataset.city;
          if (city && city !== activeCity) setActiveCity(city);
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    Object.entries(cityRefs.current).forEach(([city, el]) => {
      if (el) {
        el.dataset.city = city;
        obs.observe(el);
      }
    });
    return () => obs.disconnect();
  }, [trip, autoScroll, activeCity]);

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
        <button
          onClick={() => navigate("/dashboard")}
          className="absolute top-6 left-6 inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card text-sm hover:gold-border transition"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <button
            onClick={handleDownloadPdf}
            disabled={generatingPdf}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-full glass-card text-xs hover:gold-border transition disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-primary" />
            {generatingPdf ? "Generando…" : "Compartir PDF"}
          </button>
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
            const cityVuelos = isMulti
              ? (trip.vuelos_json ?? []).filter((v: any) => (v.ciudad || v.to) === city)
              : (trip.vuelos_json ?? []);
            const cityHosp = isMulti
              ? (trip.hospedaje_json ?? []).filter((h: any) => h.ciudad === city)
              : (trip.hospedaje_json ?? []);
            const cityDays = isMulti
              ? itinDays.filter((d: any) => d.ciudad === city)
              : itinDays;
            const cityTours = isMulti
              ? (trip.tours_json ?? []).filter((t: any) => t.ciudad === city)
              : (trip.tours_json ?? []);
            const cityRest = isMulti
              ? (trip.restaurantes_json ?? []).filter((r: any) => r.ciudad === city)
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
              <ReadonlyBudget desglose={computedDesglose} total={computedTotal} />
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
