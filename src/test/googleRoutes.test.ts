// Routes API: SKU según lo que se pide, tiempos reales, matriz y respaldo ESTIMADO; trayecto corto
// de analizar-viaje con la distancia real de manejo; diagnóstico de APIs de health-check.
// Sin llamadas reales (fetch simulado + fixtures con el formato documentado).
import { describe, it, expect, vi } from "vitest";
import route from "./fixtures/googlemax/routes_compute_routes.json";
import matrix from "./fixtures/googlemax/routes_matrix.json";
import errors from "./fixtures/googlemax/google_errors.json";
import { createGoogleTransport, GATEWAY_BASE } from "../../supabase/functions/_shared/google-maps";
import {
  computeRoute, computeRouteMatrix, estimatedLeg, parseDuration, routeBody, routeSku, travelTime,
} from "../../supabase/functions/_shared/google-routes";
import { detectShortTrip, refineShortTrip, shortTripPromptBlock, SHORT_TRIP_CANDIDATE_KM } from "../../supabase/functions/analizar-viaje/groundTransport";
import { probeGoogleApis } from "../../supabase/functions/health-check/googleProbe";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const CDMX = { lat: 19.4326, lng: -99.1332 };
const PUEBLA = { lat: 19.0414, lng: -98.2063 };

function gateway(responder: (url: string, init: RequestInit) => Response) {
  const f = vi.fn(async (url: string, init: RequestInit) => responder(url, init));
  return { t: createGoogleTransport({ mapsKey: "AIzaSECRETO000000000000000", lovableKey: "L", fetch: f as unknown as typeof fetch })!, f };
}

