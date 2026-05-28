import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Heart, MapPin, X, Star, Sparkles, Loader2, Navigation, Check } from "lucide-react";
import { toast } from "sonner";
import { logInsight } from "@/lib/insights";
import { motion, AnimatePresence } from "framer-motion";
import { placePhotoUrl } from "@/lib/googleMaps";
import { formatDateOnly } from "@/lib/dateUtils";
import { RoutesPanel } from "@/components/RoutesPanel";
import { Button } from "@/components/ui/button";

declare global { interface Window { google: any; initMap?: () => void; } }

type NearbyPlace = {
  placeId: string;
  name: string | null;
  address: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  ratings_count: number;
  price_level: string | null;
  types: string[];
  primary_type: string | null;
  maps_url: string | null;
  open_now: boolean | null;
  photo_ref: string | null;
};

type EnrichedPlace = NearbyPlace & {
  visited: boolean;
  cuisine: string | null;
  match_score: number;
  for_you: boolean;
};

type FoodDNA = {
  total_visits?: number;
  avg_rating?: number | null;
  top_cuisines?: Array<{ key: string; count: number }>;
  preferred_price?: string | null;
  top_types?: Array<{ key: string; count: number }>;
} | null;

const TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Restaurantes", value: "restaurant" },
  { label: "Cafés", value: "cafe" },
  { label: "Bares", value: "bar" },
  { label: "Atracciones", value: "tourist_attraction" },
];

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
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#1c1c1c" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#050505" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3f3528" }] },
];

const PIN_GOLD = "#C9A961";
const PIN_CREAM = "#F5F1EA";
const PIN_FORYOU = "#E94E77";

// Mismas reglas de detección que en el edge (versión ligera)
const CUISINE_BY_TYPE: Record<string, string> = {
  italian_restaurant: "italiana", pizza_restaurant: "italiana",
  japanese_restaurant: "japonesa", sushi_restaurant: "japonesa", ramen_restaurant: "japonesa",
  chinese_restaurant: "china", korean_restaurant: "coreana", thai_restaurant: "tailandesa",
  vietnamese_restaurant: "vietnamita", indian_restaurant: "india",
  mexican_restaurant: "mexicana", spanish_restaurant: "española", french_restaurant: "francesa",
  mediterranean_restaurant: "mediterránea", greek_restaurant: "griega",
  turkish_restaurant: "turca", lebanese_restaurant: "libanesa",
  middle_eastern_restaurant: "mediooriental", american_restaurant: "americana",
  hamburger_restaurant: "hamburguesas", steak_house: "carnes",
  barbecue_restaurant: "parrilla", seafood_restaurant: "mariscos",
  vegetarian_restaurant: "vegetariana", vegan_restaurant: "vegana",
  brazilian_restaurant: "brasileña", argentinian_restaurant: "argentina",
  peruvian_restaurant: "peruana", bakery: "panadería", cafe: "café", bar: "bar",
};
function detectCuisine(types: string[], primary: string | null, name: string | null): string | null {
  for (const t of [primary, ...types].filter(Boolean) as string[]) {
    if (CUISINE_BY_TYPE[t]) return CUISINE_BY_TYPE[t];
  }
  if (name && /sushi|ramen/i.test(name)) return "japonesa";
  if (name && /taco|cantina/i.test(name)) return "mexicana";
  if (name && /pizza|pasta/i.test(name)) return "italiana";
  return null;
}

