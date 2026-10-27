// Lógica de tripadvisor-search sin Deno (se prueba con Vitest): decide si se consulta Tripadvisor
// Terra, cuánto se puede gastar y cuándo se cae al respaldo de Google. index.ts solo conecta la base,
// el registro de uso y Google Places.
import {
  parsePhotos, parseSearch, pauseSecondsFor, photosUrl, reserveEntities, searchEntities, searchUrl,
  type HitFn, type TerraConfig, terraErrorDetail, terraGet, terraLocale, terraUsage, userAllowed,
} from "../_shared/tripadvisor-terra.ts";

export type SearchBody = {
  query?: string;
  category?: "hotels" | "attractions" | "restaurants" | "geos";
  language?: string;
  /**
   * "pantalla" = una persona tocó "Buscar" o abrió un lugar en la app. Solo así se consulta Terra:
   * los términos de Tripadvisor prohíben usar su contenido con IA (análisis, concierge, logística),
   * y así ninguna llamada automática gasta entidades. Sin este campo → directo a Google.
   */
  uso?: string;
  /** "fotos": fotos de UN lugar ya mostrado (location_id), 1 entidad. */
  action?: string;
  location_id?: string | number;
};

export type Out = { status: number; body: Record<string, unknown> };

export type CoreDeps = {
  fetchImpl: typeof fetch;
  apiKey?: string | null;
  userId: string;
  config: TerraConfig;
  hit: HitFn;
  logUsage: (row: ReturnType<typeof terraUsage>) => Promise<void> | void;
  /** ¿Hay pausa vigente tras un 401/402/403/429? */
  paused: () => Promise<boolean>;
  pause: (seconds: number, status: number | null) => Promise<void>;
  /** Respaldo de Google (Places y, como último recurso, SerpApi). Nunca recibe la llave. */
  fallback: (reason: string, status: number, detail: unknown) => Promise<Out>;
  now?: () => number;
  log?: (...a: unknown[]) => void;
};

const fromScreen = (b: SearchBody) => b?.uso === "pantalla";

export async function handleSearch(body: SearchBody, d: CoreDeps): Promise<Out> {
  const log = d.log ?? ((...a: unknown[]) => console.warn(...a));
  if (body?.action === "fotos") return handlePhotos(body, d);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) return { status: 400, body: { error: "query requerido" } };

  if (!fromScreen(body)) return d.fallback("solo_pantallas", 503, null);
  if (body.category === "geos") return d.fallback("geos_sin_tripadvisor", 503, null);
  if (!d.apiKey) return d.fallback("TRIPADVISOR_API_KEY no configurada", 500, null);
  if (await d.paused().catch(() => false)) return d.fallback("tripadvisor_en_pausa", 503, null);
  if (!(await userAllowed(d.hit, d.userId, d.config.userDailyCalls))) return d.fallback("tope_por_persona", 429, null);
  const size = await reserveEntities(d.hit, d.config.searchSize, d.config.dailyEntities);
  if (size === 0) return d.fallback("tope_diario", 429, null);

  const locale = terraLocale(body.language);
  const r = await terraGet(d.fetchImpl, searchUrl({ query, category: body.category, locale, size }), d.apiKey);
  if (!r.ok) {
    const detail = terraErrorDetail(r, d.apiKey);
    log("tripadvisor-search: Terra", r.status, detail);
    const p = pauseSecondsFor(r.status);
    if (p) await d.pause(p, r.status).catch(() => undefined);
    return d.fallback("TripAdvisor error", r.status ?? 502, { http: r.status, detail });
  }
  // Una entidad por location ID devuelto (lo que Tripadvisor cobra); 0 resultados = 0 entidades.
  const entidades = searchEntities(r.json);
  if (entidades > 0) await d.logUsage(terraUsage(d.userId, "locations/search", entidades));
  const results = parseSearch(r.json, locale, body.category ?? null);
  if (!results.length) {
    // Vacío casi siempre es la allowlist de la cuenta (la búsqueda solo ve lugares permitidos).
    return d.fallback("sin_resultados_tripadvisor", 404, { http: r.status, detail: "Sin lugares en la allowlist de Tripadvisor para esta búsqueda" });
  }
  return {
    status: 200,
    body: {
      ok: true,
      source: "tripadvisor",
      atribucion: "Tripadvisor",
      consulted_at: new Date((d.now ?? Date.now)()).toISOString(),
      entidades,
      results,
    },
  };
}

/** Fotos de UN lugar que la persona abrió: una llamada = 1 entidad (sin importar cuántas fotos). */
export async function handlePhotos(body: SearchBody, d: CoreDeps): Promise<Out> {
  const log = d.log ?? ((...a: unknown[]) => console.warn(...a));
  const id = String(body?.location_id ?? "").replace(/\D/g, "");
  if (!id) return { status: 400, body: { error: "location_id requerido" } };
  if (!fromScreen(body)) return { status: 400, body: { error: "solo_pantallas" } };
  const none = (motivo: string, extra: Record<string, unknown> = {}): Out => ({ status: 200, body: { ok: false, source: "tripadvisor", motivo, photos: [], ...extra } });
  if (!d.apiKey) return none("sin_llave");
  if (await d.paused().catch(() => false)) return none("tripadvisor_en_pausa");
  if (!(await userAllowed(d.hit, d.userId, d.config.userDailyCalls))) return none("tope_por_persona");
  if ((await reserveEntities(d.hit, 1, d.config.dailyEntities)) === 0) return none("tope_diario");

  const r = await terraGet(d.fetchImpl, photosUrl({ locationId: id, locale: terraLocale(body.language), size: d.config.photosSize }), d.apiKey);
  if (!r.ok) {
    const detail = terraErrorDetail(r, d.apiKey);
    log("tripadvisor-search: Terra fotos", r.status, detail);
    const p = pauseSecondsFor(r.status);
    if (p) await d.pause(p, r.status).catch(() => undefined);
    return none("TripAdvisor error", { http: r.status, detail });
  }
  await d.logUsage(terraUsage(d.userId, "locations/photos", 1));
  return { status: 200, body: { ok: true, source: "tripadvisor", entidades: 1, photos: parsePhotos(r.json, d.config.photosSize) } };
}
