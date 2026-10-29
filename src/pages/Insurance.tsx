import { useNavigate } from "react-router-dom";
import { Shield, ExternalLink, CheckCircle2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { PrefillNote } from "@/components/booking/PrefillNote";
import { TripToolBanner, useTripTool } from "@/components/TripToolContext";

// Sin calificaciones numéricas, códigos de descuento ni afirmaciones de marketing: no tenemos fuente
// verificada para mostrarlas (antes: "4.7/5 Trustpilot", "15% OFF con código IATOS" y, hasta la auditoría
// 10/10, "COVID incluido", "hasta 10M USD", "Recomendado por Lonely Planet"…). Solo el nombre y el enlace
// oficial; lo que hay que comparar va en una lista común, y la póliza de cada aseguradora es la que vale.
const PARTNERS = [
  { name: "Heymondo", url: "https://www.heymondo.com/?agencia_id=23021", color: "from-emerald-500/20 to-emerald-500/5" },
  { name: "Chapka Assurances", url: "https://www.chapkadirect.es/", color: "from-blue-500/20 to-blue-500/5" },
  // axa-assistance.com redirige a la portada corporativa de AXA Partners (no vende seguros de viaje
  // ahí, cierre 2 · A-AXA.jpg); este es su cotizador de seguro de viaje (D-AXA.jpg).
  { name: "AXA Assistance", url: "https://www.axatravelinsurance.com/", color: "from-amber-500/20 to-amber-500/5" },
  { name: "World Nomads", url: "https://www.worldnomads.com/", color: "from-rose-500/20 to-rose-500/5" },
];

/** Qué revisar en cualquier póliza antes de comprar (preguntas, no afirmaciones sobre una marca). */
export const INSURANCE_CHECKLIST = [
  "Monto de la cobertura médica y si incluye hospitalización y repatriación",
  "Deducible (lo que pagas tú antes de que pague la aseguradora)",
  "Equipaje perdido o demorado, y cancelación del viaje",
  "Actividades o deportes que vas a hacer",
  "Condiciones médicas preexistentes",
];

const Insurance = () => {
  // ?trip=<id>: muestra a qué viaje se agrega y cada clic queda en bookings con ese trip_id (E-22).
  const tripTool = useTripTool();
  const navigate = useNavigate();
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <TripToolBanner tool={tripTool} />
        <div className="flex items-start gap-3">
          <Shield className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Seguros de viaje</h1>
            <p className="text-sm text-muted-foreground mt-1">Aseguradoras de terceros · cotiza y compra en su sitio oficial</p>
          </div>
        </div>

        <section className="glass-card rounded-xl p-4" aria-labelledby="seguro-revisa">
          <h2 id="seguro-revisa" className="text-sm font-medium mb-2">Antes de comprar, compara en cada póliza</h2>
          <ul className="space-y-1.5">
            {INSURANCE_CHECKLIST.map((c) => (
              <li key={c} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PARTNERS.map((p) => (
            <div key={p.name} className={`glass-card rounded-2xl p-5 bg-gradient-to-br ${p.color} border border-white/10`}>
              <div className="mb-4">
                <h3 className="font-display text-xl">{p.name}</h3>
                <p className="text-xs text-muted-foreground">Coberturas, precios y condiciones: en su sitio oficial y en la póliza.</p>
              </div>
              <Button onClick={() => tripTool.track({
                category: "insurance", provider: p.name, title: `Seguro de viaje — ${p.name}`,
                subtitle: "Seguro de viaje", bookingUrl: p.url,
              })} className="w-full" size="sm">
                Cotizar en {p.name} <ExternalLink className="w-3 h-3 ml-1" aria-hidden="true" />
              </Button>
              <PrefillNote provider="seguro" className="mt-2" />
            </div>
          ))}
        </div>

        <div className="glass-card rounded-xl p-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Tip de viajero:</strong> Contrata el seguro antes de salir del país y revisa qué pasa con
          lo que ocurrió antes de comprarlo. Si tramitas una visa Schengen, se pide un seguro médico que cubra emergencias,
          hospitalización y repatriación (<a className="text-primary underline underline-offset-2" href="https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy/applying-schengen-visa_en" target="_blank" rel="noopener noreferrer">Comisión Europea</a>).
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Insurance;
