import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plane, Search, ExternalLink, Loader2 } from "lucide-react";
import { AirlineLogo } from "@/components/media/AirlineLogo";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastFunctionError } from "@/lib/functionErrors";
import { googleFlightsLink, skyscannerLink, kayakFlightsLink, ensureAviasalesMarker } from "@/lib/affiliateLinks";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";
import { LiveSearchUnavailable } from "@/components/LiveSearchUnavailable";
import { BookingActions } from "@/components/booking/BookingActions";
import { offerFromFlightResult } from "@/lib/booking";

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
  booking_token?: string | null;
}

const TripFlights = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Origen: el de la URL, si no la ciudad de origen del perfil (antes siempre "Mexico City",
  // en inglés y aunque la persona viva en otra ciudad). Se respeta lo que ya haya escrito.
  const { user } = useAuth();
  const [origin, setOrigin] = useState(params.get("origin") ?? "");
  const originTouched = useRef(Boolean(params.get("origin")));
  const [destination, setDestination] = useState(params.get("destination") ?? "");
  const [depart, setDepart] = useState(params.get("depart") ?? "");
  const [returnDate, setReturnDate] = useState(params.get("return") ?? "");
  const [travelers, setTravelers] = useState(Number(params.get("travelers") ?? 1));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<FlightResult[]>([]);
  const [source, setSource] = useState<string>("");
  const [meta, setMeta] = useState<any>(null);
  const [consultedAt, setConsultedAt] = useState<string | null>(null);
  // Búsqueda exacta de Google Flights que devolvió SerpApi (ruta, fechas y pasajeros).
  const [gfUrl, setGfUrl] = useState<string | null>(null);
  // El servidor marca OBSOLETO un precio guardado (uso justo); nunca se presenta como "en vivo".
  const [estadoDato, setEstadoDato] = useState<string | null>(null);
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
      setGfUrl(data.google_flights_url ?? null);
      setEstadoDato(data.estado_dato ?? null);
      // Límite de búsquedas en vivo del plan: se muestra lo que sí hubo y el aviso.
      if (data.aviso_limite) toast.info(data.aviso_limite);
      if (data.disponible === false || list.length === 0) {
        setSource("");
        setUnavailableUrl(data.search_url ?? data.google_flights_url ?? "");
      } else {
        setSource(data.source);
      }
    } catch (e: any) {
      // FREE_LIMIT_REACHED (búsquedas en vivo del día) abre el diálogo de límite.
      await toastFunctionError(e, "No pudimos buscar vuelos. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || originTouched.current) return;
    supabase.from("profiles").select("ciudad_origen").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (originTouched.current) return;
        setOrigin((data as { ciudad_origen?: string | null } | null)?.ciudad_origen || "CDMX");
      });
  }, [user]);

  // Sin datos en la URL, el destino, las fechas y los viajeros del viaje en contexto (?trip=).
  useEffect(() => {
    const t = tripTool.trip;
    if (!t) return;
    if (!destination && t.destino) setDestination(t.destino);
    if (!depart && t.fecha_salida) setDepart(t.fecha_salida);
    if (!returnDate && t.fecha_regreso) setReturnDate(t.fecha_regreso);
    if (!params.get("travelers") && t.num_viajeros) setTravelers(t.num_viajeros);
    if (!originTouched.current && t.ciudad_origen) { originTouched.current = true; setOrigin(t.ciudad_origen); }
  }, [tripTool.trip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (params.get("auto") === "1" && destination && depart) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Vuelos reales</h1>
          <p className="text-sm text-muted-foreground mt-1">Tarifas consultadas al momento en Google Flights o, si no responde, en la caché de Aviasales</p>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="tripflights-origen" className="text-xs uppercase tracking-wide text-muted-foreground">Origen</label>
              <Input id="tripflights-origen" value={origin} onChange={(e) => { originTouched.current = true; setOrigin(e.target.value); }} placeholder="Ciudad de México" />
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
            <PriceSourceBadge source={source === "serpapi" ? "google_flights" : source} estado={estadoDato} consultadoAt={consultedAt} />
            {meta && (
              <span className="text-xs text-muted-foreground">{meta.dep_iata} → {meta.arr_iata}</span>
            )}
          </div>
        )}


        {unavailableUrl !== null && results.length === 0 && (
          <LiveSearchUnavailable
            providerLabel="Aviasales"
            onSearch={unavailableUrl ? () => tripTool.track({
              category: "flight", provider: "Aviasales", title: `${origin} → ${destination}`,
              city: destination, bookingUrl: ensureAviasalesMarker(unavailableUrl), startAt: depart || undefined,
            }) : undefined}
          />
        )}

        <div className="space-y-3">
          {results.map((f, i) => (
            <div key={i} className="glass-card rounded-xl p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 md:w-48">
                {/* Logo real: el de Google Flights o, si no viene, el del CDN de Travelpayouts. */}
                <AirlineLogo airline={f.airline} logoUrl={f.airline_logo} size={40} shape="square" />
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
                {/* Booking Bridge: "Buscar este vuelo" (búsqueda) ≠ "Comprar esta oferta" (solo si es exacta). */}
                <BookingActions className="mt-2" tripId={tripTool.tripId} max={2}
                  offer={offerFromFlightResult(f, { dep_iata: meta?.dep_iata, arr_iata: meta?.arr_iata, depart, return_date: returnDate || null, travelers, consulted_at: consultedAt,
                      source, google_flights_url: gfUrl })}
                  source={{ type: "flight_result", result: f, meta: { dep_iata: meta?.dep_iata, arr_iata: meta?.arr_iata, depart, return_date: returnDate || null, travelers, consulted_at: consultedAt,
                      source, google_flights_url: gfUrl }, trip_id: tripTool.tripId }} />
              </div>
            </div>
          ))}
        </div>

        {results.length > 0 && meta?.dep_iata && meta?.arr_iata && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Cada botón dice qué llega precargado al sitio (comprobado abriendo cada enlace). */}
            <div>
              <Button variant="outline" className="w-full" onClick={() => tripTool.track({
                category: "flight", provider: "Google Flights", title: `${origin} → ${destination}`,
                city: destination, bookingUrl: googleFlightsLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), startAt: depart || undefined,
              })}>
                Ver todo en Google Flights
              </Button>
              <PrefillNote provider="google_flights" className="mt-1" />
            </div>
            <div>
              <Button variant="outline" className="w-full" onClick={() => tripTool.track({
                category: "flight", provider: "Skyscanner", title: `${origin} → ${destination}`,
                city: destination, bookingUrl: skyscannerLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), startAt: depart || undefined,
              })}>
                Skyscanner
              </Button>
              <PrefillNote provider="skyscanner" className="mt-1" />
            </div>
            <div>
              <Button variant="outline" className="w-full" onClick={() => tripTool.track({
                category: "flight", provider: "Kayak", title: `${origin} → ${destination}`,
                city: destination, bookingUrl: kayakFlightsLink(meta.dep_iata, meta.arr_iata, depart, returnDate, travelers), startAt: depart || undefined,
              })}>
                Kayak
              </Button>
              <PrefillNote provider="kayak" className="mt-1" />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripFlights;
