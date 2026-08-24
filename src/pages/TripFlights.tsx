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

  const search = async () => {
    if (!destination || !depart) {
      toast.error("Indica destino y fecha de salida");
      return;
    }
    setLoading(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("flights-search", {
        body: { origin, destination, depart, return_date: returnDate, travelers, type: returnDate ? "round" : "oneway" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error");
      setResults(data.results ?? []);
      setSource(data.source);
      setMeta(data.meta);
      if ((data.results ?? []).length === 0) toast.info("Sin resultados — prueba con otras fechas");
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
          <p className="text-sm text-muted-foreground mt-1">Precios en vivo de Google Flights · compra directa con tu aerolínea</p>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Origen</label>
              <Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Ciudad de México" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Salida</label>
              <Input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Regreso (opcional)</label>
              <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Viajeros</label>
              <Input type="number" min={1} max={9} value={travelers} onChange={(e) => setTravelers(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={search} disabled={loading} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar vuelos
          </Button>
        </div>
        {source && (
          <div className="flex items-center gap-2 flex-wrap">
            <PriceSourceBadge source={source === "serpapi" ? "google_flights" : source} />
            {meta && (
              <span className="text-xs text-muted-foreground">{meta.dep_iata} → {meta.arr_iata}</span>
            )}
          </div>
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
                  <Button size="sm" onClick={() => window.open(ensureAviasalesMarker(f.buy_url), "_blank")} className="w-full">
                    Reservar <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                  <button onClick={() => window.open(ensureAviasalesMarker(f.airline_buy_url), "_blank")} className="text-[11px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline">
                    Comprar en {f.airline}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && meta && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => window.open(googleFlightsLink(origin, destination, depart, returnDate, travelers), "_blank")}>
              Ver todo en Google Flights
            </Button>
            {meta.dep_iata && meta.arr_iata && <>
              <Button variant="outline" onClick={() => window.open(skyscannerLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), "_blank")}>
                Skyscanner
              </Button>
              <Button variant="outline" onClick={() => window.open(kayakFlightsLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), "_blank")}>
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
