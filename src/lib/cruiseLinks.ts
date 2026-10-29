// Enlaces del tramo crucero: la naviera que dijo la persona (sitio oficial) o buscadores conocidos, y
// una búsqueda con puertos y fechas. El precio siempre es "por cotizar con la naviera": IATOS no lo
// inventa ni lo suma al total. Todos los dominios están en la lista blanca (_shared/booking/allowlist.ts).
import { cruiseCriticLink, vacationsToGoLink } from "@/lib/affiliateLinks";
// Módulo chico (no allowlist.ts): ver la nota de cruiseDomains.ts.
import { CRUISE_DOMAINS, isCruiseLinkAllowed } from "../../supabase/functions/_shared/booking/cruiseDomains.ts";
import { normText, type Cruise } from "../../supabase/functions/_shared/tripSpec.ts";

export type CruiseLink = { label: string; url: string; nota: string };

const ALIASES: Record<string, string> = {
  msc: "msccruises.com", "msc cruceros": "msccruises.com", "msc cruises": "msccruises.com",
  "royal caribbean": "royalcaribbean.com", celebrity: "celebritycruises.com", norwegian: "ncl.com", ncl: "ncl.com",
  silversea: "silversea.com", seabourn: "seabourn.com", regent: "rssc.com", "regent seven seas": "rssc.com", oceania: "oceaniacruises.com",
  viking: "vikingcruises.com", explora: "explorajourneys.com", "explora journeys": "explorajourneys.com", aroya: "aroya.com",
  costa: "costacruises.com", "costa cruceros": "costacruises.com", princess: "princess.com", "holland america": "hollandamerica.com",
  cunard: "cunard.com", ponant: "ponant.com", crystal: "crystalcruises.com", celestyal: "celestyal.com", disney: "disneycruise.disney.go.com",
  carnival: "carnival.com",
};

/** Sitio oficial de la naviera escrita ("MSC" → msccruises.com) o null si no la conocemos. */
export function navieraSite(naviera: string | null | undefined): { label: string; url: string } | null {
  const k = normText(naviera);
  if (!k) return null;
  const domain = ALIASES[k] ?? CRUISE_DOMAINS.find(([, label]) => normText(label) === k || k.includes(normText(label)))?.[0]
    ?? Object.entries(ALIASES).find(([a]) => k.includes(a))?.[1];
  if (!domain) return null;
  const label = CRUISE_DOMAINS.find(([d]) => d === domain)?.[1] ?? naviera!;
  return { label, url: `https://www.${domain.replace(/^www\./, "")}/`.replace("www.disneycruise", "disneycruise") };
}

const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthOf = (iso: string | null) => (iso && /^\d{4}-\d{2}/.test(iso) ? `${MES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

/** Enlaces reales para cotizar el crucero (solo los que pasan la lista blanca). */
export function cruiseLinks(c: Cruise | null, from?: string | null, to?: string | null): CruiseLink[] {
  const salida = c?.puerto_salida || from || "";
  const llegada = c?.puerto_llegada || to || "";
  const out: CruiseLink[] = [];
  const site = navieraSite(c?.naviera);
  if (site) out.push({ label: site.label, url: site.url, nota: "Sitio oficial: elige puertos y fechas en su buscador." });
  const when = monthOf(c?.fecha_salida ?? null);
  // Cruise Critic recibe el destino por URL; las fechas y el puerto de salida se eligen en su buscador.
  out.push({ label: "Cruise Critic", url: cruiseCriticLink(llegada || salida), nota: `Buscador con el destino ${llegada || salida}${when ? `; elige ${when} ahí` : ""}.` });
  if (!site) out.push({ label: "Vacations To Go", url: vacationsToGoLink(), nota: `Buscador de cruceros: elige destino${when ? ` y ${when}` : " y mes"} ahí.` });
  return out.filter((l) => isCruiseLinkAllowed(l.url));
}

export const CRUISE_PRICE_NOTE = "Precio por cotizar con la naviera · no suma al total";