describe("Routes API", () => {
  it("por defecto manejo SIN tráfico (Essentials); con tráfico solo si se pide (Pro)", () => {
    expect(routeBody({ origin: CDMX, destination: PUEBLA })).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" });
    expect(routeSku("DRIVE", false)).toBe("Compute Routes Essentials");
    expect(routeBody({ origin: CDMX, destination: PUEBLA, trafficAware: true, departureTime: "2026-11-01T10:00:00Z" }))
      .toMatchObject({ routingPreference: "TRAFFIC_AWARE", departureTime: "2026-11-01T10:00:00Z" });
    expect(routeSku("DRIVE", true)).toBe("Compute Routes Pro");
    const transit = routeBody({ origin: { address: "Zócalo" }, destination: { placeId: "places/ChIJabc" }, mode: "TRANSIT" })!;
    expect(transit.routingPreference).toBeUndefined();
    expect(transit.destination).toEqual({ placeId: "ChIJabc" });
    expect(routeBody({ origin: { address: " " } as any, destination: CDMX })).toBeNull();
    expect(parseDuration("8280s")).toBe(8280);
    expect(parseDuration("x")).toBeNull();
  });

  it("computeRoute: tiempo y distancia reales con fecha de consulta y máscara mínima", async () => {
    const { t, f } = gateway(() => json(route));
    const r = await computeRoute(t, { origin: { address: "Ciudad de México" }, destination: { address: "Puebla" } }, { now: () => Date.parse("2026-10-22T12:00:00Z") });
    expect(r).toMatchObject({
      ok: true, duration_seconds: 8280, duration_text: "2 h 18 min", distance_meters: 134500, distance_text: "135 km",
      fuente: "google_routes", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "2026-10-22T12:00:00.000Z", con_trafico: false,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY_BASE}/routes/directions/v2:computeRoutes`);
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("routes.duration,routes.staticDuration,routes.distanceMeters");
  });

  it("sin ruta o con API deshabilitada: error explícito; travelTime cae a ESTIMADO solo con coordenadas", async () => {
    const { t } = gateway(() => json({}));
    expect(await computeRoute(t, { origin: CDMX, destination: PUEBLA })).toMatchObject({ ok: false, error: { kind: "not_found" } });
    const { t: off } = gateway(() => json(errors.disabled, 403));
    const est = await travelTime(off, { origin: CDMX, destination: PUEBLA, mode: "DRIVE" });
    expect(est).toMatchObject({ ok: true, fuente: "estimado_linea_recta", estado_dato: "ESTIMADO", consultado_at: null });
    if (est.ok) expect(est.duration_text.startsWith("~")).toBe(true);
    const none = await travelTime(off, { origin: { address: "A" }, destination: { address: "B" } });
    expect(none).toMatchObject({ ok: false, error: { kind: "disabled" } });
    expect(await travelTime(null, { origin: { address: "A" }, destination: { address: "B" } })).toMatchObject({ ok: false });
    expect(estimatedLeg(null, PUEBLA)).toBeNull();
  });

  it("matriz: ordena elementos, marca los sin ruta y respeta el límite por petición", async () => {
    const { t, f } = gateway(() => json(matrix));
    const r = await computeRouteMatrix(t, { origins: [CDMX], destinations: [CDMX, PUEBLA, { address: "x" }], mode: "WALK" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.billed_elements).toBe(3);
    expect(r.sku).toBe("Compute Route Matrix Essentials");
    expect(r.elements.map((e) => [e.destination_index, e.ok, e.duration_seconds])).toEqual([[0, true, 660], [1, true, 1500], [2, false, null]]);
    expect(String(f.mock.calls[0][0])).toBe(`${GATEWAY_BASE}/routes/distanceMatrix/v2:computeRouteMatrix`);
    const many = Array.from({ length: 11 }, () => CDMX);
    expect(await computeRouteMatrix(t, { origins: many, destinations: many, mode: "TRANSIT" })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  });
});

describe("analizar-viaje: trayecto corto con la ruta real de Google", () => {
  it("con Routes API manda la distancia real; sin ruta queda la aproximación etiquetada", () => {
    const cand = detectShortTrip("Ciudad de México", "Puebla", SHORT_TRIP_CANDIDATE_KM)!;
    const real = refineShortTrip(cand, { ok: true, duration_seconds: 8280, distance_meters: 134500, consultado_at: "2026-10-22T12:00:00Z" })!;
    expect(real).toMatchObject({ approxRoadKm: 135, approxDriveHours: 2.3, source: "google_routes", consultedAt: "2026-10-22T12:00:00Z" });
    expect(shortTripPromptBlock(real)).toMatch(/según Google Maps, sin tráfico/);
    const approx = refineShortTrip(cand, { ok: false })!;
    expect(approx.source).toBe("aproximado");
    expect(shortTripPromptBlock(approx)).toMatch(/cifras aproximadas/);
    // Por carretera de verdad son más de 350 km: no es trayecto corto aunque la línea recta diga que sí.
    expect(refineShortTrip(cand, { ok: true, duration_seconds: 20000, distance_meters: 420000 })).toBeNull();
    expect(refineShortTrip(null, { ok: true, duration_seconds: 1, distance_meters: 1 })).toBeNull();
  });

  it("un candidato entre 350 y 500 km sin ruta de Google no se vuelve trayecto corto", () => {
    const cand = detectShortTrip("Ciudad de México", "San Luis Potosí", SHORT_TRIP_CANDIDATE_KM);
    expect(cand).not.toBeNull();
    expect(cand!.approxRoadKm).toBeGreaterThan(350);
    expect(refineShortTrip(cand, null)).toBeNull();
  });
});

describe("health-check: diagnóstico de APIs de Google", () => {
  it("reporta por API habilitada / deshabilitada / cuota / llave, sin exponer la llave", async () => {
    const { t, f } = gateway((url) => {
      if (url.includes("searchText")) return json({ places: [{ id: "ChIJprobe00000000001" }] });
      if (url.includes("/places/ChIJprobe00000000001?") || url.endsWith("/places/ChIJprobe00000000001")) return json({ id: "ChIJprobe00000000001", photos: [{ name: "places/ChIJprobe00000000001/photos/F1" }] });
      if (url.includes("/media")) return json({ photoUri: "https://lh3.googleusercontent.com/x" });
      if (url.includes("computeRoutes")) return json(route);
      if (url.includes("computeRouteMatrix")) return json(errors.disabled, 403);
      if (url.includes("geocode")) return json(errors.legacy_over_limit);
      if (url.includes("timezone")) return json(errors.invalid_key, 400);
      return json({}, 500);
    });
    const r = await probeGoogleApis(t);
    const by = Object.fromEntries(r.results.map((x) => [x.api, x.status]));
    expect(by).toEqual({
      "Places API (New) · Text Search": "enabled",
      "Places API (New) · Place Details": "enabled",
      "Places API (New) · Place Photos": "enabled",
      "Routes API · computeRoutes": "enabled",
      "Routes API · computeRouteMatrix": "disabled",
      "Geocoding API": "quota",
      "Time Zone API": "denied",
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("gateway");
    expect(JSON.stringify(r)).not.toMatch(/AIza/);
    // La primera prueba usa el SKU gratis (IDs Only).
    expect((f.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers["X-Goog-FieldMask"]).toBe("places.id");
  });

  it("sin llave: lo dice en lugar de fallar", async () => {
    expect(await probeGoogleApis(null)).toMatchObject({ ok: false, results: [{ detail: "Falta GOOGLE_MAPS_API_KEY" }] });
  });
});
