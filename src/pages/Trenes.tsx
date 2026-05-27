import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Train, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { trainlineLink, omioLink, raileuropeLink } from "@/lib/affiliateLinks";
import { trackBookingClick } from "@/lib/trackBooking";

const Trenes = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [origin, setOrigin] = useState(params.get("origin") ?? "");
  const [destination, setDestination] = useState(params.get("dest") ?? "");
  const [date, setDate] = useState(params.get("date") ?? new Date().toISOString().slice(0, 10));

  const sources = [
    { name: "Trainline", desc: "El #1 en Europa y Reino Unido. 270+ operadores.", link: trainlineLink },
    { name: "Omio", desc: "Trenes, autobuses y vuelos en una sola búsqueda.", link: omioLink },
    { name: "Rail Europe", desc: "Eurail y trenes de alta velocidad en Europa.", link: raileuropeLink },
  ];

  function reservar(name: string, url: string) {
    if (!origin || !destination) return toast.error("Completa origen y destino");
    trackBookingClick({
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
        <div className="flex items-start gap-3">
          <Train className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Trenes</h1>
            <p className="text-sm text-muted-foreground mt-1">Trainline, Omio y Rail Europe — todos los operadores</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Origen</label>
              <Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="París" />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Ámsterdam" />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Fecha</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{s.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
              <Button disabled={!origin || !destination} onClick={() => reservar(s.name, s.link(origin, destination, date))} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Buscar <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Trenes;
