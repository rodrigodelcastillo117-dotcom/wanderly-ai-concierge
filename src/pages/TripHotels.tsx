import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { SmartImage } from "@/components/media/SmartImage";
import { hotelQuery } from "@/lib/categoryImagery";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Hotel, Search, ExternalLink, Loader2, Star } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastFunctionError } from "@/lib/functionErrors";
import { bookingLink, airbnbLink } from "@/lib/affiliateLinks";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";
import { LiveSearchUnavailable } from "@/components/LiveSearchUnavailable";

interface HotelResult {
  name: string;
  rating: number | null;
  reviews?: number | null;
  hotel_class: number | null;
  nightly_usd: number;
  total_usd?: number;
  thumbnail: string | null;
  amenities: string[];
  booking_url: string;
}

const TripHotels = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");
  const [checkin, setCheckin] = useState(params.get("checkin") ?? "");
  const [checkout, setCheckout] = useState(params.get("checkout") ?? "");
  const [adults, setAdults] = useState(Number(params.get("adults") ?? 2));
  const [hotelClass, setHotelClass] = useState("4,5");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<HotelResult[]>([]);
  // Ciudad de los resultados mostrados (para buscar la foto del hotel sin depender de lo que se teclea).
  const [searchedCity, setSearchedCity] = useState("");
  const [source, setSource] = useState("");
  const [consultedAt, setConsultedAt] = useState<string | null>(null);
  // El servidor marca OBSOLETO un precio guardado (uso justo); nunca se presenta como "en vivo".
  const [estadoDato, setEstadoDato] = useState<string | null>(null);
  // Link de búsqueda (sin precio) cuando Google Hotels no respondió.
  const [unavailableUrl, setUnavailableUrl] = useState<string | null>(null);

  const search = async () => {
    if (!city || !checkin || !checkout) {
      toast.error("Indica ciudad y fechas");
      return;
    }
    setLoading(true);
    setResults([]);
    setUnavailableUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("hotels-search", {
        body: { city, checkin, checkout, adults, hotel_class: hotelClass },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error");
      const list = data.results ?? [];
      setResults(list);
      setSearchedCity(city.trim());
      setConsultedAt(data.consulted_at ?? null);
      setEstadoDato(data.estado_dato ?? null);
      // Límite de búsquedas en vivo del plan: se muestra lo que sí hubo y el aviso.
      if (data.aviso_limite) toast.info(data.aviso_limite);
      if (data.disponible === false || list.length === 0) {
        setSource("");
        setUnavailableUrl(data.booking_url ?? bookingLink(city, checkin, checkout, adults));
      } else {
        setSource(data.source);
      }
    } catch (e: any) {
      // FREE_LIMIT_REACHED (búsquedas en vivo del día) abre el diálogo de límite.
      await toastFunctionError(e, "No pudimos buscar hoteles. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params.get("auto") === "1" && city && checkin && checkout) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Hoteles reales</h1>
          <p className="text-sm text-muted-foreground mt-1">Tarifas consultadas al momento en Google Hotels · reserva con Booking.com</p>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="triphotels-ciudad" className="text-xs uppercase tracking-wide text-muted-foreground">Ciudad</label>
              <Input id="triphotels-ciudad" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label htmlFor="triphotels-categoria" className="text-xs uppercase tracking-wide text-muted-foreground">Categoría</label>
              <select id="triphotels-categoria" value={hotelClass} onChange={(e) => setHotelClass(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Todos</option>
                <option value="3">3 estrellas</option>
                <option value="4">4 estrellas</option>
                <option value="5">5 estrellas</option>
                <option value="4,5">4-5 estrellas</option>
              </select>
            </div>
            <div>
              <label htmlFor="triphotels-check-in" className="text-xs uppercase tracking-wide text-muted-foreground">Check-in</label>
              <Input id="triphotels-check-in" type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} />
            </div>
            <div>
              <label htmlFor="triphotels-check-out" className="text-xs uppercase tracking-wide text-muted-foreground">Check-out</label>
              <Input id="triphotels-check-out" type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} />
            </div>
            <div>
              <label htmlFor="triphotels-adultos" className="text-xs uppercase tracking-wide text-muted-foreground">Adultos</label>
              <Input id="triphotels-adultos" type="number" min={1} max={8} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={search} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar hoteles
          </Button>
        </div>

        {source && <PriceSourceBadge source={source === "serpapi" ? "google_hotels" : source} estado={estadoDato} consultadoAt={consultedAt} />}

        {unavailableUrl !== null && results.length === 0 && (
          <LiveSearchUnavailable
            providerLabel="Booking.com"
            onSearch={() => tripTool.track({
              category: "hotel", provider: "Booking.com", title: `Hoteles en ${city}`,
              city, bookingUrl: unavailableUrl, startAt: checkin || undefined,
            })}
          />
        )}

        <div className="grid md:grid-cols-2 gap-3">
          {results.map((h, i) => (
            <div key={i} className="glass-card rounded-xl overflow-hidden">
              {/* Miniatura de Google Hotels; si no viene, la foto real del hotel por su nombre o una
                  ilustrativa marcada como tal (nunca un recuadro vacío). */}
              <SmartImage alt={h.name} imageUrl={h.thumbnail ?? null} lookup={{ name: h.name, city: searchedCity }}
                stockQuery={hotelQuery(null, i)} icon={Hotel} className="w-full h-40" />
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-sm leading-tight">{h.name}</h3>
                  {h.hotel_class && (
                    <span className="text-[10px] text-primary shrink-0">{"★".repeat(h.hotel_class)}</span>
                  )}
                </div>
                {h.rating && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Star className="w-3 h-3 fill-primary text-primary" /> {h.rating}
                    {h.reviews ? ` · ${h.reviews} reseñas` : ""}
                  </div>
                )}
                {h.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {h.amenities.slice(0, 3).map((a) => (
                      <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5">{a}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-end justify-between pt-2">
                  <div>
                    <div className="font-display text-xl gold-text">${h.nightly_usd}</div>
                    <div className="text-[10px] text-muted-foreground">USD / noche</div>
                  </div>
                  <Button size="sm" onClick={() => tripTool.track({
                    category: "hotel", provider: "Booking.com", title: h.name,
                    subtitle: `$${h.nightly_usd} USD / noche`, city, bookingUrl: h.booking_url, startAt: checkin || undefined,
                  })}>
                    Reservar <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => tripTool.track({
              category: "hotel", provider: "Booking.com", title: `Hoteles en ${city}`,
              city, bookingUrl: bookingLink(city, checkin, checkout, adults), startAt: checkin || undefined,
            })}>
              Ver todo en Booking.com
            </Button>
            <Button variant="outline" onClick={() => tripTool.track({
              category: "hotel", provider: "Airbnb", title: `Hoteles en ${city}`,
              city, bookingUrl: airbnbLink(city, checkin, checkout, adults), startAt: checkin || undefined,
            })}>
              Buscar en Airbnb
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripHotels;