function scorePlace(p: NearbyPlace, cuisine: string | null, dna: FoodDNA): number {
  let s = 0;
  if (typeof p.rating === "number") s += (p.rating - 3) * 8; // hasta +16
  if (p.ratings_count > 100) s += 4;
  if (p.ratings_count > 500) s += 4;
  if (!dna) return s;
  const top = (dna.top_cuisines ?? []).reduce<Record<string, number>>((a, c) => { a[c.key] = c.count; return a; }, {});
  if (cuisine && top[cuisine]) s += Math.min(30, top[cuisine] * 6);
  if (dna.preferred_price && p.price_level === dna.preferred_price) s += 6;
  return s;
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
  const [selected, setSelected] = useState<EnrichedPlace | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [foodDna, setFoodDna] = useState<FoodDNA>(null);
  const [places, setPlaces] = useState<EnrichedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeType, setActiveType] = useState<string>("restaurant");
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Cargar viaje activo, visitados, food_dna
  useEffect(() => {
    if (!user) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: trips }, { data: visits }, { data: profile }] = await Promise.all([
        supabase.from("trips").select("id,destino,fecha_salida,fecha_regreso")
          .eq("user_id", user.id).gte("fecha_regreso", today)
          .order("fecha_salida", { ascending: true }).limit(1),
        supabase.from("visited_places").select("place_id").eq("user_id", user.id).eq("status", "visited"),
        supabase.from("profiles").select("food_dna").eq("id", user.id).maybeSingle(),
      ]);
      if (trips?.length) setActiveTrip(trips[0]);
      setVisited(new Set((visits ?? []).map((v: any) => v.place_id).filter(Boolean)));
      setFoodDna((profile?.food_dna as FoodDNA) ?? null);
    })();
  }, [user]);

  // Cargar script Maps
  useEffect(() => {
    const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
    const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
    if (!key) return;
    if (window.google?.maps) { setMapReady(true); return; }
    if (document.getElementById("gmaps-script")) return;
    window.initMap = () => setMapReady(true);
    const s = document.createElement("script");
    s.id = "gmaps-script"; s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=initMap${channel ? `&channel=${channel}` : ""}`;
    document.head.appendChild(s);
  }, []);

  // Geolocalización
  useEffect(() => {
    if (!("geolocation" in navigator)) { setGeoError("Tu navegador no soporta geolocalización."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => { setGeoError(err.message); toast.error("Activa la ubicación para ver lugares cerca."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  // Fetch nearby cuando hay ubicación + tipo
  const fetchNearby = useCallback(async () => {
    if (!userLoc) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nearby-places", {
        body: { lat: userLoc.lat, lng: userLoc.lng, radius: 2000, type: activeType, maxResults: 20 },
      });
      if (error) throw error;
      const raw = (data?.results ?? []) as NearbyPlace[];
      const enriched: EnrichedPlace[] = raw
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
        .map((p) => {
          const cuisine = detectCuisine(p.types, p.primary_type, p.name);
          const score = scorePlace(p, cuisine, foodDna);
          const for_you = !!(foodDna?.top_cuisines?.some((c) => c.key === cuisine && c.count >= 1));
          return { ...p, cuisine, visited: visited.has(p.placeId), match_score: score, for_you };
        })
        .sort((a, b) => b.match_score - a.match_score);
      setPlaces(enriched);
    } catch (e: any) {
      toast.error(e?.message ?? "No pudimos cargar lugares cercanos");
    } finally {
      setLoading(false);
    }
  }, [userLoc, activeType, foodDna, visited]);

  useEffect(() => { fetchNearby(); }, [fetchNearby]);

  // Refresca el flag visited cuando cambia el set
  useEffect(() => {
    setPlaces((prev) => prev.map((p) => ({ ...p, visited: visited.has(p.placeId) })));
  }, [visited]);

  // Inicializar / actualizar mapa y pins
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const center = userLoc ?? { lat: 19.4326, lng: -99.1332 };
    if (!mapObj.current) {
      mapObj.current = new window.google.maps.Map(mapRef.current, {
        center, zoom: 15, minZoom: 3, maxZoom: 19,
        styles: DARK_STYLE, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy",
      });
    } else if (userLoc) {
      mapObj.current.setCenter(center);
    }

    if (userLoc) {
      if (userMarker.current) userMarker.current.setMap(null);
      userMarker.current = new window.google.maps.Marker({
        position: userLoc, map: mapObj.current, title: "Tu ubicación",
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 8,
          fillColor: "#4A90E2", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
        zIndex: 999,
      });
    }

    markers.current.forEach((m) => m.setMap(null));
    markers.current.clear();

    const bounds = new window.google.maps.LatLngBounds();
    if (userLoc) bounds.extend(userLoc);

    places.forEach((p) => {
      const color = p.visited ? PIN_GOLD : p.for_you ? PIN_FORYOU : PIN_CREAM;
      const marker = new window.google.maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map: mapObj.current, title: p.name ?? "",
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: p.for_you ? 11 : 9,
          fillColor: color, fillOpacity: 1, strokeColor: PIN_GOLD, strokeWeight: 2 },
      });
      marker.addListener("click", () => {
        setShowRoute(false);
        setSelected(p);
        logInsight("viewed", "restaurant", p.name ?? "", { placeId: p.placeId, cuisine: p.cuisine });
      });
      markers.current.set(p.placeId, marker);
      bounds.extend({ lat: p.lat, lng: p.lng });
    });

    if (places.length > 0 && userLoc) {
      mapObj.current.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });
    }
  }, [mapReady, userLoc, places]);

  const markVisited = async (p: EnrichedPlace) => {
    if (!user) { toast.error("Inicia sesión para guardar tus visitas"); return; }
    setMarkingId(p.placeId);
    try {
      const { data, error } = await supabase.functions.invoke("mark-visited", {
        body: { placeId: p.placeId, tripId: activeTrip?.id ?? null },
      });
      if (error) throw error;
      setVisited((s) => new Set(s).add(p.placeId));
      // refresca food_dna localmente para reordenar
      const { data: profile } = await supabase.from("profiles").select("food_dna").eq("id", user.id).maybeSingle();
      setFoodDna((profile?.food_dna as FoodDNA) ?? null);
      toast.success(data?.place?.cuisine
        ? `Visitado · IATOS aprendió que te gusta la comida ${data.place.cuisine}`
        : "Visita registrada");
      setSelected((s) => s && s.placeId === p.placeId ? { ...s, visited: true } : s);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo registrar");
    } finally {
      setMarkingId(null);
    }
  };

  const toggleFav = (p: EnrichedPlace) => {
    const isFav = favorited.has(p.placeId);
    setFavorited((s) => { const n = new Set(s); isFav ? n.delete(p.placeId) : n.add(p.placeId); return n; });
    logInsight(isFav ? "removed" : "saved", "restaurant", p.name ?? "", { placeId: p.placeId });
  };

  const hasKey = !!import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
  const topCuisine = foodDna?.top_cuisines?.[0]?.key;

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-6xl">
        <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl md:text-5xl mb-2">Cercanos</h1>
            <p className="text-muted-foreground">
              {userLoc
                ? <>Lugares reales cerca de <span className="text-primary">tu ubicación</span>.{topCuisine ? ` IATOS resalta los de comida ${topCuisine}.` : ""}</>
                : geoError ? "Activa la ubicación para ver lugares cerca." : "Detectando ubicación…"}
            </p>
          </div>
          {activeTrip && (
            <div className="text-right">
              <p className="text-xs text-primary tracking-[0.2em] uppercase">Viaje activo</p>
              <p className="text-sm">{formatDateOnly(activeTrip.fecha_salida)} → {formatDateOnly(activeTrip.fecha_regreso)}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {TYPE_OPTIONS.map((t) => (
            <button key={t.value}
              onClick={() => setActiveType(t.value)}
              className={`px-3 py-1.5 rounded-full text-xs transition ${
                activeType === t.value ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-elevated"
              }`}>
              {t.label}
            </button>
          ))}
          {loading && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Buscando…</span>}
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

        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#F5F1EA]" /> Por visitar</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary" /> Visitado</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: PIN_FORYOU }} /> Para ti</span>
        </p>
      </div>

      {/* Bottom sheet */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setSelected(null); setShowRoute(false); }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="fixed inset-x-0 bottom-0 z-50 md:inset-x-auto md:right-8 md:bottom-8 md:max-w-md max-h-[85vh] overflow-y-auto"
            >
              <div className="glass-card rounded-t-3xl md:rounded-3xl border border-primary/30 premium-shadow overflow-hidden">
                {selected.photo_ref && (
                  <div className="relative h-44 w-full bg-surface">
                    <img
                      src={placePhotoUrl(selected.photo_ref, 800)}
                      alt={selected.name ?? ""}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    {selected.for_you && (
                      <div className="absolute top-3 left-3 bg-[#E94E77] text-white text-[10px] tracking-widest uppercase px-2 py-1 rounded-full flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Para ti
                      </div>
                    )}
                  </div>
                )}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="min-w-0">
                      <p className="text-xs text-primary tracking-[0.2em] uppercase mb-1">
                        {selected.cuisine ?? selected.primary_type ?? "Lugar"}
                      </p>
                      <h3 className="font-display text-2xl leading-tight">{selected.name}</h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => toggleFav(selected)}
                        className="p-2 rounded-full bg-surface hover:bg-surface-elevated transition" aria-label="Favorito">
                        <Heart className={`w-4 h-4 ${favorited.has(selected.placeId) ? "fill-primary text-primary" : "text-foreground"}`} />
                      </button>
                      <button onClick={() => { setSelected(null); setShowRoute(false); }}
                        className="p-2 rounded-full bg-surface hover:bg-surface-elevated transition">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 flex-wrap">
                    {typeof selected.rating === "number" && (
                      <span className="flex items-center gap-1 text-foreground">
                        <Star className="w-3 h-3 fill-primary text-primary" />
                        {selected.rating.toFixed(1)}
                        <span className="text-muted-foreground">({selected.ratings_count})</span>
                      </span>
                    )}
                    {selected.price_level && <span>{selected.price_level.replace("PRICE_LEVEL_", "").toLowerCase()}</span>}
                    {selected.open_now === true && <span className="text-emerald-400">Abierto ahora</span>}
                    {selected.open_now === false && <span className="text-red-400">Cerrado</span>}
                  </div>

                  {selected.address && <p className="text-sm text-muted-foreground mb-4">{selected.address}</p>}

                  {showRoute && userLoc && (
                    <div className="mb-4">
                      <RoutesPanel
                        origin={{ lat: userLoc.lat, lng: userLoc.lng }}
                        destination={{ placeId: selected.placeId }}
                        destinationLabel={selected.name ?? ""}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => setShowRoute((v) => !v)} className="rounded-full">
                      <Navigation className="w-4 h-4 mr-1" /> {showRoute ? "Ocultar ruta" : "Cómo llegar"}
                    </Button>
                    {selected.visited ? (
                      <div className="flex items-center justify-center rounded-full border border-primary/40 text-primary text-sm">
                        <Check className="w-4 h-4 mr-1" /> Visitado
                      </div>
                    ) : (
                      <Button onClick={() => markVisited(selected)} disabled={markingId === selected.placeId}
                        className="rounded-full bg-gradient-gold text-primary-foreground gold-glow">
                        {markingId === selected.placeId
                          ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Guardando</>
                          : "📍 Marcar como visitado"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default Cercanos;
