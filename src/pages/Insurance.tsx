import { useNavigate } from "react-router-dom";
import { Shield, ExternalLink, CheckCircle2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trackBookingClick } from "@/lib/trackBooking";

// Sin calificaciones numéricas ni códigos de descuento: no tenemos fuente verificada
// para mostrarlos (antes: "4.7/5 Trustpilot", "15% OFF con código IATOS").
// Las coberturas son de referencia; la póliza de cada aseguradora es la que vale.
const PARTNERS = [
  {
    name: "Heymondo",
    tagline: "Cobertura médica hasta 10M USD · COVID incluido",
    perks: ["Sin franquicia", "Atención 24/7 en español", "App con asistencia médica por video"],
    url: "https://www.heymondo.com/?agencia_id=23021",
    color: "from-emerald-500/20 to-emerald-500/5",
  },
  {
    name: "Chapka Assurances",
    tagline: "El favorito de mochileros y nómadas digitales",
    perks: ["Cap Working Holiday", "Cobertura mundial", "Equipaje hasta 2000€"],
    url: "https://www.chapkadirect.es/",
    color: "from-blue-500/20 to-blue-500/5",
  },
  {
    name: "AXA Assistance",
    tagline: "Marca global de confianza · ideal viajes premium",
    perks: ["Multiviaje anual", "Cancelación por cualquier motivo", "Deportes de aventura"],
    url: "https://www.axa-assistance.com/",
    color: "from-amber-500/20 to-amber-500/5",
  },
  {
    name: "World Nomads",
    tagline: "El estándar para viajeros aventureros",
    perks: ["200+ actividades cubiertas", "Extender en ruta", "Recomendado por Lonely Planet"],
    url: "https://www.worldnomads.com/",
    color: "from-rose-500/20 to-rose-500/5",
  },
];

const Insurance = () => {
  const navigate = useNavigate();
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <Shield className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Seguros de viaje</h1>
            <p className="text-sm text-muted-foreground mt-1">Aseguradoras de terceros · cotiza y compra en su sitio oficial</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {PARTNERS.map((p) => (
            <div key={p.name} className={`glass-card rounded-2xl p-5 bg-gradient-to-br ${p.color} border border-white/10`}>
              <div className="mb-3">
                <h3 className="font-display text-xl">{p.name}</h3>
                <p className="text-xs text-muted-foreground">Coberturas de referencia · confírmalas en la póliza</p>
              </div>
              <p className="text-sm mb-4">{p.tagline}</p>
              <ul className="space-y-1.5 mb-4">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              <Button onClick={() => trackBookingClick({
                category: "insurance", provider: p.name, title: `Seguro de viaje — ${p.name}`,
                subtitle: p.tagline, bookingUrl: p.url,
              })} className="w-full" size="sm">
                Cotizar en {p.name} <ExternalLink className="w-3 h-3 ml-1" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <div className="glass-card rounded-xl p-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Tip de viajero:</strong> Contrata el seguro antes de salir del país.
          La mayoría no cubre eventos preexistentes a la compra. Para visado Schengen necesitas cobertura mínima de €30,000.
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Insurance;
