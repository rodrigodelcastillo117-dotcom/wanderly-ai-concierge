import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin, Calendar, Hotel, Utensils, Activity, ExternalLink, Plane, Ship, Car } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
const TRACKING = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;

declare global {
  interface Window {
    initTripMap?: () => void;
  }
}

// Cache global de geocoding
const geoCache = new Map<string, { lat: number; lng: number } | null>();
async function geocode(q: string): Promise<{ lat: number; lng: number } | null> {
  const key = q.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    const { data } = await supabase.functions.invoke("geocode", { body: { address: q } });
    const r = Array.isArray(data?.results) ? data.results[0] : null;
    const v = r && typeof r.lat === "number" ? { lat: r.lat, lng: r.lng } : null;
    geoCache.set(key, v);
    return v;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

// Estilo nocturno minimal para que el dorado destaque
const NIGHT_STYLE: any[] = [
  { elementType: "geometry", stylers: [{ color: "#0b0f1a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b0f1a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#2a3142" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d4af37" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2030" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#04070d" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3b4358" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#0f1421" }] },
];

type Stop = {
  name: string;
  city?: string;
  lat: number;
  lng: number;
  kind: "hotel" | "restaurant" | "tour" | "port" | "city";
  order: number;
};

// Detecta el modo de transporte entre 2 ciudades consultando vuelos/cruceros del viaje
function detectMode(
  from: string,
  to: string,
  vuelos: any[],
  cruceros: any[],
): "flight" | "cruise" | "land" {
  const norm = (s: string) => (s ?? "").toLowerCase().trim();
  const f = norm(from), t = norm(to);
  for (const v of vuelos) {
    const vf = norm(v?.from ?? v?.ciudad_origen ?? "");
    const vt = norm(v?.to ?? v?.ciudad ?? "");
    if (vf && vt && (vf.includes(f) || f.includes(vf)) && (vt.includes(t) || t.includes(vt))) return "flight";
  }
  for (const c of cruceros) {
    const ports = (c?.puertos ?? c?.itinerario ?? []) as any[];
    const names = ports.map((p) => norm(typeof p === "string" ? p : (p?.puerto ?? p?.ciudad ?? "")));
    for (let i = 0; i < names.length - 1; i++) {
      if (names[i].includes(f) && names[i + 1].includes(t)) return "cruise";
    }
  }
  return "land";
}

const TripMap = () => {
  const { id } = useParams();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number>(-1);
  const [mapReady, setMapReady] = useState(false);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  // 1. Cargar datos del viaje
  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(data);
      setLoading(false);
    })();
  }, [id]);

  // 2. Cargar script Maps JS
  useEffect(() => {
    if (!BROWSER_KEY) return;
    if ((window as any).google?.maps) { setMapReady(true); return; }
    if (document.getElementById("gmaps-trip-script")) return;
    window.initTripMap = () => setMapReady(true);
    const s = document.createElement("script");
    s.id = "gmaps-trip-script";
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&loading=async&callback=initTripMap${TRACKING ? `&channel=${TRACKING}` : ""}`;
    document.head.appendChild(s);
  }, []);

  // 3. Inicializar el mapa una vez
  useEffect(() => {
    if (!mapReady || !mapDivRef.current || mapRef.current) return;
    mapRef.current = new (window as any).google.maps.Map(mapDivRef.current, {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      styles: NIGHT_STYLE,
      disableDefaultUI: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      backgroundColor: "#04070d",
    });
  }, [mapReady]);

  // 3b. Centra inmediatamente en el destino del viaje (fallback visual antes de geocodificar paradas)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !trip) return;
    const seed = [trip.destino, trip.pais_destino].filter(Boolean).join(", ");
    if (!seed) return;
    let cancelled = false;
    (async () => {
      const pt = await geocode(seed);
      if (cancelled || !pt) return;
      mapRef.current.setCenter({ lat: pt.lat, lng: pt.lng });
      mapRef.current.setZoom(9);
    })();
    return () => { cancelled = true; };
  }, [mapReady, trip]);

  const days = useMemo(() => {
    if (!trip) return [];
    const itin = trip.itinerario_json;
    return Array.isArray(itin) ? itin : Array.isArray(itin?.days) ? itin.days : [];
  }, [trip]);
  const dayPlan = days[selectedDay] ?? null;
  const acts: any[] = dayPlan?.actividades ?? dayPlan?.plan ?? [];
  const showAll = selectedDay < 0;

  // 4. Geocodificar + dibujar todo cuando hay datos
  useEffect(() => {
    if (!trip || !mapRef.current || !(window as any).google?.maps) return;
    const map = mapRef.current;
    const g = (window as any).google.maps;
    let cancelled = false;

    // Limpia overlays previos
    overlaysRef.current.forEach((o) => o.setMap?.(null));
    overlaysRef.current = [];

    (async () => {
      const hosp: any[] = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
      const rest: any[] = Array.isArray(trip.restaurantes_json) ? trip.restaurantes_json : [];
      const tours: any[] = Array.isArray(trip.tours_json) ? trip.tours_json : [];
      const vuelos: any[] = Array.isArray(trip.vuelos_json) ? trip.vuelos_json : [];
      const cruceros: any[] = Array.isArray(trip.cruceros_json) ? trip.cruceros_json : [];

      // Si hay día seleccionado, filtra a actividades + hospedaje de ese día
      const filterDay = !showAll && dayPlan;
      const dayCity = (dayPlan?.ciudad as string) ?? "";

      // Ordena hoteles por check_in para tener orden cronológico
      const sortedHotels = [...hosp].sort((a, b) => {
        const da = a?.check_in ? new Date(a.check_in).getTime() : 0;
        const db = b?.check_in ? new Date(b.check_in).getTime() : 0;
        return da - db;
      });

      // ---- 4a. Geocodifica hoteles (ordenados) → ruta principal ----
      const hotelStops: Stop[] = [];
      for (let i = 0; i < sortedHotels.length; i++) {
        const h = sortedHotels[i];
        const name = h?.nombre ?? h?.hotel ?? `Hotel ${i + 1}`;
        const city = h?.ciudad ?? h?.city ?? "";
        if (filterDay && city && !city.toLowerCase().includes(dayCity.toLowerCase())) continue;
        const q = h?.direccion ? `${h.direccion}, ${city}` : `${name}, ${city}`;
        const c = await geocode(q);
        if (cancelled) return;
        if (c) hotelStops.push({ name, city, lat: c.lat, lng: c.lng, kind: "hotel", order: i });
      }

      // ---- 4b. Puertos del crucero ----
      const portStops: Stop[] = [];
      for (const cr of cruceros) {
        const ports = (cr?.puertos ?? cr?.itinerario ?? []) as any[];
        for (const p of ports) {
          const pn = typeof p === "string" ? p : (p?.puerto ?? p?.ciudad ?? "");
          if (!pn) continue;
          if (filterDay && !pn.toLowerCase().includes(dayCity.toLowerCase())) continue;
          const c = await geocode(`puerto de ${pn}`);
          if (cancelled) return;
          if (c) portStops.push({ name: pn, city: pn, lat: c.lat, lng: c.lng, kind: "port", order: portStops.length });
        }
      }

      // ---- 4c. Restaurantes ----
      const restStops: Stop[] = [];
      for (let i = 0; i < rest.length; i++) {
        const r = rest[i];
        const name = r?.nombre ?? r?.titulo ?? `Restaurante ${i + 1}`;
        const city = r?.ciudad ?? "";
        if (filterDay && city && !city.toLowerCase().includes(dayCity.toLowerCase())) continue;
        const c = await geocode(`${name}, ${city || trip.destino}`);
        if (cancelled) return;
        if (c) restStops.push({ name, city, lat: c.lat, lng: c.lng, kind: "restaurant", order: i });
      }

      // ---- 4d. Tours ----
      const tourStops: Stop[] = [];
      for (let i = 0; i < tours.length; i++) {
        const t = tours[i];
        const name = t?.nombre ?? t?.titulo ?? `Tour ${i + 1}`;
        const city = t?.ciudad ?? "";
        if (filterDay && city && !city.toLowerCase().includes(dayCity.toLowerCase())) continue;
        const c = await geocode(`${name}, ${city || trip.destino}`);
        if (cancelled) return;
        if (c) tourStops.push({ name, city, lat: c.lat, lng: c.lng, kind: "tour", order: i });
      }

      const allStops = [...hotelStops, ...portStops, ...restStops, ...tourStops];
      if (allStops.length === 0) return;

      const bounds = new g.LatLngBounds();

      // ---- 5. Ruta principal: hoteles en orden cronológico + puertos al final ----
      const routeStops: Stop[] = [...hotelStops];
      // intercala puertos en su posición temporal aproximada (después del último hotel previo al embarque)
      if (portStops.length) routeStops.push(...portStops);

      // Dibuja un segmento por par consecutivo con estilo según modo
      for (let i = 0; i < routeStops.length - 1; i++) {
        const a = routeStops[i];
        const b = routeStops[i + 1];
        const mode = detectMode(a.city ?? a.name, b.city ?? b.name, vuelos, cruceros);

        const style =
          mode === "flight"
            ? { color: "#f5e6a8", dashed: true, weight: 3 }
            : mode === "cruise"
            ? { color: "#7fd4ff", dashed: true, weight: 3 }
            : { color: "#d4af37", dashed: false, weight: 4 };

        const path = [
          { lat: a.lat, lng: a.lng },
          { lat: b.lat, lng: b.lng },
        ];
        const opts: any = {
          path,
          map,
          strokeColor: style.color,
          strokeWeight: style.weight,
          strokeOpacity: style.dashed ? 0 : 0.95,
          geodesic: mode === "flight", // arco real para vuelos
        };
        if (style.dashed) {
          opts.icons = [{
            icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3, strokeColor: style.color },
            offset: "0", repeat: "14px",
          }];
        }
        const poly = new g.Polyline(opts);
        overlaysRef.current.push(poly);

        // Etiqueta del modo en el centro del segmento
        const midLat = (a.lat + b.lat) / 2;
        const midLng = (a.lng + b.lng) / 2;
        const modeLabel =
          mode === "flight" ? "✈ Avión" : mode === "cruise" ? "⚓ Crucero" : "🚗 Tierra";
        const lbl = new g.Marker({
          position: { lat: midLat, lng: midLng },
          map,
          icon: { path: g.SymbolPath.CIRCLE, scale: 0, strokeOpacity: 0, fillOpacity: 0 },
          label: {
            text: modeLabel,
            color: style.color,
            fontSize: "11px",
            fontWeight: "600",
            className: "trip-mode-label",
          },
        });
        overlaysRef.current.push(lbl);
      }

      // ---- 6. Marcadores ----
      const svgIcon = (color: string, char: string) => ({
        path: "M12 2C7.6 2 4 5.6 4 10c0 5.5 7 12 8 12s8-6.5 8-12c0-4.4-3.6-8-8-8z",
        fillColor: color,
        fillOpacity: 0.95,
        strokeColor: "#0b0f1a",
        strokeWeight: 1.5,
        scale: 1.6,
        anchor: new g.Point(12, 22),
        labelOrigin: new g.Point(12, 10),
      });

      const placeMarkers = (stops: Stop[], color: string, char: string) => {
        for (const s of stops) {
          const m = new g.Marker({
            position: { lat: s.lat, lng: s.lng },
            map,
            title: s.name,
            icon: svgIcon(color, char),
            label: { text: char, color: "#0b0f1a", fontSize: "12px", fontWeight: "700" },
          });
          const info = new g.InfoWindow({
            content: `<div style="color:#0b0f1a;font-family:system-ui;font-size:13px;font-weight:600;padding:2px 4px">${s.name}${s.city ? `<br><span style="font-weight:400;color:#444">${s.city}</span>` : ""}</div>`,
          });
          m.addListener("click", () => info.open({ anchor: m, map }));
          overlaysRef.current.push(m);
          bounds.extend({ lat: s.lat, lng: s.lng });
        }
      };

      placeMarkers(hotelStops, "#d4af37", "H");
      placeMarkers(portStops, "#7fd4ff", "⚓");
      placeMarkers(restStops, "#f87171", "R");
      placeMarkers(tourStops, "#a78bfa", "T");

      // Marcadores numerados de los hoteles (orden de ruta)
      hotelStops.forEach((s, i) => {
        const m = new g.Marker({
          position: { lat: s.lat, lng: s.lng },
          map,
          icon: { path: g.SymbolPath.CIRCLE, scale: 13, fillColor: "#d4af37", fillOpacity: 1, strokeColor: "#0b0f1a", strokeWeight: 2 },
          label: { text: String(i + 1), color: "#0b0f1a", fontSize: "12px", fontWeight: "700" },
          zIndex: 999,
        });
        overlaysRef.current.push(m);
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, 60);
    })();

    return () => { cancelled = true; };
  }, [trip, selectedDay, mapReady, showAll, dayPlan]);

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Cargando mapa…</div>;
  }
  if (!trip) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Viaje no encontrado</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <BackButton floating />
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[140px]" />
      </div>

      <div className="px-4 md:px-8 pt-14 md:pt-16 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Mapa del viaje</div>
            <h1 className="text-2xl md:text-3xl font-serif">{trip.destino}</h1>
          </div>
        </div>

        {/* Day selector */}
        {days.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1 scrollbar-hide">
            <button
              onClick={() => setSelectedDay(-1)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border transition ${
                showAll ? "bg-primary text-primary-foreground border-primary" : "bg-white/[0.02] border-white/[0.08] text-foreground/70 hover:border-white/[0.16]"
              }`}
            >Todos</button>
            {days.map((_: any, i: number) => (
              <button
                key={i}
                onClick={() => setSelectedDay(i)}
                className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold border transition ${
                  i === selectedDay ? "bg-primary text-primary-foreground border-primary" : "bg-white/[0.02] border-white/[0.08] text-foreground/70 hover:border-white/[0.16]"
                }`}
              >Día {i + 1}</button>
            ))}
          </div>
        )}

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-foreground/70">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#d4af37]" /> Hotel</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#f87171]" /> Restaurante</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#a78bfa]" /> Tour</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#7fd4ff]" /> Puerto</span>
          <span className="mx-1 opacity-30">|</span>
          <span className="inline-flex items-center gap-1.5"><Plane className="w-3 h-3 text-[#f5e6a8]" /> Avión</span>
          <span className="inline-flex items-center gap-1.5"><Ship className="w-3 h-3 text-[#7fd4ff]" /> Crucero</span>
          <span className="inline-flex items-center gap-1.5"><Car className="w-3 h-3 text-[#d4af37]" /> Tierra</span>
        </div>

        {/* Map */}
        <div className="rounded-3xl overflow-hidden border border-white/[0.08] bg-black/30 mb-5 h-[420px] md:h-[520px] relative">
          {!BROWSER_KEY ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/60 px-6 text-center">
              Conecta Google Maps en Conectores para ver el mapa interactivo.
            </div>
          ) : !mapReady ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-foreground/60">
              Cargando Google Maps…
            </div>
          ) : null}
          <div ref={mapDivRef} className="w-full h-full" />
        </div>

        {/* Day plan */}
        {dayPlan && (
          <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-5 md:p-6 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold">Día {selectedDay + 1}{dayPlan.titulo ? ` · ${dayPlan.titulo}` : ""}</h2>
            </div>
            {acts.length > 0 ? (
              <ul className="space-y-2">
                {acts.map((a: any, i: number) => {
                  const text = typeof a === "string" ? a : (a.actividad ?? a.titulo ?? a.descripcion ?? a.lugar ?? "");
                  const place = typeof a === "object" ? (a.lugar ?? text) : text;
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/30 border border-white/[0.04]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</div>
                        <span className="text-sm text-foreground/90 truncate">{text}</span>
                      </div>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place} ${trip.destino}`)}`}
                        target="_blank" rel="noreferrer"
                        className="shrink-0 text-primary hover:text-primary/80"
                      ><ExternalLink className="w-4 h-4" /></a>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-foreground/60">Día libre.</p>
            )}
          </section>
        )}

        {/* Lugares clave */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PlaceList icon={Hotel} label="Hospedajes" items={trip.hospedaje_json ?? []} destino={trip.destino} />
          <PlaceList icon={Utensils} label="Restaurantes" items={trip.restaurantes_json ?? []} destino={trip.destino} />
          <PlaceList icon={Activity} label="Tours" items={trip.tours_json ?? []} destino={trip.destino} />
        </div>
      </div>
    </div>
  );
};

const PlaceList = ({ icon: Icon, label, items, destino }: any) => (
  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="text-sm font-semibold">{label}</h3>
      <span className="text-[10px] text-foreground/50 ml-auto">{items.length}</span>
    </div>
    <ul className="space-y-1.5">
      {items.slice(0, 5).map((it: any, i: number) => {
        const name = it?.nombre ?? it?.titulo ?? it?.hotel ?? `Opción ${i + 1}`;
        return (
          <li key={i}>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${it?.ciudad ?? destino}`)}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-foreground/70 hover:text-primary truncate block"
            >· {name}</a>
          </li>
        );
      })}
      {items.length === 0 && <li className="text-xs text-foreground/40">Sin elementos</li>}
    </ul>
  </div>
);

export default TripMap;
