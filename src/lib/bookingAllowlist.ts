// Lista blanca del Booking Bridge en el NAVEGADOR (ronda 2 de la auditoría técnica, P2-5).
//
// Mismas reglas que el servidor (supabase/functions/_shared/booking/allowlistCore.ts) sobre los mismos
// proveedores, pero sin la justificación interna de cada dominio y con una lista de sufijos públicos
// reducida (src/lib/bookingAllowlist.data.ts, generada). Antes el paquete público cargaba allowlist.ts
// entero (169 KB con notas internas). El cliente solo decide qué botón pintar: booking-bridge y booking-go
// vuelven a revisar cada URL con la lista completa antes de guardar o redirigir.
//
// En el build del navegador, vite.clientAllowlist.ts también manda aquí los imports de allowlist.ts que
// hacen los módulos compartidos (resolver.ts, offers.ts…). src/test/pulidoR2.test.tsx compara esta lista
// con la del servidor caso por caso.
import { createAllowlist, type ProviderRule, type UrlVerdict as CoreVerdict } from "../../supabase/functions/_shared/booking/allowlistCore.ts";
import { asciiHost } from "../../supabase/functions/_shared/booking/host.ts";
import { CLIENT_PROVIDERS, PSL_LITE_PRIVATE, PSL_LITE_SECOND_LEVEL, PSL_LITE_TLDS } from "./bookingAllowlist.data";

export { TM_DOMAINS } from "../../supabase/functions/_shared/booking/tmDomains.ts";
export { CRUISE_DOMAINS } from "../../supabase/functions/_shared/booking/cruiseDomains.ts";

export type ProviderInfo = ProviderRule;
export type UrlVerdict = CoreVerdict<ProviderRule>;

export const PROVIDERS: ProviderInfo[] = CLIENT_PROVIDERS;

let TLDS: Set<string> | null = null;
let SUFFIXES: Set<string>;

function load(): Set<string> {
  if (TLDS) return TLDS;
  SUFFIXES = new Set(PSL_LITE_PRIVATE.split(","));
  for (const group of PSL_LITE_SECOND_LEVEL.split(",")) {
    const [tld, slds] = group.split(":");
    for (const s of slds.split("|")) SUFFIXES.add(`${s}.${tld}`);
  }
  return (TLDS = new Set(PSL_LITE_TLDS.split(",")));
}

/**
 * Dominio registrable con la lista de sufijos reducida (sufijo público + una etiqueta); null para IPs,
 * sufijos públicos y TLDs inexistentes. Igual que la PSL completa salvo en sufijos poco comunes.
 */
export function registrableDomain(host: string): string | null {
  const h = asciiHost(host);
  if (!h) return null;
  const tlds = load();
  const labels = h.split(".");
  if (!tlds.has(labels[labels.length - 1])) return null;
  let size = 1;
  for (const k of [3, 2]) {
    if (labels.length >= k && SUFFIXES.has(labels.slice(-k).join("."))) { size = k; break; }
  }
  if (labels.length <= size) return null;
  return labels.slice(-(size + 1)).join(".");
}

export const {
  providerFor, looksLikeBrandImpersonation, checkAllowlisted, checkUntrusted, isRedirector, checkTrustedSource, unwrapAffiliate, processorLabel,
} = createAllowlist(PROVIDERS, registrableDomain);
