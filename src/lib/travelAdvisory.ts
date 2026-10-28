// Cliente de la tarjeta "Antes de viajar" (función avisos-viaje). Tipos y resolución de país vienen del
// mismo módulo que usa el servidor (supabase/functions/_shared/travelAdvisories.ts), así cliente y
// servidor entienden igual "Tailandia", "TH" o "Bangkok".
//
// Sin costo por abrir la página varias veces: además de la caché del servidor (6 h), aquí se recuerda la
// respuesta por país en memoria y en sessionStorage (si el navegador lo permite) durante 6 h.
import { supabase } from "@/integrations/supabase/client";
import { resolveCountry, type AdvisoryOk, type AdvisoryResult, type PaisResuelto } from "../../supabase/functions/_shared/travelAdvisories.ts";

export type { AdvisoryFail, AdvisoryOk, AdvisoryResult, AvisoFuente, Falla, Nivel, PaisResuelto, Traduccion } from "../../supabase/functions/_shared/travelAdvisories.ts";
export { resolveCountry };

const TTL_MS = 6 * 3600 * 1000;
const MAX_COUNTRIES = 3;
const memo = new Map<string, { at: number; data: AdvisoryResult }>();
const inflight = new Map<string, Promise<AdvisoryResult>>();
const storageKey = (iso: string) => `iatos:avisos:${iso}`;

function readStored(iso: string, now: number): AdvisoryResult | null {
  const m = memo.get(iso);
  if (m && now - m.at < TTL_MS) return m.data;
  try {
    const raw = window.sessionStorage.getItem(storageKey(iso));
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; data?: AdvisoryResult };
    if (typeof v?.at === "number" && v.data && now - v.at < TTL_MS) {
      memo.set(iso, { at: v.at, data: v.data });
      return v.data;
    }
  } catch { /* sin almacenamiento: solo memoria */ }
  return null;
}

function store(iso: string, data: AdvisoryResult, now: number) {
  memo.set(iso, { at: now, data });
  try { window.sessionStorage.setItem(storageKey(iso), JSON.stringify({ at: now, data })); } catch { /* lleno o bloqueado */ }
}

/** Solo para pruebas. */
export function clearAdvisoryCache() {
  memo.clear();
  inflight.clear();
}

/** Avisos oficiales de un país (por ISO-2). Una sola petición aunque varias tarjetas la pidan a la vez. */
export async function fetchAdvisory(iso2: string, tripId?: string | null, now = Date.now()): Promise<AdvisoryResult> {
  const cached = readStored(iso2, now);
  if (cached) return cached;
  const pending = inflight.get(iso2);
  if (pending) return pending;
  const p = (async () => {
    const { data, error } = await supabase.functions.invoke("avisos-viaje", { body: { pais: iso2, ...(tripId ? { trip_id: tripId } : {}) } });
    if (error) throw error;
    const r = data as AdvisoryResult;
    if (!r || typeof r !== "object" || typeof (r as { ok?: unknown }).ok !== "boolean") throw new Error("respuesta inválida");
    // Si las dos fuentes fallaron no se recuerda: la próxima apertura vuelve a intentar.
    if (!r.ok || (r as AdvisoryOk).fuentes.length) store(iso2, r, now);
    return r;
  })().finally(() => inflight.delete(iso2));
  inflight.set(iso2, p);
  return p;
}

/**
 * Países extranjeros del viaje (máximo 3), en orden: país del viaje y luego cada destino. Un viaje
 * dentro de México no lleva la tarjeta (los avisos de otros gobiernos y la SRE son para el extranjero).
 */
export function tripCountries(trip: { pais_destino?: string | null; destino?: string | null } | null | undefined, destinations: string[] = []): PaisResuelto[] {
  const seen = new Set<string>();
  const out: PaisResuelto[] = [];
  const candidates = destinations.length ? [...destinations, trip?.pais_destino] : [trip?.pais_destino, trip?.destino];
  for (const c of candidates) {
    const p = resolveCountry(c);
    if (!p || p.iso2 === "MX" || seen.has(p.iso2)) continue;
    seen.add(p.iso2);
    out.push(p);
    if (out.length === MAX_COUNTRIES) break;
  }
  return out;
}

/** Gravedad 0–4 comparable entre fuentes (para el color de la insignia). */
export function severity(n: { valor: number | null; escala: "1-4" | "fcdo" }): number | null {
  if (n.valor == null) return null;
  if (n.escala === "1-4") return n.valor - 1; // 1→0 … 4→3
  return n.valor === 0 ? 0 : n.valor <= 2 ? 1 : n.valor === 3 ? 2 : 3;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-10-12T10:20:34+01:00" → "12 oct 2026" (la fecha que publicó la fuente, sin moverla de zona). */
export function fechaFuente(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}
