// Diagnóstico de Google Maps Platform: qué APIs responden con la llave del servidor. Sin
// dependencias de Deno (se prueba con Vitest con fetch simulado). Lo corre health-check con
// ?action=google_apis (misma protección: secreto de cron o llave de servicio). Nunca devuelve la
// llave ni URLs: solo el estado de cada API, el código HTTP y el mensaje de Google ya limpio.
//
// Cada prueba usa el SKU más barato posible (la primera es gratis: Text Search "IDs Only"):
// una corrida completa cuesta menos de USD 0.05 a precio de lista y cae en la franja gratis.
import { type GoogleErrorKind, type GoogleTransport, googleJson, timeZoneAt } from "../_shared/google-maps.ts";
import { computeRoute, computeRouteMatrix } from "../_shared/google-routes.ts";
import { searchText } from "../_shared/google-places.ts";

export type ApiStatus = "enabled" | "disabled" | "quota" | "denied" | "error";

export type ProbeResult = { api: string; status: ApiStatus; http: number | null; detail: string | null; ms: number };

const statusOf = (kind: GoogleErrorKind): ApiStatus =>
  kind === "disabled" ? "disabled" : kind === "quota" ? "quota" : kind === "denied" ? "denied" : "error";

/** Punto fijo de prueba: Zócalo de la Ciudad de México. */
const ZOCALO = { lat: 19.4326, lng: -99.1332 };
const BELLAS_ARTES = { lat: 19.4352, lng: -99.1412 };

async function timed(api: string, fn: () => Promise<{ ok: true } | { ok: false; kind: GoogleErrorKind; http: number; message: string }>): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    if (r.ok) return { api, status: "enabled", http: 200, detail: null, ms: Date.now() - t0 };
    // Un "no encontrado" o petición inválida significa que la API sí respondió.
    if (r.kind === "not_found" || r.kind === "invalid_request") return { api, status: "enabled", http: r.http, detail: r.message, ms: Date.now() - t0 };
    return { api, status: statusOf(r.kind), http: r.http || null, detail: r.message, ms: Date.now() - t0 };
  } catch (e) {
    return { api, status: "error", http: null, detail: String((e as Error)?.name ?? "error"), ms: Date.now() - t0 };
  }
}

export async function probeGoogleApis(t: GoogleTransport | null): Promise<{ ok: boolean; mode: string | null; results: ProbeResult[] }> {
  if (!t) {
    return { ok: false, mode: null, results: [{ api: "Configuración", status: "error", http: null, detail: "Falta GOOGLE_MAPS_API_KEY", ms: 0 }] };
  }
  let photoName: string | null = null;
  let placeId: string | null = null;
  const fail = (e: { kind: GoogleErrorKind; status: number; message: string }) => ({ ok: false as const, kind: e.kind, http: e.status, message: e.message });

  const results: ProbeResult[] = [];
  results.push(await timed("Places API (New) · Text Search", async () => {
    const r = await searchText(t, { query: "Zócalo Ciudad de México", preset: "ids", maxResults: 1, dropClosed: false });
    if (!r.ok) return fail(r.error);
    placeId = r.places[0]?.place_id ?? null;
    return { ok: true };
  }));
  results.push(await timed("Places API (New) · Place Details", async () => {
    if (!placeId) return { ok: false, kind: "error", http: 0, message: "sin place_id de la prueba anterior" };
    const r = await googleJson<{ photos?: Array<{ name?: string }> }>(t, "places", "Place Details Essentials",
      `/v1/places/${encodeURIComponent(placeId)}`, { method: "GET", fieldMask: "id,photos" });
    if (!r.ok) return fail(r.error);
    photoName = r.data?.photos?.[0]?.name ?? null;
    return { ok: true };
  }));
  results.push(await timed("Places API (New) · Place Photos", async () => {
    if (!photoName) return { ok: false, kind: "error", http: 0, message: "el lugar de prueba no trajo fotos" };
    const r = await googleJson(t, "places", "Place Details Photos", `/v1/${photoName}/media`, {
      method: "GET", query: new URLSearchParams({ maxWidthPx: "100", skipHttpRedirect: "true" }),
    });
    return r.ok ? { ok: true } : fail(r.error);
  }));
  results.push(await timed("Routes API · computeRoutes", async () => {
    const r = await computeRoute(t, { origin: ZOCALO, destination: BELLAS_ARTES, mode: "WALK" });
    return r.ok ? { ok: true } : fail(r.error);
  }));
  results.push(await timed("Routes API · computeRouteMatrix", async () => {
    const r = await computeRouteMatrix(t, { origins: [ZOCALO], destinations: [BELLAS_ARTES], mode: "WALK" });
    return r.ok ? { ok: true } : fail(r.error);
  }));
  results.push(await timed("Geocoding API", async () => {
    const r = await googleJson(t, "geocoding", "Geocoding", "/maps/api/geocode/json", {
      method: "GET", query: new URLSearchParams({ address: "Zócalo, Ciudad de México", language: "es" }),
    });
    return r.ok ? { ok: true } : fail(r.error);
  }));
  results.push(await timed("Time Zone API", async () => {
    const r = await timeZoneAt(t, ZOCALO.lat, ZOCALO.lng);
    return r.ok ? { ok: true } : fail(r.error);
  }));
  return { ok: results.every((r) => r.status === "enabled"), mode: t.mode, results };
}
