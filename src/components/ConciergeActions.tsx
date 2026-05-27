import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Phone, Star, ExternalLink, Loader2, Car, Utensils, Siren, AlertCircle, Navigation, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type ActionKind = "transport" | "dining" | "emergency" | null;

type Place = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  ratings_count: number;
  price_level: string | null;
  phone: string | null;
  maps_url: string | null;
  website: string | null;
  open_now: boolean | null;
  type: string | null;
  photo_url?: string | null;
  source?: string | null;
};

// Numeros de emergencia por país (ISO o nombre común). Fallback: 112.
const EMERGENCY_NUMBERS: Record<string, { police: string; medical: string; fire: string; general?: string }> = {
  MX: { police: "911", medical: "911", fire: "911" },
  US: { police: "911", medical: "911", fire: "911" },
  CA: { police: "911", medical: "911", fire: "911" },
  GB: { police: "999", medical: "999", fire: "999", general: "112" },
  ES: { police: "091", medical: "061", fire: "080", general: "112" },
  FR: { police: "17", medical: "15", fire: "18", general: "112" },
  IT: { police: "113", medical: "118", fire: "115", general: "112" },
  DE: { police: "110", medical: "112", fire: "112" },
  JP: { police: "110", medical: "119", fire: "119" },
  BR: { police: "190", medical: "192", fire: "193" },
  AR: { police: "911", medical: "107", fire: "100" },
  CO: { police: "123", medical: "125", fire: "119" },
  CL: { police: "133", medical: "131", fire: "132" },
  PE: { police: "105", medical: "117", fire: "116" },
  AU: { police: "000", medical: "000", fire: "000" },
  NZ: { police: "111", medical: "111", fire: "111" },
  IN: { police: "100", medical: "108", fire: "101", general: "112" },
  CN: { police: "110", medical: "120", fire: "119" },
  TH: { police: "191", medical: "1669", fire: "199" },
  AE: { police: "999", medical: "998", fire: "997" },
  ZA: { police: "10111", medical: "10177", fire: "10111" },
};

