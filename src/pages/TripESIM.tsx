import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Wifi, ExternalLink } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { airaloLink, holaflyLink } from "@/lib/affiliateLinks";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";

const PROVIDERS = [
  {
    name: "Airalo",
    desc: "eSIM en 200+ países, planes desde $4.50 USD. Activación instantánea por QR.",
    perk: "$3 USD OFF primera compra con código NEWTOAIRALO",
    link: (c: string) => airaloLink(c),
    prefill: "airalo",
  },
  {
    name: "Holafly",
    desc: "Planes por destino en 170+ países; revisa en su sitio el límite de datos de cada plan.",
    perk: "5% OFF con código HOLAFLY5",
    link: (c: string) => holaflyLink(c),
    prefill: "holafly",
  },
  {
    name: "Nomad",
    desc: "eSIM premium con cobertura empresarial en 165 países.",
    perk: "Planes regionales desde $9 USD",
    link: (_: string) => "https://www.getnomad.app/",
    prefill: "nomad",
  },
];

const TripESIM = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [country, setCountry] = useState(params.get("country") ?? "");
  // Sin país en la URL, el del viaje en contexto (Airalo y Holafly abren la página de ese país).
  useEffect(() => { if (!country && tripTool.trip?.pais_destino) setCountry(tripTool.trip.pais_destino); }, [tripTool.trip?.pais_destino]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div className="flex items-start gap-3">
          <Wifi className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">eSIM para tu viaje</h1>
            <p className="text-sm text-muted-foreground mt-1">Datos móviles sin roaming · activación al aterrizar</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5">
          <label htmlFor="tripesim-pais-destino" className="text-xs uppercase tracking-wide text-muted-foreground">País destino</label>
          <Input id="tripesim-pais-destino" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="España, Japón, Estados Unidos…" />
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <div key={p.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-1">{p.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">{p.desc}</p>
              <div className="text-[11px] px-2 py-1.5 rounded bg-primary/10 text-primary border border-primary/20 mb-3">
                {p.perk}
              </div>
              <Button onClick={() => tripTool.track({
                category: "esim", provider: p.name, title: `eSIM ${country || ""}`.trim(),
                country, bookingUrl: p.link(country),
              })} className="w-full">
                Comprar eSIM <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
              <PrefillNote provider={p.prefill} className="mt-2" />
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripESIM;
