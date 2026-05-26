import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Car, ExternalLink, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { discoverCarsLink, rentalcarsLink, kayakCarsLink } from "@/lib/affiliateLinks";

const TripCars = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [city, setCity] = useState(params.get("city") ?? "");
  const [pickup, setPickup] = useState(params.get("pickup") ?? "");
  const [ret, setRet] = useState(params.get("return") ?? "");

  const providers = [
    { name: "Discover Cars", desc: "Comparador en 145 países · cancelación gratis 48h", url: () => discoverCarsLink(city, pickup, ret) },
    { name: "Rentalcars.com", desc: "Inventario Booking Holdings · soporte 24/7", url: () => rentalcarsLink(city, pickup, ret) },
    { name: "Kayak Cars", desc: "Meta-buscador con filtros por compañía y tipo", url: () => kayakCarsLink(city, pickup, ret) },
  ];

  const canSearch = city && pickup && ret;

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div className="flex items-start gap-3">
          <Car className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Renta de auto</h1>
            <p className="text-sm text-muted-foreground mt-1">Compara precios reales en los 3 mejores comparadores</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-6 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Ciudad / Aeropuerto</label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Recoger</label>
              <Input type="date" value={pickup} onChange={(e) => setPickup(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Devolver</label>
              <Input type="date" value={ret} onChange={(e) => setRet(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {providers.map((p) => (
            <div key={p.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-2">{p.name}</h3>
              <p className="text-xs text-muted-foreground mb-4">{p.desc}</p>
              <Button disabled={!canSearch} onClick={() => window.open(p.url(), "_blank")} className="w-full">
                <Search className="w-3 h-3 mr-1" /> Buscar <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>

        {!canSearch && <p className="text-xs text-muted-foreground text-center">Completa ciudad y fechas para activar la búsqueda</p>}
      </div>
    </DashboardLayout>
  );
};

export default TripCars;
