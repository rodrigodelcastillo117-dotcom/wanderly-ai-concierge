import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Car, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { discoverCarsLink, rentalcarsLink, kayakCarsLink } from "@/lib/affiliateLinks";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";
// roadtrip: devolución en otra ciudad (one-way) con búsqueda de Kayak que lleva ambas ciudades.
import { isOneWay, kayakCarsUrl } from "@/lib/roadtrip";

const TripCars = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");
  const [pickup, setPickup] = useState(params.get("pickup") ?? "");
  const [ret, setRet] = useState(params.get("return") ?? "");
  const [dropoff, setDropoff] = useState(params.get("dropoff") ?? "");
  // Sin datos en la URL, la ciudad y las fechas del viaje en contexto (?trip=).
  useEffect(() => {
    const t = tripTool.trip;
    if (!t) return;
    if (!city && t.destino) setCity(t.destino);
    if (!pickup && t.fecha_salida) setPickup(t.fecha_salida);
    if (!ret && t.fecha_regreso) setRet(t.fecha_regreso);
  }, [tripTool.trip]); // eslint-disable-line react-hooks/exhaustive-deps

  const oneWay = !!city && !!dropoff && isOneWay({ pickup_city: city, dropoff_city: dropoff, pickup_date: pickup, dropoff_date: ret });

  const providers = oneWay ? [
    // Devolución en otra ciudad: solo Kayak recibe las dos ciudades por enlace.
    { name: "Kayak Cars", desc: `Recoges en ${city} y devuelves en ${dropoff} (búsqueda con ambas ciudades)`, url: () => kayakCarsUrl({ pickup_city: city, dropoff_city: dropoff, pickup_date: pickup, dropoff_date: ret }) ?? "", prefill: "kayak_cars" },
  ] : [
    // Kayak primero: es el único que recibe ciudad y fechas por enlace (comprobado).
    { name: "Kayak Cars", desc: "Meta-buscador con filtros por compañía y tipo", url: () => kayakCarsLink(city, pickup, ret), prefill: "kayak_cars" },
    { name: "Discover Cars", desc: "Comparador en 145 países · cancelación gratis 48h", url: () => discoverCarsLink(city, pickup, ret), prefill: "discovercars" },
    { name: "Rentalcars.com", desc: "Inventario Booking Holdings · soporte en su sitio", url: () => rentalcarsLink(city, pickup, ret), prefill: "rentalcars" },
  ];

  const canSearch = city && pickup && ret && (!oneWay || !!kayakCarsUrl({ pickup_city: city, dropoff_city: dropoff, pickup_date: pickup, dropoff_date: ret }));

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div className="flex items-start gap-3">
          <Car className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Renta de auto</h1>
            <p className="text-sm text-muted-foreground mt-1">Compara precios en 3 comparadores (el precio final lo da cada sitio)</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="tripcars-ciudad-aeropuerto" className="text-xs uppercase tracking-wide text-muted-foreground">Ciudad / Aeropuerto</label>
              <Input id="tripcars-ciudad-aeropuerto" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label htmlFor="tripcars-recoger" className="text-xs uppercase tracking-wide text-muted-foreground">Recoger</label>
              <Input id="tripcars-recoger" type="date" value={pickup} onChange={(e) => setPickup(e.target.value)} />
            </div>
            <div>
              <label htmlFor="tripcars-devolver" className="text-xs uppercase tracking-wide text-muted-foreground">Devolver</label>
              <Input id="tripcars-devolver" type="date" value={ret} onChange={(e) => setRet(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="tripcars-devolver-en" className="text-xs uppercase tracking-wide text-muted-foreground">Devolver en otra ciudad (opcional)</label>
            <Input id="tripcars-devolver-en" value={dropoff} onChange={(e) => setDropoff(e.target.value)} placeholder="Igual que la recogida" />
          </div>
          {oneWay && (
            <p className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2" data-testid="tripcars-one-way">
              Devolver el auto en otra ciudad o país suele tener un cargo extra; el monto lo da la arrendadora al cotizar (IATOS no lo estima).
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {providers.map((p) => (
            <div key={p.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{p.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{p.desc}</p>
              <Button disabled={!canSearch} onClick={() => tripTool.track({
                category: "car", provider: p.name, title: oneWay ? `Auto ${city} → ${dropoff}` : `Auto en ${city}`,
                city, bookingUrl: p.url(), startAt: pickup || undefined,
              })} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Buscar <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
              <PrefillNote provider={p.prefill} className="mt-2" />
            </div>
          ))}
        </div>

        {!canSearch && <p className="text-xs text-muted-foreground text-center">Completa ciudad y fechas para activar la búsqueda</p>}
      </div>
    </DashboardLayout>
  );
};

export default TripCars;
