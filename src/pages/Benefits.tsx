import { useNavigate } from "react-router-dom";
import { ArrowLeft, Crown, ExternalLink, Sparkles, Plane, Hotel, Wifi, Car, CreditCard } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";

const BENEFITS = [
  {
    icon: Plane,
    name: "Priority Pass",
    desc: "Acceso a +1,500 salas VIP en aeropuertos del mundo",
    perk: "30 días gratis con tarjeta American Express Platinum",
    url: "https://www.prioritypass.com/",
  },
  {
    icon: Hotel,
    name: "Hoteles.com Rewards",
    desc: "1 noche gratis cada 10 reservadas",
    perk: "Apila con Silver/Gold para upgrades automáticos",
    url: "https://www.hoteles.com/rewards",
  },
  {
    icon: Wifi,
    name: "Airalo eSIM",
    desc: "Datos móviles en 200+ países sin cambiar chip",
    perk: "$3 USD OFF tu primera eSIM con código NEWTOAIRALO",
    url: "https://www.airalo.com/?ref=iatos",
  },
  {
    icon: Car,
    name: "Discover Cars",
    desc: "Comparador de rentas de auto en 145 países",
    perk: "Cancelación gratis hasta 48h antes",
    url: "https://www.discovercars.com/",
  },
  {
    icon: CreditCard,
    name: "Wise (TransferWise)",
    desc: "Tarjeta multidivisa con tipo de cambio real",
    perk: "Hasta $700 USD/mes sin comisión en cajeros",
    url: "https://wise.com/",
  },
  {
    icon: Sparkles,
    name: "GetYourGuide",
    desc: "Tours, experiencias y skip-the-line en 150+ destinos",
    perk: "Cancelación gratis 24h antes en la mayoría",
    url: "https://www.getyourguide.com/",
  },
];

const Benefits = () => {
  const navigate = useNavigate();
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div className="flex items-start gap-3">
          <Crown className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Beneficios IATOS PRO</h1>
            <p className="text-sm text-muted-foreground mt-1">Servicios curados que usan los viajeros frecuentes</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {BENEFITS.map((b) => (
            <div key={b.name} className="glass-card rounded-2xl p-5 hover:border-primary/40 border border-white/10 transition-all">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <b.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-display text-lg mb-1">{b.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">{b.desc}</p>
              <div className="text-[11px] px-2 py-1.5 rounded bg-primary/10 text-primary border border-primary/20 mb-3">
                {b.perk}
              </div>
              <Button onClick={() => window.open(b.url, "_blank")} variant="outline" size="sm" className="w-full">
                Ver más <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Benefits;
