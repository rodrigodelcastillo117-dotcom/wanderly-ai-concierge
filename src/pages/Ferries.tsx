import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Ship, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ferryhopperLink, directFerriesLink, aferryLink } from "@/lib/affiliateLinks";
import { trackBookingClick } from "@/lib/trackBooking";
import DestinationVideo from "@/components/DestinationVideo";

const Ferries = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [origin, setOrigin] = useState(params.get("origin") ?? "");
  const [destination, setDestination] = useState(params.get("dest") ?? "");
  const [date, setDate] = useState(params.get("date") ?? new Date().toISOString().slice(0, 10));
  const [passengers, setPassengers] = useState(Number(params.get("pax") ?? 2));

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
    trackBookingClick({
      category: "train",
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
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Puerto origen</label>
              <Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Athens (Piraeus)" />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Puerto destino</label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Mykonos" />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Fecha</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Pasajeros</label>
              <Input type="number" min={1} max={20} value={passengers} onChange={(e) => setPassengers(Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: usa los nombres en inglés del puerto (ej. "Piraeus" no "El Pireo"). Cada buscador resuelve mejor con eso.
          </p>
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
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Ferries;
