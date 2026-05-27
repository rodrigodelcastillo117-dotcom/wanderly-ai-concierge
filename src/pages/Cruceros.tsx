import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Anchor, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { vacationsToGoLink, cruiseDirectLink, cruiseCriticLink } from "@/lib/affiliateLinks";
import { trackBookingClick } from "@/lib/trackBooking";
import DestinationVideo from "@/components/DestinationVideo";

const DESTINOS = [
  "Caribbean",
  "Mediterranean",
  "Greek Isles",
  "Northern Europe / Baltic",
  "Alaska",
  "Mexican Riviera",
  "Transatlantic",
  "Asia",
  "South America",
  "Hawaii",
  "Australia / New Zealand",
];

const Cruceros = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [destination, setDestination] = useState(params.get("dest") ?? "Greek Isles");
  const [depart, setDepart] = useState(params.get("depart") ?? "");
  const [ret, setRet] = useState(params.get("ret") ?? "");

  const month = depart ? `${depart.slice(5, 7)}/${depart.slice(0, 4)}` : undefined;

  const sources = [
    {
      name: "Vacations To Go",
      desc: "El #1 mundial. Descuentos de hasta 90% sobre tarifa oficial. 90-day ticker para last-minute.",
      link: () => vacationsToGoLink(destination, month),
    },
    {
      name: "CruiseDirect",
      desc: "Comparador con todas las navieras (Royal Caribbean, MSC, Celestyal, NCL, Carnival). Precios reales.",
      link: () => cruiseDirectLink(destination, depart, ret),
    },
    {
      name: "Cruise Critic",
      desc: "Las mejores reseñas + buscador de precios. Ideal para escoger naviera y barco antes de reservar.",
      link: () => cruiseCriticLink(destination),
    },
  ];

  function reservar(name: string, url: string) {
    if (!destination) return toast.error("Selecciona destino");
    trackBookingClick({
      category: "activity",
      provider: name,
      title: `Crucero ${destination}`,
      subtitle: name,
      bookingUrl: url,
      startAt: depart || undefined,
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="relative w-full h-48 md:h-72 rounded-2xl overflow-hidden border border-white/10">
          <DestinationVideo
            query={`cruise ship ${destination || "ocean"}`}
            alt="Crucero"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex items-center gap-3">
              <Anchor className="w-7 h-7 text-primary" />
              <div>
                <h1 className="font-display text-3xl md:text-4xl">Cruceros</h1>
                <p className="text-sm text-muted-foreground">
                  Caribbean, Mediterráneo, islas griegas, Alaska — descuentos reales
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {DESTINOS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Salida</label>
              <Input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Regreso (opcional)</label>
              <Input type="date" value={ret} onChange={(e) => setRet(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: Vacations To Go ofrece los mejores precios last-minute. CruiseDirect es ideal si ya sabes qué naviera buscas.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{s.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
              <Button onClick={() => reservar(s.name, s.link())} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Buscar <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Cruceros;
