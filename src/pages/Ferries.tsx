import { useState } from "react";
import { Anchor, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requestFerries, type FerrySummary, type Invoke } from "@/lib/ferryLive";
import { clickAndBoatSearchUrl, groundButtonLabel } from "../../supabase/functions/_shared/booking/groundLinks.ts";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ship, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ferryhopperLink, directFerriesLink, aferryLink } from "@/lib/affiliateLinks";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";
import DestinationVideo from "@/components/DestinationVideo";
import { localISODate } from "@/lib/localDate";
import { formatLocalDate } from "@/lib/localDate";

const Ferries = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [origin, setOrigin] = useState(params.get("origin") ?? "");
  const [destination, setDestination] = useState(params.get("dest") ?? "");
  const [date, setDate] = useState(params.get("date") ?? localISODate());
  const [passengers, setPassengers] = useState(Number(params.get("pax") ?? 2));
  // Salidas y precio en vivo de Ferryhopper (ferry-search): solo tras el botón.
  const [live, setLive] = useState<FerrySummary | null>(null);
  const [busy, setBusy] = useState(false);
  async function verEnVivo() {
    if (!origin || !destination || !date) return toast.error("Completa puertos y fecha");
    setBusy(true);
    try {
      const invoke: Invoke = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>;
      setLive(await requestFerries(invoke, { from: origin, to: destination, date, passengers }));
    } finally { setBusy(false); }
  }
  // Yate o lancha: Click&Boat con lugar ("Ciudad, País"), fechas y personas (formato comprobado).
  const [boatCity, setBoatCity] = useState(params.get("boat") ?? "");
  const [boatTo, setBoatTo] = useState("");
  const boatUrl = clickAndBoatSearchUrl({ city: boatCity, from: date, to: boatTo || date, people: passengers });

  const sources = [
    {
      name: "Ferryhopper",
      desc: "El #1 en Grecia, Italia, España y Mediterráneo. 80+ operadores, precios y horarios reales.",
      link: () => ferryhopperLink(origin, destination, date, passengers),
    },
    {
      name: "Direct Ferries",
      desc: "Cobertura mundial — Europa, Canal de la Mancha, Irlanda, Asia. 3,500+ rutas.",
      link: () => directFerriesLink(origin, destination, date, passengers),
    },
    {
      name: "AFerry",
      desc: "Especialista UK / Norte de Europa. Buenos precios en Dover-Calais, Holyhead-Dublín.",
      link: () => aferryLink(origin, destination, date),
    },
  ];

  function reservar(name: string, url: string) {
    if (!origin || !destination) return toast.error("Completa origen y destino");
    tripTool.track({
      category: "ferry",
      provider: name,
      title: `Ferry ${origin} → ${destination}`,
      subtitle: name,
      bookingUrl: url,
      startAt: date,
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div className="relative w-full h-48 md:h-64 rounded-2xl overflow-hidden border border-white/10">
          <DestinationVideo
            query={`ferry boat ${destination || "mediterranean sea"}`}
            alt="Ferry"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex items-center gap-3">
              <Ship className="w-7 h-7 text-primary" />
              <div>
                <h1 className="font-display text-3xl md:text-4xl">Ferries</h1>
                <p className="text-sm text-muted-foreground">Islas griegas, Mediterráneo, UK, Caribe — todos los operadores</p>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label htmlFor="ferries-puerto-origen" className="text-xs uppercase tracking-wide text-muted-foreground">Puerto origen</label>
              <Input id="ferries-puerto-origen" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Athens (Piraeus)" />
            </div>
            <div className="space-y-1">
              <label htmlFor="ferries-puerto-destino" className="text-xs uppercase tracking-wide text-muted-foreground">Puerto destino</label>
              <Input id="ferries-puerto-destino" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Mykonos" />
            </div>
            <div className="space-y-1">
              <label htmlFor="ferries-fecha" className="text-xs uppercase tracking-wide text-muted-foreground">Fecha</label>
              <Input id="ferries-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="ferries-pasajeros" className="text-xs uppercase tracking-wide text-muted-foreground">Pasajeros</label>
              <Input id="ferries-pasajeros" type="number" min={1} max={20} value={passengers} onChange={(e) => setPassengers(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: usa los nombres en inglés del puerto (ej. "Piraeus" no "El Pireo"). Cada buscador resuelve mejor con eso.
          </p>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3" data-testid="ferry-live">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg">Salidas reales</h2>
              <p className="text-xs text-muted-foreground">Horarios y precio en vivo de Ferryhopper para tu ruta y fecha.</p>
            </div>
            <Button onClick={() => void verEnVivo()} disabled={busy || !origin || !destination || !date} data-testid="ferry-live-buscar">
              {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />} Ver salidas y precio en vivo
            </Button>
          </div>
          {live && !live.ok && <p className="text-sm text-muted-foreground" data-testid="ferry-live-error">{live.message}</p>}
          {live && live.ok && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground" data-testid="ferry-live-fuente">
                Ferryhopper{live.ports ? ` · ${live.ports}` : ""}{live.consultedLabel ? ` · ${live.consultedLabel}` : ""}
              </p>
              {live.rows.length === 0 ? (
                <p className="text-sm" data-testid="ferry-live-vacio">Ferryhopper no tiene salidas para esa ruta y fecha. Prueba otro día o el puerto en inglés.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {live.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="ferry-live-salida">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{r.sale} → {r.llega}{r.llegaOtroDia ? " (+1 día)" : ""}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.naviera}{r.barco ? ` · ${r.barco}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-right">{r.priceText ?? "Precio en Ferryhopper"}</span>
                        <button type="button" data-testid="ferry-live-abrir" data-url={r.url}
                          onClick={() => tripTool.track({ category: "ferry", provider: "Ferryhopper", title: `Ferry ${origin} → ${destination}`, subtitle: r.naviera, bookingUrl: r.url, startAt: date })}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-primary/40 px-3 text-xs text-primary">
                          Ver en Ferryhopper <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {live.note && <p className="text-[11px] text-muted-foreground">{live.note}</p>}
              {live.routeUrl && (
                <a href={live.routeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid="ferry-live-ruta">
                  Ver todas en Ferryhopper con {passengers} {passengers === 1 ? "pasajero" : "pasajeros"} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{s.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
              <Button
                disabled={!origin || !destination}
                onClick={() => reservar(s.name, s.link())}
                className="w-full"
              >
                <Search className="w-3 h-3 mr-1" /> Buscar <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
              <PrefillNote provider="ferry" className="mt-2" />
            </div>
          ))}
        </div>

        <div id="yate" className="glass-card rounded-xl p-4 md:p-5 space-y-3" data-testid="yate-lancha">
          <div className="flex items-start gap-3">
            <Anchor className="w-5 h-5 text-primary mt-1" aria-hidden="true" />
            <div>
              <h2 className="font-display text-lg">Yate o lancha</h2>
              <p className="text-xs text-muted-foreground">Renta por día en Click&amp;Boat con tu destino, fechas y personas. Disponibilidad y precio los da cada dueño.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label htmlFor="yate-destino" className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
              <Input id="yate-destino" value={boatCity} onChange={(e) => setBoatCity(e.target.value)} placeholder="Cancún" />
            </div>
            <div className="space-y-1">
              <label htmlFor="yate-hasta" className="text-xs uppercase tracking-wide text-muted-foreground">Hasta (opcional)</label>
              <Input id="yate-hasta" type="date" value={boatTo} onChange={(e) => setBoatTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="w-full" disabled={!boatUrl} data-testid="yate-buscar" onClick={() => boatUrl && tripTool.track({
                category: "other", provider: "Click&Boat", title: `Yate o lancha en ${boatCity}`, bookingUrl: boatUrl, startAt: date,
              })}>
                {groundButtonLabel("Click&Boat")} <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {boatCity && !boatUrl ? "No reconocemos el país de ese destino: escribe una ciudad del catálogo (p. ej. Cancún, Ibiza, Mykonos)." : `Llega con: destino, fecha (${date ? formatLocalDate(date, { day: "numeric", month: "short", year: "numeric" }) : "elige una"}) y ${passengers} ${passengers === 1 ? "persona" : "personas"}.`}
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Ferries;
