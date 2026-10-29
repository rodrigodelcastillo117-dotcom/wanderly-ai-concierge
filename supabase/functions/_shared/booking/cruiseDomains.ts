// Navieras con sitio oficial (dominio registrable, nombre) y buscadores de cruceros. Módulo chico: lo usa
// la app (src/lib/cruiseLinks.ts) sin cargar allowlist.ts (lista completa con notas internas + la lista
// de sufijos públicos, ~160 KB en el paquete del navegador; auditoría técnica 10/10). allowlist.ts lo
// re-exporta y sigue siendo la lista blanca del servidor (booking-go).
/** Navieras con sitio oficial (dominio registrable, nombre). */
export const CRUISE_DOMAINS: Array<[string, string]> = [
  ["msccruises.com", "MSC Cruceros"], ["royalcaribbean.com", "Royal Caribbean"], ["celebritycruises.com", "Celebrity Cruises"],
  ["ncl.com", "Norwegian Cruise Line"], ["silversea.com", "Silversea"], ["seabourn.com", "Seabourn"], ["rssc.com", "Regent Seven Seas"],
  ["oceaniacruises.com", "Oceania Cruises"], ["vikingcruises.com", "Viking"], ["explorajourneys.com", "Explora Journeys"],
  ["aroya.com", "AROYA Cruises"], ["costacruises.com", "Costa Cruceros"], ["princess.com", "Princess Cruises"],
  ["hollandamerica.com", "Holland America Line"], ["cunard.com", "Cunard"], ["ponant.com", "PONANT"], ["crystalcruises.com", "Crystal"],
  ["celestyal.com", "Celestyal"], ["disneycruise.disney.go.com", "Disney Cruise Line"], ["carnival.com", "Carnival"],
];

/** Buscadores de cruceros que la app enlaza (también están en la lista blanca del servidor). */
export const CRUISE_SEARCH_DOMAINS = ["cruisecritic.com", "vacationstogo.com"] as const;

/**
 * ¿Es un enlace https a una naviera o buscador de esta lista? Más estricto que la lista blanca del
 * servidor (solo estos dominios, sin credenciales, sin puerto, sin IP); booking-go vuelve a revisar al salir.
 */
export function isCruiseLinkAllowed(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length > 2048 || /[\s\\]/.test(raw)) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  const domains = [...CRUISE_DOMAINS.map(([d]) => d), ...CRUISE_SEARCH_DOMAINS];
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
