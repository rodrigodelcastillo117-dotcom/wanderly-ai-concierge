import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Heart, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { logInsight } from "@/lib/insights";
import { motion, AnimatePresence } from "framer-motion";

declare global { interface Window { google: any; initMap?: () => void; } }

type Poi = {
  id: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
};

// Mock POIs por ciudad — el AI los curaría dinámicamente
const POIS_BY_CITY: Record<string, { center: { lat: number; lng: number }; pois: Poi[] }> = {
  paris: {
    center: { lat: 48.8566, lng: 2.3522 },
    pois: [
      { id: "eiffel", name: "Torre Eiffel", category: "Ícono", description: "Símbolo de París — mejor al atardecer.", lat: 48.8584, lng: 2.2945 },
      { id: "louvre", name: "Museo del Louvre", category: "Cultura", description: "El museo de arte más grande del mundo.", lat: 48.8606, lng: 2.3376 },
      { id: "marais", name: "Café del Marais", category: "Gastronomía", description: "Bistró íntimo recomendado para ti.", lat: 48.8575, lng: 2.3622 },
      { id: "montmartre", name: "Montmartre", category: "Cultura", description: "Barrio artístico con vistas panorámicas.", lat: 48.8867, lng: 2.3431 },
      { id: "orsay", name: "Musée d'Orsay", category: "Cultura", description: "Impresionismo en una antigua estación.", lat: 48.8600, lng: 2.3266 },
    ],
  },
  tokyo: {
    center: { lat: 35.6762, lng: 139.6503 },
    pois: [
      { id: "shibuya", name: "Cruce de Shibuya", category: "Ícono", description: "El cruce peatonal más concurrido del mundo.", lat: 35.6595, lng: 139.7004 },
      { id: "senso", name: "Templo Sensō-ji", category: "Cultura", description: "El templo más antiguo de Tokio.", lat: 35.7148, lng: 139.7967 },
      { id: "tsukiji", name: "Mercado Tsukiji", category: "Gastronomía", description: "Sushi al amanecer.", lat: 35.6654, lng: 139.7707 },
    ],
  },
  cdmx: {
    center: { lat: 19.4326, lng: -99.1332 },
    pois: [
      { id: "zocalo", name: "Zócalo", category: "Ícono", description: "Plaza principal y corazón histórico.", lat: 19.4326, lng: -99.1332 },
      { id: "chapultepec", name: "Bosque de Chapultepec", category: "Naturaleza", description: "El pulmón verde de la ciudad.", lat: 19.4204, lng: -99.1813 },
      { id: "pujol", name: "Pujol", category: "Gastronomía", description: "Cocina mexicana contemporánea de talla mundial.", lat: 19.4341, lng: -99.1953 },
    ],
  },
};

// Estilo Google Maps dark luxury
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0a0a0a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0a0a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b7355" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#C9A961" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6b5a45" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#141414" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c1c1c" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#000000" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8b7355" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2a2a2a" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1c1c1c" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#050505" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3f3528" }] },
];

const PIN_GOLD = "#C9A961";
const PIN_CREAM = "#F5F1EA";

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function nearestCityKey(loc: { lat: number; lng: number }): keyof typeof POIS_BY_CITY {
  let best: keyof typeof POIS_BY_CITY = "cdmx";
  let bestD = Infinity;
  (Object.keys(POIS_BY_CITY) as (keyof typeof POIS_BY_CITY)[]).forEach((k) => {
    const d = haversineKm(loc, POIS_BY_CITY[k].center);
    if (d < bestD) { bestD = d; best = k; }
  });
  return best;
}

