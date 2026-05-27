import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Sparkles, ExternalLink, Search, Star, Loader2, MapPin, Phone } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getYourGuideLink, viatorLink, tripadvisorLink, openTableLink } from "@/lib/affiliateLinks";

type TAResult = {
  id: string; name: string; address: string; rating: number | null;
  num_reviews: number | null; ranking: string | null; web_url: string | null;
  phone: string | null; website: string | null; description: string | null;
  photos: string[]; category: string | null;
};

const TripActivities = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");
  const [cat, setCat] = useState<"attractions" | "restaurants" | "hotels">("attractions");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TAResult[]>([]);

  const sources = [
    { name: "GetYourGuide", desc: "Tours, skip-the-line, experiencias guiadas. Cancelación 24h.", link: () => getYourGuideLink(city) },
    { name: "Viator", desc: "Marketplace de TripAdvisor: actividades y tours.", link: () => viatorLink(city) },
    { name: "TripAdvisor Web", desc: "Catálogo completo con todos los reviews.", link: () => tripadvisorLink(city) },
    { name: "OpenTable", desc: "Reservas en restaurantes con disponibilidad real.", link: () => openTableLink(city) },
  ];

  async function buscar() {
    if (!city.trim()) return toast.error("Escribe un destino");
    setLoading(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("tripadvisor-search", {
        body: { query: city, category: cat, language: "es_MX" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResults(data?.results ?? []);
      if (!data?.results?.length) toast.message("Sin resultados para ese destino");
    } catch (e: any) {
      toast.error(e?.message ?? "Error buscando en TripAdvisor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <Sparkles className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Tours, restaurantes y atracciones</h1>
            <p className="text-sm text-muted-foreground mt-1">Reviews reales de TripAdvisor + marketplaces para reservar</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5 space-y-3">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Destino</label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Roma, Tokio, Cancún…" />
          <Tabs value={cat} onValueChange={(v) => setCat(v as any)}>
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="attractions">Atracciones</TabsTrigger>
              <TabsTrigger value="restaurants">Restaurantes</TabsTrigger>
              <TabsTrigger value="hotels">Hoteles</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={buscar} disabled={loading || !city} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            Buscar en TripAdvisor
          </Button>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display text-xl">Top resultados</h2>
            {results.map((r) => (
              <div key={r.id} className="glass-card rounded-2xl overflow-hidden border border-white/10">
                {r.photos[0] && (
                  <img src={r.photos[0]} alt={r.name} className="w-full h-48 object-cover" loading="lazy" />
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg">{r.name}</h3>
                    {r.rating && (
                      <span className="flex items-center gap-1 text-sm shrink-0">
                        <Star className="w-3 h-3 fill-primary text-primary" />
                        {r.rating} <span className="text-muted-foreground">({r.num_reviews})</span>
                      </span>
                    )}
                  </div>
                  {r.ranking && <p className="text-xs text-primary">{r.ranking}</p>}
                  {r.address && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{r.address}</p>}
                  {r.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone}</p>}
                  {r.description && <p className="text-sm text-muted-foreground line-clamp-2">{r.description}</p>}
                  <div className="flex gap-2 pt-2">
                    {r.web_url && (
                      <Button size="sm" onClick={() => window.open(r.web_url!, "_blank")} className="flex-1">
                        Ver en TripAdvisor <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    )}
                    {r.website && (
                      <Button size="sm" variant="outline" onClick={() => window.open(r.website!, "_blank")}>
                        Web oficial
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <h2 className="font-display text-xl mb-3">Otros marketplaces</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {sources.map((s) => (
              <div key={s.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
                <h3 className="font-display text-lg mb-2">{s.name}</h3>
                <p className="text-xs text-muted-foreground mb-4">{s.desc}</p>
                <Button disabled={!city} onClick={() => window.open(s.link(), "_blank")} variant="outline" className="w-full">
                  <Search className="w-3 h-3 mr-1" /> Explorar {city || "destino"} <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripActivities;
