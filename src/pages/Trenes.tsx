import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Train, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { trainlineLink, omioLink, raileuropeLink } from "@/lib/affiliateLinks";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";
import { localISODate } from "@/lib/localDate";
import { multimodalAction, operatorAction, routeOperators } from "../../supabase/functions/_shared/booking/railOperators.ts";

const Trenes = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [origin, setOrigin] = useState(params.get("origin") ?? "");
  const [destination, setDestination] = useState(params.get("dest") ?? "");
  const [date, setDate] = useState(params.get("date") ?? localISODate());
  const [pax, setPax] = useState(Math.max(1, Number(params.get("pax") ?? tripTool.trip?.num_viajeros ?? 1) || 1));
  // Operador oficial del país con la búsqueda precargada cuando su formato se comprobó (Renfe, DB) o su
  // portada; 12Go con ruta y fecha en el Sudeste Asiático. Nunca un precio.
  const q = { from: origin, to: destination, date, adults: pax };
  const ops = origin && destination ? routeOperators({ from: origin, to: destination, country: tripTool.trip?.pais_destino }) : [];
  const actions = [...ops.map((o) => operatorAction(o, q)), ...(origin && destination ? [multimodalAction(q)].filter((a): a is NonNullable<typeof a> => !!a) : [])];

  const sources = [
    { name: "Trainline", desc: "El #1 en Europa y Reino Unido. 270+ operadores.", link: trainlineLink, prefill: "trainline" },
    { name: "Omio", desc: "Trenes, autobuses y vuelos en una sola búsqueda.", link: omioLink, prefill: "omio" },
    { name: "Rail Europe", desc: "Eurail y trenes de alta velocidad en Europa.", link: raileuropeLink, prefill: "raileurope" },
  ];

  function reservar(name: string, url: string) {
    if (!origin || !destination) return toast.error("Completa origen y destino");
    tripTool.track({
      category: "train",
      provider: name,
      title: `${origin} → ${destination}`,
      subtitle: name,
      bookingUrl: url,
      startAt: date,
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div className="flex items-start gap-3">
          <Train className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Trenes</h1>
            <p className="text-sm text-muted-foreground mt-1">Trainline, Omio y Rail Europe — todos los operadores</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label htmlFor="trenes-origen" className="text-xs uppercase tracking-wide text-muted-foreground">Origen</label>
              <Input id="trenes-origen" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="París" />
            </div>
            <div className="space-y-1">
              <label htmlFor="trenes-destino" className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
              <Input id="trenes-destino" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Ámsterdam" />
            </div>
            <div className="space-y-1">
              <label htmlFor="trenes-fecha" className="text-xs uppercase tracking-wide text-muted-foreground">Fecha</label>
              <Input id="trenes-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="trenes-pasajeros" className="text-xs uppercase tracking-wide text-muted-foreground">Pasajeros</label>
              <Input id="trenes-pasajeros" type="number" min={1} max={9} value={pax} onChange={(e) => setPax(Math.min(9, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          </div>
        </div>

        {actions.length > 0 && (
          <div className="glass-card rounded-xl p-4 md:p-5 space-y-2" data-testid="trenes-operadores">
            <h2 className="font-display text-lg">Operador oficial</h2>
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button key={a.url} variant={a.prefilled ? "default" : "outline"} data-testid="trenes-operador" data-prefilled={a.prefilled ? "1" : "0"}
                  onClick={() => reservar(a.site, a.url)}>
                  {a.label} <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{actions[0].hint}</p>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{s.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
              <Button disabled={!origin || !destination} onClick={() => reservar(s.name, s.link(origin, destination, date))} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Buscar <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
              <PrefillNote provider={s.prefill} className="mt-2" />
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Trenes;
