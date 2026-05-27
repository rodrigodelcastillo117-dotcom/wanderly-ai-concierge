import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Wifi, ExternalLink } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { airaloLink, holaflyLink } from "@/lib/affiliateLinks";

const PROVIDERS = [
  {
    name: "Airalo",
    desc: "eSIM en 200+ países, planes desde $4.50 USD. Activación instantánea por QR.",
    perk: "$3 USD OFF primera compra con código NEWTOAIRALO",
    link: (c: string) => airaloLink(c),
  },
  {
    name: "Holafly",
    desc: "Datos ilimitados en 170+ destinos. Mantiene tu WhatsApp activo.",
    perk: "5% OFF con código HOLAFLY5",
    link: (c: string) => holaflyLink(c),
  },
  {
    name: "Nomad",
    desc: "eSIM premium con cobertura empresarial en 165 países.",
    perk: "Planes regionales desde $9 USD",
    link: (_: string) => "https://www.getnomad.app/",
  },
];

const TripESIM = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [country, setCountry] = useState(params.get("country") ?? "");

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <Wifi className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">eSIM para tu viaje</h1>
            <p className="text-sm text-muted-foreground mt-1">Datos móviles sin roaming · activación al aterrizar</p>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 md:p-5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">País destino</label>
          <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Spain, Japan, Mexico…" />
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <div key={p.name} className="glass-card rounded-2xl p-5 border border-white/10 hover:border-primary/40 transition-all">
              <h3 className="font-display text-lg mb-1">{p.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">{p.desc}</p>
              <div className="text-[11px] px-2 py-1.5 rounded bg-primary/10 text-primary border border-primary/20 mb-3">
                {p.perk}
              </div>
              <Button onClick={() => window.open(p.link(country), "_blank")} className="w-full">
                Comprar eSIM <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripESIM;
