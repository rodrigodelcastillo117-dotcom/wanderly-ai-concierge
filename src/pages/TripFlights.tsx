import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plane, Search, ExternalLink, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { googleFlightsLink, skyscannerLink, kayakFlightsLink, ensureAviasalesMarker } from "@/lib/affiliateLinks";
import { trackBookingClick } from "@/lib/trackBooking";
import { LiveSearchUnavailable } from "@/components/LiveSearchUnavailable";

interface FlightResult {
  price_usd: number;
  price_per_person_usd: number;
  airline: string;
  airline_logo: string | null;
  duration: string;
  stops: number;
  departure: { id?: string; time?: string };
  arrival: { id?: string; time?: string };
  buy_url: string;
  airline_buy_url: string;
}

const TripFlights = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [origin, setOrigin] = useState(params.get("origin") ?? "Mexico City");
  const [destination, setDestination] = useState(params.get("destination") ?? "");
  const [depart, setDepart] = useState(params.get("depart") ?? "");
  const [returnDate, setReturnDate] = useState(params.get("return") ?? "");
  const [travelers, setTravelers] = useState(Number(params.get("travelers") ?? 1));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<FlightResult[]>([]);
  const [source, setSource] = useState<string>("");
  const [meta, setMeta] = useState<any>(null);
  const [consultedAt, setConsultedAt] = useState<string | null>(null);
  // Link de búsqueda (sin precio) cuando el proveedor en vivo no respondió.
  const [unavailableUrl, setUnavailableUrl] = useState<string | null>(null);

  const search = async () => {
    if (!destination || !depart) {
      toast.error("Indica destino y fecha de salida");
      return;
    }
    setLoading(true);
    setResults([]);
    setUnavailableUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("flights-search", {
        body: { origin, destination, depart, return_date: returnDate, travelers, type: returnDate ? "round" : "oneway" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error");
      const list = data.results ?? [];
      setResults(list);
      setMeta(data.meta);
      setConsultedAt(data.consulted_at ?? null);
      if (data.disponible === false || list.length === 0) {
        setSource("");
        setUnavailableUrl(data.search_url ?? data.google_flights_url ?? "");
      } else {
        setSource(data.source);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Error buscando vuelos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (params.get("auto") === "1" && destination && depart) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Vuelos reales</h1>
          <p className="text-sm text-muted-foreground mt-1">Tarifas consultadas al momento en Google Flights o, si no responde, en la caché de Aviasales</p>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tripflights-origen" className="text-xs uppercase tracking-wide text-muted-foreground">Origen</label>
              <Input id="tripflights-origen" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Ciudad de México" />
            </div>
            <div>
              <label htmlFor="tripflights-destino" className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
              <Input id="tripflights-destino" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label htmlFor="tripflights-salida" className="text-xs uppercase tracking-wide text-muted-foreground">Salida</label>
              <Input id="tripflights-salida" type="date" value={depart} onChange={(e) => setDepart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="tripflights-regreso-opcional" className="text-xs uppercase tracking-wide text-muted-foreground">Regreso (opcional)</label>
              <Input id="tripflights-regreso-opcional" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="tripflights-viajeros" className="text-xs uppercase tracking-wide text-muted-foreground">Viajeros</label>
              <Input id="tripflights-viajeros" type="number" min={1} max={9} value={travelers} onChange={(e) => setTravelers(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={search} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar vuelos
          </Button>
        </div>
        {source && (
          <div className="flex items-center gap-2 flex-wrap">
            <PriceSourceBadge source={source === "serpapi" ? "google_flights" : source} consultadoAt={consultedAt} />
            {meta && (
              <span className="text-xs text-muted-foreground">{meta.dep_iata} → {meta.arr_iata}</span>
            )}
          </div>
        )}


        {unavailableUrl !== null && results.length === 0 && (
          <LiveSearchUnavailable
            providerLabel="Aviasales"
            onSearch={unavailableUrl ? () => trackBookingClick({
              category: "flight", provider: "Aviasales", title: `${origin} → ${destination}`,
              city: destination, bookingUrl: ensureAviasalesMarker(unavailableUrl), startAt: depart || undefined,
            }) : undefined}
          />
        )}

        <div className="space-y-3">
          {results.map((f, i) => (
            <div key={i} className="glass-card rounded-xl p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 md:w-48">
                {f.airline_logo ? (
                  <img src={f.airline_logo} alt={f.airline} className="w-10 h-10 rounded object-contain bg-white p-1" />
                ) : (
                  <div className="w-10 h-10 rounded bg-primary/10 flex items-center justify-center">
                    <Plane className="w-5 h-5 text-primary" />
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium">{f.airline}</div>
                  <div className="text-[11px] text-muted-foreground">{f.stops === 0 ? "Directo" : `${f.stops} escala${f.stops > 1 ? "s" : ""}`}</div>
                </div>
              </div>
              <div className="flex-1 grid grid-cols-3 gap-2 text-center md:text-left">
                <div>
                  <div className="text-xs text-muted-foreground">Salida</div>
                  <div className="text-sm font-medium">{f.departure.id ?? "—"}</div>
                  {f.departure.time && <div className="text-[11px] text-muted-foreground">{new Date(f.departure.time).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</div>}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Duración</div>
                  <div className="text-sm font-medium">{f.duration}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Llega</div>
                  <div className="text-sm font-medium">{f.arrival.id ?? "—"}</div>
                  {f.arrival.time && <div className="text-[11px] text-muted-foreground">{new Date(f.arrival.time).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</div>}
                </div>
              </div>
              <div className="md:w-48 text-right space-y-1">
                <div className="font-display text-2xl gold-text">${f.price_per_person_usd}</div>
                <div className="text-[11px] text-muted-foreground">USD / persona</div>
                <div className="flex flex-col gap-1 mt-2">
                  <Button size="sm" onClick={() => trackBookingClick({
                    category: "flight", provider: f.airline, title: `${origin} → ${destination}`,
                    subtitle: `$${f.price_per_person_usd} USD / persona`, city: destination,
                    bookingUrl: ensureAviasalesMarker(f.buy_url), startAt: depart || undefined,
                  })} className="w-full">
                    Reservar <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                  <button onClick={() => trackBookingClick({
                    category: "flight", provider: f.airline, title: `${origin} → ${destination}`,
                    subtitle: `$${f.price_per_person_usd} USD / persona`, city: destination,
                    bookingUrl: ensureAviasalesMarker(f.airline_buy_url), startAt: depart || undefined,
                  })} className="text-[11px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline">
                    Comprar en {f.airline}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && meta && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => trackBookingClick({
              category: "flight", provider: "Google Flights", title: `${origin} → ${destination}`,
              city: destination, bookingUrl: googleFlightsLink(origin, destination, depart, returnDate, travelers), startAt: depart || undefined,
            })}>
              Ver todo en Google Flights
            </Button>
            {meta.dep_iata && meta.arr_iata && <>
              <Button variant="outline" onClick={() => trackBookingClick({
                category: "flight", provider: "Skyscanner", title: `${origin} → ${destination}`,
                city: destination, bookingUrl: skyscannerLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), startAt: depart || undefined,
              })}>
                Skyscanner
              </Button>
              <Button variant="outline" onClick={() => trackBookingClick({
                category: "flight", provider: "Kayak", title: `${origin} → ${destination}`,
                city: destination, bookingUrl: kayakFlightsLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), startAt: depart || undefined,
              })}>
                Kayak
              </Button>
            </>}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripFlights;