const Cercanos = () => {
  const { user } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const markers = useRef<Map<string, any>>(new Map());
  const userMarker = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [favorited, setFavorited] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Poi | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const cityKey = useMemo<keyof typeof POIS_BY_CITY>(
    () => (userLoc ? nearestCityKey(userLoc) : "cdmx"),
    [userLoc]
  );
  const city = useMemo(() => POIS_BY_CITY[cityKey], [cityKey]);

  // Cargar viaje activo + visitas previas
  useEffect(() => {
    if (!user) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data: trips } = await supabase
        .from("trips")
        .select("id,destino,fecha_salida,fecha_regreso")
        .eq("user_id", user.id)
        .gte("fecha_regreso", today)
        .order("fecha_salida", { ascending: true })
        .limit(1);
      if (trips && trips.length) setActiveTrip(trips[0]);

      const { data: visits } = await supabase
        .from("user_visits")
        .select("place_id")
        .eq("user_id", user.id);
      setVisited(new Set((visits ?? []).map((v: any) => v.place_id).filter(Boolean)));
    })();
  }, [user]);

  // Cargar script de Google Maps
  useEffect(() => {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
    const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
    if (!key) return;
    if (window.google?.maps) { setMapReady(true); return; }
    if (document.getElementById("gmaps-script")) return;

    window.initMap = () => setMapReady(true);
    const s = document.createElement("script");
    s.id = "gmaps-script";
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=initMap${channel ? `&channel=${channel}` : ""}`;
    document.head.appendChild(s);
  }, []);

  // Pedir ubicación del usuario en tiempo real
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGeoError("Tu navegador no soporta geolocalización.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        setGeoError(err.message);
        toast.error("No pudimos acceder a tu ubicación. Activa el permiso en tu navegador.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Inicializar mapa cuando script + ubicación listos
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const center = userLoc ?? city.center;
    if (!mapObj.current) {
      mapObj.current = new window.google.maps.Map(mapRef.current, {
        center,
        zoom: 14,
        minZoom: 3,
        maxZoom: 18,
        styles: DARK_STYLE,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      setTimeout(() => {
        if (!mapObj.current) return;
        window.google.maps.event.trigger(mapObj.current, "resize");
        mapObj.current.setCenter(center);
      }, 100);
    } else {
      mapObj.current.setCenter(center);
    }

    // Marker del usuario (azul cian, distintivo)
    if (userLoc) {
      if (userMarker.current) userMarker.current.setMap(null);
      userMarker.current = new window.google.maps.Marker({
        position: userLoc,
        map: mapObj.current,
        title: "Tu ubicación",
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#4A90E2",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
        zIndex: 999,
      });
    }

    // Limpiar markers POI anteriores
    markers.current.forEach((m) => m.setMap(null));
    markers.current.clear();

    const bounds = new window.google.maps.LatLngBounds();
    if (userLoc) bounds.extend(userLoc);

    // Solo mostrar POIs curados si el usuario está razonablemente cerca (<200km)
    const cityDist = userLoc ? haversineKm(userLoc, city.center) : 0;
    const showPois = !userLoc || cityDist < 200;

    if (showPois) {
      city.pois.forEach((p) => {
        const isVisited = visited.has(p.id);
        const marker = new window.google.maps.Marker({
          position: { lat: p.lat, lng: p.lng },
          map: mapObj.current,
          title: p.name,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: isVisited ? PIN_GOLD : PIN_CREAM,
            fillOpacity: 1,
            strokeColor: PIN_GOLD,
            strokeWeight: 2,
          },
        });
        marker.addListener("click", () => {
          setSelected(p);
          logInsight("viewed", "destination", p.name, { city: cityKey });
        });
        markers.current.set(p.id, marker);
        bounds.extend({ lat: p.lat, lng: p.lng });
      });
    }

    if ((showPois && city.pois.length > 0) || userLoc) {
      mapObj.current.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });
      // Si solo hay un punto (usuario sin POIs cercanos), forzar zoom razonable
      if (!showPois) {
        setTimeout(() => mapObj.current?.setZoom(14), 150);
      }
    }
  }, [mapReady, city, visited, cityKey, userLoc]);


  const toggleFav = (p: Poi) => {
    const isFav = favorited.has(p.id);
    setFavorited((s) => {
      const n = new Set(s);
      isFav ? n.delete(p.id) : n.add(p.id);
      return n;
    });
    logInsight(isFav ? "removed" : "saved", "destination", p.name);
  };

  const registerVisit = async (p: Poi) => {
    if (!user) return;
    const { error } = await supabase.from("user_visits").insert([{
      user_id: user.id,
      trip_id: activeTrip?.id ?? null,
      place_name: p.name,
      place_id: p.id,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
    }]);
    if (error) { toast.error("No se pudo registrar"); return; }
    setVisited((s) => new Set(s).add(p.id));
    // recolorear marker
    const m = markers.current.get(p.id);
    if (m) m.setIcon({
      path: window.google.maps.SymbolPath.CIRCLE,
      scale: 10, fillColor: PIN_GOLD, fillOpacity: 1, strokeColor: PIN_GOLD, strokeWeight: 2,
    });
    await logInsight("planned", "destination", p.name, { visited: true });
    toast.success("¡Visita registrada! IATOS AI está aprendiendo de tus gustos.");
    setSelected(null);
  };

  const hasKey = !!import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-6xl">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl md:text-5xl mb-2">Cercanos</h1>
            <p className="text-muted-foreground">
              {userLoc
                ? <>Mostrando lugares cerca de <span className="text-primary">tu ubicación actual</span>.</>
                : geoError
                  ? "Activa la ubicación para ver lugares cerca de ti."
                  : "Detectando tu ubicación…"}
            </p>
          </div>
          {activeTrip && (
            <div className="text-right">
              <p className="text-xs text-primary tracking-[0.2em] uppercase">Viaje activo</p>
              <p className="text-sm">{new Date(activeTrip.fecha_salida).toLocaleDateString("es-MX")} → {new Date(activeTrip.fecha_regreso).toLocaleDateString("es-MX")}</p>
            </div>
          )}
        </div>

        <div className="glass-card rounded-2xl overflow-hidden gold-border">
          {hasKey ? (
            <div ref={mapRef} className="w-full aspect-[16/10] md:aspect-[16/9]" />
          ) : (
            <div className="aspect-[16/9] flex flex-col items-center justify-center text-center p-8">
              <MapPin className="w-10 h-10 text-primary mb-3" />
              <p className="text-sm text-muted-foreground">Configurando Google Maps…</p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#F5F1EA]" /> Por visitar
          <span className="w-2.5 h-2.5 rounded-full bg-primary ml-3" /> Visitado
        </p>
      </div>

      {/* Bottom sheet */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed inset-x-0 bottom-0 z-50 md:inset-x-auto md:right-8 md:bottom-8 md:max-w-md"
            >
              <div className="glass-card rounded-t-3xl md:rounded-3xl border border-primary/30 p-6 premium-shadow">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <p className="text-xs text-primary tracking-[0.2em] uppercase mb-1">{selected.category}</p>
                    <h3 className="font-display text-2xl">{selected.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleFav(selected)}
                      className="p-2 rounded-full bg-surface hover:bg-surface-elevated transition"
                      aria-label="Favorito"
                    >
                      <Heart className={`w-4 h-4 ${favorited.has(selected.id) ? "fill-primary text-primary" : "text-foreground"}`} />
                    </button>
                    <button onClick={() => setSelected(null)} className="p-2 rounded-full bg-surface hover:bg-surface-elevated transition">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-6">{selected.description}</p>

                {visited.has(selected.id) ? (
                  <div className="w-full text-center py-3 rounded-full border border-primary/40 text-primary text-sm">
                    ✓ Ya visitaste este lugar
                  </div>
                ) : (
                  <button
                    onClick={() => registerVisit(selected)}
                    className="w-full py-3 rounded-full bg-gradient-gold text-primary-foreground font-medium gold-glow hover:opacity-90 transition"
                  >
                    📍 Registrar Visita
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default Cercanos;
