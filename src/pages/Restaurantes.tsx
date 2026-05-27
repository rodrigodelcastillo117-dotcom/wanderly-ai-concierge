import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, UtensilsCrossed, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { openTableLink, theforkLink, yelpLink, tripadvisorLink } from "@/lib/affiliateLinks";
import { trackBookingClick } from "@/lib/trackBooking";

const Restaurantes = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");

  const sources = [
    { name: "OpenTable", desc: "Reservas con disponibilidad en vivo. EE.UU., México, Europa.", link: openTableLink },
    { name: "TheFork", desc: "Líder en Europa. Reservas con descuentos hasta 50%.", link: theforkLink },
    { name: "Yelp", desc: "Reviews + reserva en restaurantes locales.", link: yelpLink },
    { name: "TripAdvisor", desc: "Catálogo global con reviews de viajeros.", link: tripadvisorLink },
  ];

  function reservar(name: string, url: string) {
    if (!city.trim()) return toast.error("Escribe una ciudad");
    trackBookingClick({
      category: "restaurant",
      provider: name,
      title: `Reservar mesa en ${city}`,
      subtitle: name,
      bookingUrl: url,
      city,
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div className="flex items-start gap-3">
          <UtensilsCrossed className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Reservar mesa</h1>
            <p className="text-sm text-muted-foreground mt-1">OpenTable, TheFork, Yelp y TripAdvisor — disponibilidad real</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Ciudad</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Roma, CDMX, París…" />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{s.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
              <Button disabled={!city} onClick={() => reservar(s.name, s.link(city))} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Reservar en {city || "ciudad"} <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center pt-4">
          Cada reserva queda guardada en <button onClick={() => navigate("/dashboard/reservas")} className="text-primary underline">Mis reservas</button>.
        </p>
      </div>
    </DashboardLayout>
  );
};

export default Restaurantes;