export const ConciergeActions = ({
  open,
  kind,
  onClose,
}: {
  open: boolean;
  kind: ActionKind;
  onClose: () => void;
}) => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [emergencyTab, setEmergencyTab] = useState<"hospital" | "police" | "pharmacy" | "embassy">("hospital");

  useEffect(() => {
    if (!open) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ lat: latitude, lng: longitude });
        try {
          const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`);
          const j = await r.json();
          setCountryCode(j?.countryCode ?? null);
        } catch {/* */}
      },
      () => toast.error("Necesito permiso de ubicación para acciones en tiempo real"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [open]);

  // Cargar lugares automáticamente para cena y emergencia
  useEffect(() => {
    if (!open || !coords) return;
    if (kind === "dining") loadPlaces("restaurant");
    else if (kind === "emergency") loadPlaces(mapEmergency(emergencyTab));
    else setPlaces([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coords, kind, emergencyTab]);

  const mapEmergency = (t: typeof emergencyTab) =>
    t === "hospital" ? "hospital" : t === "police" ? "police" : t === "pharmacy" ? "pharmacy" : "embassy";

  const loadPlaces = async (placeKind: string) => {
    if (!coords) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("places-nearby", {
        body: { lat: coords.lat, lng: coords.lng, kind: placeKind, radius: placeKind === "embassy" ? 25000 : 2000 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPlaces(data?.places ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cargar", { description: "Estoy intentando con fuentes alternativas reales." });
      setPlaces([]);
    } finally {
      setLoading(false);
    }
  };

  // Geocode destination using Google's free geocoding via Maps JS API key (browser-safe)
  const geocodeDest = async () => {
    if (!destination.trim()) return;
    const k = (import.meta.env as any).VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
    if (!k) { toast.error("Falta key de mapas"); return; }
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(destination)}&key=${k}&language=es`);
      const j = await r.json();
      const loc = j?.results?.[0]?.geometry?.location;
      const label = j?.results?.[0]?.formatted_address ?? destination;
      if (loc) setDestCoords({ lat: loc.lat, lng: loc.lng, label });
      else toast.error("No encontré ese destino");
    } catch { toast.error("Error de geocoding"); }
  };

  const uberUrl = () => {
    if (!coords || !destCoords) return "#";
    return `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${coords.lat}&pickup[longitude]=${coords.lng}&dropoff[latitude]=${destCoords.lat}&dropoff[longitude]=${destCoords.lng}&dropoff[nickname]=${encodeURIComponent(destCoords.label)}`;
  };
  const lyftUrl = () => coords && destCoords
    ? `https://lyft.com/ride?id=lyft&pickup[latitude]=${coords.lat}&pickup[longitude]=${coords.lng}&destination[latitude]=${destCoords.lat}&destination[longitude]=${destCoords.lng}`
    : "#";
  const didiUrl = () => coords && destCoords
    ? `https://global.didiglobal.com/?from_lat=${coords.lat}&from_lng=${coords.lng}&to_lat=${destCoords.lat}&to_lng=${destCoords.lng}`
    : "#";
  const boltUrl = () => coords && destCoords
    ? `https://bolt.eu/order-taxi/?pickup_lat=${coords.lat}&pickup_lng=${coords.lng}&destination_lat=${destCoords.lat}&destination_lng=${destCoords.lng}`
    : "#";
  const mapsDir = () => coords && destCoords
    ? `https://www.google.com/maps/dir/?api=1&origin=${coords.lat},${coords.lng}&destination=${destCoords.lat},${destCoords.lng}&travelmode=driving`
    : "#";

  const openTableSearch = (placeName: string, address?: string) => {
    // Extrae ciudad/región del address (formato Google: "Calle X, Colonia, CP Ciudad, Estado, País")
    const parts = (address || "").split(",").map(s => s.trim()).filter(Boolean);
    const city = parts.length >= 2 ? parts.slice(-3, -1).join(" ") : (parts[parts.length - 1] || "");
    const q = encodeURIComponent(`${placeName} ${city} reservación`.trim());
    // Google con site:opentable.com lleva directo a la ficha real del restaurante si existe en OpenTable;
    // si no, muestra alternativas reales en lugar de "0 resultados".
    return `https://www.google.com/search?q=${q}+site%3Aopentable.com+OR+site%3Aresy.com+OR+site%3Atheforksearch.com`;
  };

  const emergency = countryCode ? EMERGENCY_NUMBERS[countryCode] : null;

  return (
    <AnimatePresence>
      {open && kind && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-t-3xl sm:rounded-3xl border border-primary/30 bg-card p-5 sm:p-7 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                {kind === "transport" && <Car className="w-6 h-6 text-primary" />}
                {kind === "dining" && <Utensils className="w-6 h-6 text-primary" />}
                {kind === "emergency" && <Siren className="w-6 h-6 text-primary" />}
                <div>
                  <p className="text-[10px] tracking-[0.3em] text-primary uppercase">Acción en vivo</p>
                  <h3 className="font-display text-xl sm:text-2xl">
                    {kind === "transport" && "Pedir transporte"}
                    {kind === "dining" && "Cena cerca de ti"}
                    {kind === "emergency" && "Emergencia local"}
                  </h3>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
            </div>

            {!coords && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Obteniendo tu ubicación…
              </div>
            )}

            {/* TRANSPORT */}
            {kind === "transport" && coords && (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-primary" />
                  Te recojo en {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="¿A dónde vas? (dirección, restaurante, hotel…)"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && geocodeDest()}
                  />
                  <Button onClick={geocodeDest} className="shrink-0">Buscar</Button>
                </div>
                {destCoords && (
                  <>
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
                      <span className="text-primary font-semibold">Destino:</span> {destCoords.label}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <a href={uberUrl()} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-3 text-center text-sm font-medium">Uber</a>
                      <a href={didiUrl()} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-3 text-center text-sm font-medium">DiDi</a>
                      <a href={lyftUrl()} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-3 text-center text-sm font-medium">Lyft</a>
                      <a href={boltUrl()} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-3 text-center text-sm font-medium">Bolt</a>
                    </div>
                    <a href={mapsDir()} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 p-3 text-sm">
                      <Navigation className="w-4 h-4 text-primary" /> Cómo llegar en Google Maps
                    </a>
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      Abro la app de cada servicio con tu origen y destino pre-cargados. La tarifa y disponibilidad la calcula cada app.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* DINING / EMERGENCY shared list */}
            {(kind === "dining" || kind === "emergency") && coords && (
              <div className="space-y-3">
                {kind === "emergency" && (
                  <>
                    {emergency && (
                      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-destructive font-bold mb-2">Llamada directa · {countryCode}</div>
                        <div className="grid grid-cols-3 gap-2">
                          <a href={`tel:${emergency.medical}`} className="rounded-lg bg-destructive text-destructive-foreground py-2 text-center text-sm font-bold">🚑 {emergency.medical}</a>
                          <a href={`tel:${emergency.police}`} className="rounded-lg bg-destructive text-destructive-foreground py-2 text-center text-sm font-bold">🚓 {emergency.police}</a>
                          <a href={`tel:${emergency.fire}`} className="rounded-lg bg-destructive text-destructive-foreground py-2 text-center text-sm font-bold">🚒 {emergency.fire}</a>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-1.5 flex-wrap">
                      {(["hospital", "police", "pharmacy", "embassy"] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setEmergencyTab(t)}
                          className={`px-3 py-1.5 rounded-full text-xs border transition ${
                            emergencyTab === t
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-white/10 text-muted-foreground hover:border-primary/40"
                          }`}
                        >
                          {t === "hospital" && "Hospital"}
                          {t === "police" && "Policía"}
                          {t === "pharmacy" && "Farmacia"}
                          {t === "embassy" && "Embajada"}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {loading && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Buscando lugares reales cerca de ti…
                  </div>
                )}

                {!loading && places.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No encontré lugares en esta zona.</p>
                )}

                <div className="space-y-2">
                  {places.map(p => (
                    <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
                      {p.photo_url && (
                        <img src={p.photo_url} alt={p.name} className="h-28 w-full object-cover" loading="lazy" />
                      )}
                      <div className="p-3">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{p.address}</div>
                        </div>
                        {p.rating && (
                          <div className="flex items-center gap-1 text-xs shrink-0">
                            <Star className="w-3 h-3 fill-primary text-primary" />
                            <span className="font-semibold">{p.rating.toFixed(1)}</span>
                            <span className="text-muted-foreground">({p.ratings_count})</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-2">
                        {p.open_now !== null && (
                          <span className={`flex items-center gap-1 ${p.open_now ? "text-emerald-400" : "text-destructive"}`}>
                            <Clock className="w-3 h-3" /> {p.open_now ? "Abierto" : "Cerrado"}
                          </span>
                        )}
                        {p.type && <span>· {p.type}</span>}
                        {p.source && <span>· {p.source}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.phone && (
                          <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/15 text-primary text-[11px] hover:bg-primary/25">
                            <Phone className="w-3 h-3" /> Llamar
                          </a>
                        )}
                        {p.maps_url && (
                          <a href={p.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.04] text-foreground text-[11px] hover:bg-white/[0.08]">
                            <Navigation className="w-3 h-3" /> Cómo llegar
                          </a>
                        )}
                        {kind === "dining" && (
                          <a href={openTableSearch(p.name)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.04] text-foreground text-[11px] hover:bg-white/[0.08]">
                            <ExternalLink className="w-3 h-3" /> OpenTable
                          </a>
                        )}
                        {p.website && (
                          <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.04] text-foreground text-[11px] hover:bg-white/[0.08]">
                            <ExternalLink className="w-3 h-3" /> Sitio
                          </a>
                        )}
                      </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
