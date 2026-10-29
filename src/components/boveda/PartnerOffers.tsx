import { ChevronDown, ExternalLink, Hotel, Plane, Sparkles, Wifi, Car, CreditCard } from "lucide-react";
import { airaloLink, discoverCarsLink, getYourGuideLink } from "@/lib/affiliateLinks";
import { trackBookingClick } from "@/lib/trackBooking";

// Antes era todo /dashboard/beneficios; ahora vive plegado al final de la Bóveda.
// Fechas placeholder solo para que el link de Discover Cars abra con un rango razonable.
const hoy = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const enUnMes = new Date(hoy.getTime() + 30 * 864e5);
const enDosMeses = new Date(hoy.getTime() + 60 * 864e5);

const OFFERS = [
  // Sin programa de afiliado propio confirmado — va directo al sitio oficial.
  { icon: Plane, name: "Priority Pass", desc: "Salas VIP en aeropuertos del mundo", url: "https://www.prioritypass.com/" },
  { icon: Hotel, name: "Hoteles.com Rewards", desc: "Programa de lealtad de Hoteles.com", url: "https://www.hoteles.com/rewards" },
  { icon: Wifi, name: "Airalo eSIM", desc: "Datos móviles en 200+ países · $3 USD con NEWTOAIRALO", url: airaloLink(), category: "esim" as const },
  { icon: Car, name: "Discover Cars", desc: "Comparador de rentas de auto", url: discoverCarsLink("", iso(enUnMes), iso(enDosMeses)), category: "car" as const },
  // Requiere código de referido personal de Wise — sin programa configurado.
  { icon: CreditCard, name: "Wise", desc: "Tarjeta multidivisa con tipo de cambio real", url: "https://wise.com/" },
  { icon: Sparkles, name: "GetYourGuide", desc: "Tours y experiencias en 150+ destinos", url: getYourGuideLink(""), category: "activity" as const },
];

export function PartnerOffers() {
  return (
    <details className="group rounded-2xl border border-border/60 bg-surface/40">
      <summary className="list-none cursor-pointer px-4 h-12 flex items-center justify-between text-sm">
        <span><span className="text-muted-foreground">Ofertas de socios</span> <span className="text-[11px] text-muted-foreground/80">· públicas, no exclusivas de IATOS</span></span>
        <ChevronDown className="w-4 h-4 text-muted-foreground transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-2 pb-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
        {OFFERS.map((o) => (
          <button key={o.name} type="button"
            onClick={() => ("category" in o
              ? trackBookingClick({ category: o.category, provider: o.name, title: o.name, subtitle: o.desc, bookingUrl: o.url })
              : window.open(o.url, "_blank", "noopener,noreferrer"))}
            className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-surface transition">
            <span className="w-8 h-8 rounded-lg bg-primary/10 grid place-items-center shrink-0"><o.icon className="w-4 h-4 text-primary" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm truncate">{o.name}</span>
              <span className="block text-[11px] text-muted-foreground truncate">{o.desc}</span>
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">Las condiciones las pone cada socio y pueden cambiar: verifícalas en su sitio.</p>
    </details>
  );
}
