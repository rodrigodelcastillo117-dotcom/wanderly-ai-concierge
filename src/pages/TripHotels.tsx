import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Hotel, Search, ExternalLink, Loader2, Star } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { bookingLink, airbnbLink } from "@/lib/affiliateLinks";

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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");
  const [checkin, setCheckin] = useState(params.get("checkin") ?? "");
  const [checkout, setCheckout] = useState(params.get("checkout") ?? "");
  const [adults, setAdults] = useState(Number(params.get("adults") ?? 2));
  const [hotelClass, setHotelClass] = useState("4,5");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<HotelResult[]>([]);
  const [source, setSource] = useState("");

  const search = async () => {
    if (!city || !checkin || !checkout) {
      toast.error("Indica ciudad y fechas");
      return;
    }
    setLoading(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("hotels-search", {
        body: { city, checkin, checkout, adults, hotel_class: hotelClass },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error");
      setResults(data.results ?? []);
      setSource(data.source);
      if ((data.results ?? []).length === 0) toast.info("Sin resultados");
    } catch (e: any) {
      toast.error(e.message ?? "Error buscando hoteles");
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
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Hoteles reales</h1>
          <p className="text-sm text-muted-foreground mt-1">Precios en vivo · reserva directa con Booking.com</p>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Ciudad</label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Categoría</label>
              <select value={hotelClass} onChange={(e) => setHotelClass(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Todos</option>
                <option value="3">3 estrellas</option>
                <option value="4">4 estrellas</option>
                <option value="5">5 estrellas</option>
                <option value="4,5">4-5 estrellas</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Check-in</label>
              <Input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Check-out</label>
              <Input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Adultos</label>
              <Input type="number" min={1} max={8} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={search} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar hoteles
          </Button>
        </div>

        {source && <PriceSourceBadge source={source === "serpapi" ? "google_hotels" : source} />}

        <div className="grid md:grid-cols-2 gap-3">
          {results.map((h, i) => (
            <div key={i} className="glass-card rounded-xl overflow-hidden">
              {h.thumbnail ? (
                <img src={h.thumbnail} alt={h.name} className="w-full h-40 object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-40 bg-primary/5 flex items-center justify-center">
                  <Hotel className="w-10 h-10 text-primary/40" />
                </div>
              )}
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
                  <Button size="sm" onClick={() => window.open(h.booking_url, "_blank")}>
                    Reservar <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => window.open(bookingLink(city, checkin, checkout, adults), "_blank")}>
              Ver todo en Booking.com
            </Button>
            <Button variant="outline" onClick={() => window.open(airbnbLink(city, checkin, checkout, adults), "_blank")}>
              Buscar en Airbnb
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripHotels;
