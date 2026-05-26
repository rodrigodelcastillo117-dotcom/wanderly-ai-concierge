import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getYourGuideLink, viatorLink, tripadvisorLink, openTableLink } from "@/lib/affiliateLinks";

const TripActivities = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");

  const sources = [
    { name: "GetYourGuide", desc: "Tours, skip-the-line, experiencias guiadas. Cancelación 24h.", link: () => getYourGuideLink(city) },
    { name: "Viator", desc: "Marketplace de TripAdvisor: actividades, tours y atracciones.", link: () => viatorLink(city) },
    { name: "TripAdvisor", desc: "Reviews reales, top atracciones y restaurantes ranked.", link: () => tripadvisorLink(city) },
    { name: "OpenTable", desc: "Reservas en restaurantes top con disponibilidad en tiempo real.", link: () => openTableLink(city) },
  ];

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div className="flex items-start gap-3">
          <Sparkles className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Tours y experiencias</h1>
            <p className="text-sm text-muted-foreground mt-1">Reserva en los marketplaces más confiables del mundo</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Roma, Tokio, Cancún…" />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          {sources.map((s) => (
            <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{s.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
              <Button disabled={!city} onClick={() => window.open(s.link(), "_blank")} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Explorar {city || "destino"} <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripActivities;
