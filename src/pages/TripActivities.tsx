import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Sparkles, ExternalLink, Search, Star, Loader2, MapPin, Phone, UtensilsCrossed, BedDouble, Landmark } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getYourGuideLink, viatorLink, tripadvisorLink, openTableLink } from "@/lib/affiliateLinks";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";
import { SmartImage } from "@/components/media/SmartImage";
import { activityQuery, cuisineQuery, hotelQuery } from "@/lib/categoryImagery";
import { ViatorToursButton } from "@/components/booking/ViatorTours";
import { TripadvisorSourceNote } from "@/components/tripadvisor/TripadvisorRating";
import { TripadvisorPlaceCard, type TAResult } from "@/components/tripadvisor/TripadvisorPlaceCard";

const TripActivities = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");
  // Sin ciudad en la URL, la del viaje en contexto.
  useEffect(() => { if (!city && tripTool.trip?.destino) setCity(tripTool.trip.destino); }, [tripTool.trip?.destino]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cat, setCat] = useState<"attractions" | "restaurants" | "hotels">("attractions");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TAResult[]>([]);
  // Ciudad y categoría de la búsqueda mostrada (escribir otra ciudad no vuelve a pedir fotos).
  const [searched, setSearched] = useState<{ city: string; cat: typeof cat }>({ city: "", cat: "attractions" });
  // "google_maps" = datos de Google (Places API o, como último recurso, Google Maps vía SerpApi).
  const [source, setSource] = useState<"tripadvisor" | "google_maps">("tripadvisor");

  // Con un viaje en contexto (?trip=), GetYourGuide se abre filtrado a las fechas del viaje.
  const tripDates = tripTool.trip?.fecha_salida && tripTool.trip?.fecha_regreso ? { from: tripTool.trip.fecha_salida, to: tripTool.trip.fecha_regreso } : undefined;
  const sources: { name: string; desc: string; link: () => string; category: "activity" | "restaurant"; prefill: string }[] = [
    { name: "GetYourGuide", desc: "Tours, skip-the-line, experiencias guiadas. Cancelación 24h.", link: () => getYourGuideLink(city, undefined, tripDates), category: "activity", prefill: "getyourguide" },
    { name: "Viator", desc: "Marketplace de Tripadvisor: actividades y tours.", link: () => viatorLink(city), category: "activity", prefill: "viator" },
    { name: "Tripadvisor (sitio web)", desc: "Catálogo completo con todas las opiniones.", link: () => tripadvisorLink(city), category: "activity", prefill: "tripadvisor" },
    { name: "OpenTable", desc: "Reservas en restaurantes con disponibilidad real.", link: () => openTableLink(city), category: "restaurant", prefill: "opentable" },
  ];

  async function buscar() {
    if (!city.trim()) return toast.error("Escribe un destino");
    setLoading(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("tripadvisor-search", {
        // uso "pantalla": solo una búsqueda que la persona pide consulta Tripadvisor (cobra por lugar).
        body: { query: city, category: cat, language: "es_MX", uso: "pantalla" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResults(data?.results ?? []);
      setSearched({ city: city.trim(), cat });
      setSource(data?.source === "google_maps" || data?.source === "google_places" ? "google_maps" : "tripadvisor");
      if (!data?.results?.length) toast.message("Sin resultados para ese destino");
    } catch (e: any) {
      toast.error(e?.message ?? "No pudimos buscar en este momento. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div className="flex items-start gap-3">
          <Sparkles className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Tours, restaurantes y atracciones</h1>
            <p className="text-sm text-muted-foreground mt-1">Lugares reales con reseñas verificadas + marketplaces para reservar</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <label htmlFor="tripactivities-destino" className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
          <Input id="tripactivities-destino" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Roma, Tokio, Cancún…" />
          <Tabs value={cat} onValueChange={(v) => setCat(v as any)}>
            {/* A 320 px "Restaurantes" no cabía en su tercio y se encimaba con "Atracciones". */}
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="attractions" className="px-1 text-xs sm:px-3 sm:text-sm">Atracciones</TabsTrigger>
              <TabsTrigger value="restaurants" className="px-1 text-xs sm:px-3 sm:text-sm">Restaurantes</TabsTrigger>
              <TabsTrigger value="hotels" className="px-1 text-xs sm:px-3 sm:text-sm">Hoteles</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={buscar} disabled={loading || !city} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar lugares
          </Button>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display text-xl">Top resultados</h2>
            {source === "tripadvisor" && <TripadvisorSourceNote />}
            {results.map((r, idx) => source === "tripadvisor" ? (
              <TripadvisorPlaceCard key={r.id} r={r} cat={searched.cat} />
            ) : (
              <div key={r.id} className="glass-card rounded-2xl overflow-hidden border border-white/10">
                {/* Foto real (la del resultado o la de Google Places por su photo_ref, pedida solo al
                    verse); si el lugar no tiene, una ilustrativa de la categoría, marcada como tal. */}
                <SmartImage
                  alt={r.name}
                  imageUrl={r.photos[0] ?? null}
                  photoRef={r.photo_ref ?? null}
                  lookup={{ name: r.name, city: searched.city }}
                  stockQuery={searched.cat === "restaurants" ? cuisineQuery(null, r.name, idx) : searched.cat === "hotels" ? hotelQuery(null, idx) : activityQuery(r.name, searched.city)}
                  icon={searched.cat === "restaurants" ? UtensilsCrossed : searched.cat === "hotels" ? BedDouble : Landmark}
                  className="h-48 w-full"
                />
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg">{r.name}</h3>
                    {r.rating && (
                      <span className="flex items-center gap-1 text-sm shrink-0">
                        <Star className="w-3 h-3 fill-primary text-primary" />
                        {r.rating} <span className="text-muted-foreground">({r.num_reviews})</span>
                      </span>
                    )}
                  </div>
                  {r.ranking && <p className="text-xs text-primary">{r.ranking}</p>}
                  {r.address && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{r.address}</p>}
                  {r.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone}</p>}
                  {r.description && <p className="text-sm text-muted-foreground line-clamp-2">{r.description}</p>}
                  <div className="flex gap-2 pt-2">
                    {r.web_url && (
                      <Button size="sm" onClick={() => window.open(r.web_url!, "_blank")} className="flex-1">
                        Ver en Google Maps <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    )}
                    {r.website && (
                      <Button size="sm" variant="outline" onClick={() => window.open(r.website!, "_blank")}>
                        Web oficial
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tours reales de Viator (Partner API de afiliado): solo tras el botón; "Ver en Viator" no es una reserva. */}
        {city.trim() && (
          <ViatorToursButton key={city.trim().toLowerCase()} city={city.trim()} tripId={tripTool.trip?.id}
            dateFrom={tripTool.trip?.fecha_salida ?? null} dateTo={tripTool.trip?.fecha_regreso ?? null} />
        )}

        <div>
          <h2 className="font-display text-xl mb-3">Otros marketplaces</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {sources.map((s) => (
              <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
                <h3 className="font-display text-lg mb-2">{s.name}</h3>
                <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
                <Button disabled={!city} onClick={() => tripTool.track({
                  category: s.category, provider: s.name, title: `${s.name} — ${city}`,
                  city, bookingUrl: s.link(),
                })} variant="outline" className="w-full">
                  <Search className="w-3 h-3 mr-1" /> Explorar {city || "destino"} <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
                <PrefillNote provider={s.prefill} className="mt-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripActivities;
