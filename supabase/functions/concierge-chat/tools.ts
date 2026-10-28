// Traduce los argumentos que la IA usa en cada herramienta a los que espera la función del
// servidor. Sin esto, search_flights mandaba `departure_date`/`adults` a flights-search (que lee
// `depart`/`travelers`): la búsqueda llegaba sin fecha, volvía vacía y la IA inventaba una excusa.
export interface ToolArgsContext {
  /** Hoy en la zona del usuario (B-16): default de check_flight_status. */
  todayISO?: string;
  /** Ubicación que mandó el cliente: se usa si el modelo no pasa coordenadas válidas. */
  coords?: { lat: number; lng: number } | null;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function toolArgs(name: string, args: Record<string, unknown>, ctx: ToolArgsContext = {}): Record<string, unknown> {
  if (name === "search_flights") {
    const ret = args.return_date || undefined;
    return {
      origin: args.origin,
      destination: args.destination,
      depart: args.departure_date ?? args.depart,
      return_date: ret,
      travelers: args.adults ?? args.travelers ?? 1,
      type: ret ? "round" : "oneway",
    };
  }
  if (name === "check_flight_status" && !args.date && ctx.todayISO) {
    // flight-status usa la fecha UTC por defecto: en CDMX después de las 18:00 consultaba mañana.
    return { ...args, date: ctx.todayISO };
  }
  if (name === "search_nearby") {
    // places-nearby exige números; el modelo a veces manda texto o nada.
    const lat = num(args.lat);
    const lng = num(args.lng);
    if (lat !== undefined && lng !== undefined) return { ...args, lat, lng };
    if (ctx.coords && Number.isFinite(ctx.coords.lat) && Number.isFinite(ctx.coords.lng)) {
      return { ...args, lat: ctx.coords.lat, lng: ctx.coords.lng };
    }
    return args;
  }
  return args;
}

/** Línea de contexto con la fecha de hoy, para que la IA no tome fechas pasadas por futuras. */
export function todayLine(todayISO: string, tz?: string | null): string {
  const d = new Date(`${todayISO}T12:00:00Z`);
  const larga = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const zona = tz ? ` Es la fecha local del usuario (zona ${tz}).` : "";
  return `FECHA DE HOY: ${larga} (${todayISO}).${zona} Toda fecha anterior ya pasó. Las aerolíneas venden vuelos hasta ~11 meses adelante: si el usuario pide fechas dentro de ese rango, busca y muestra los resultados; si una búsqueda no trae resultados, dilo tal cual, sin inventar el motivo.`;
}

const MAX_STRING = 400;

/**
 * Reduce el resultado de una herramienta para que quepa en el contexto sin romper el JSON.
 * Antes se cortaba el texto a 6000 caracteres y se volvía a parsear: con más de ~8 vuelos el
 * JSON quedaba inválido y la IA recibía un error en lugar de los resultados. Ahora se recortan
 * textos largos y, si aún no cabe, se quitan elementos del final de la lista más larga.
 */
export const PLACE_LIST_MAX_CHARS = 9000;

export function slimToolResult(value: unknown, maxChars = 6000): unknown {
  const shorten = (v: unknown, key = ""): unknown => {
    // El nombre de la foto de Google (photo_ref) cortado ya no sirve: se queda entero (hasta 1200).
    if (typeof v === "string") return v.length > (key === "photo_ref" ? 1200 : MAX_STRING) ? `${v.slice(0, MAX_STRING)}…` : v;
    if (Array.isArray(v)) return v.map((x) => shorten(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x, k)]));
    return v;
  };
  const out = shorten(value);
  const size = () => JSON.stringify(out).length;

  // Antes de quitar resultados se adelgaza cada uno (auditoría 10 #3: tripadvisor-search devolvía 10
  // lugares de ~4 KB, casi todo `photo_refs`, y el tope dejaba 1 solo: "solo me devolvió un resultado").
  // 1) fuera las listas de fotos y reseñas (la card usa `photo_ref`, que se queda) y lo vacío;
  // 2) si aún no cabe, descripciones más cortas; 3) solo entonces se quitan resultados del final.
  if (size() > maxChars) lighten(out, 0);
  if (size() > maxChars) shortenDescriptions(out, 160);

  const longestArray = (v: unknown): unknown[] | null => {
    let best: unknown[] | null = null;
    const visit = (x: unknown) => {
      if (Array.isArray(x)) {
        if (x.length > 1 && (!best || JSON.stringify(x).length > JSON.stringify(best).length)) best = x;
        x.forEach(visit);
      } else if (x && typeof x === "object") Object.values(x).forEach(visit);
    };
    visit(v);
    return best;
  };

  let trimmed = false;
  while (size() > maxChars) {
    const arr = longestArray(out);
    if (!arr) break;
    arr.pop();
    trimmed = true;
  }
  if (size() > maxChars) return { error: "resultado demasiado grande", truncated: true };
  if (trimmed && out && typeof out === "object" && !Array.isArray(out)) (out as Record<string, unknown>).truncated = true;
  return out;
}

/** Llaves pesadas de cada resultado que el modelo no necesita para responder. */
const HEAVY_KEYS = new Set(["photo_refs", "photos", "images", "reviews", "user_reviews", "gallery", "thumbnails", "raw", "html_attributions"]);

function lighten(v: unknown, depth: number): void {
  if (Array.isArray(v)) { v.forEach((x) => lighten(x, depth + 1)); return; }
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const x = o[k];
    // Solo dentro de listas (los resultados), nunca el sobre de la respuesta.
    const inItem = depth >= 1;
    if (inItem && (HEAVY_KEYS.has(k) || x === null || x === "" || (Array.isArray(x) && x.length === 0))) { delete o[k]; continue; }
    // El mismo id dos veces (id y place_id).
    if (inItem && k === "id" && typeof o.place_id === "string" && o.place_id === x) { delete o[k]; continue; }
    lighten(x, depth + (Array.isArray(x) ? 0 : 1));
  }
}

function shortenDescriptions(v: unknown, max: number): void {
  if (Array.isArray(v)) { v.forEach((x) => shortenDescriptions(x, max)); return; }
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  for (const [k, x] of Object.entries(o)) {
    if (typeof x === "string" && /^(description|descripcion|editorial_summary|snippet|resumen)$/.test(k) && x.length > max) o[k] = `${x.slice(0, max)}…`;
    else shortenDescriptions(x, max);
  }
}

export const TOOL_TIMEOUT_MS = 15_000;

/** Resuelve con el valor de la promesa o con {error:"timeout"} si tarda más de `ms` (B-15). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | { error: "timeout" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ error: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ error: "timeout" }), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

export interface ToolCall { id: string; type?: string; function: { name: string; arguments?: string } }

export const parseToolArgs = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw ?? "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/**
 * Ejecuta en paralelo las herramientas que el modelo pidió en un mismo turno, cada una con su
 * límite de tiempo. Antes iban en serie y sin límite: 3 búsquedas podían sumar más de un minuto.
 * Una herramienta que truena o se pasa de tiempo devuelve un error honesto, no detiene a las demás.
 */
export async function runToolCalls(
  calls: ToolCall[],
  exec: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  timeoutMs = TOOL_TIMEOUT_MS,
): Promise<{ id: string; name: string; args: Record<string, unknown>; result: unknown }[]> {
  return Promise.all(calls.map(async (tc) => {
    const name = tc.function?.name ?? "";
    const args = parseToolArgs(tc.function?.arguments);
    let result: unknown;
    try {
      result = await withTimeout(exec(name, args), timeoutMs);
    } catch (e) {
      result = { error: (e as Error)?.message ?? "tool error" };
    }
    return { id: tc.id, name, args, result };
  }));
}

/** Ejecutor de tools que traduce argumentos (toolArgs) antes de llamar a la función real. */
export const makeToolExecutor = (
  call: (name: string, mappedArgs: Record<string, unknown>) => Promise<unknown>,
  ctx: ToolArgsContext = {},
) => (name: string, args: Record<string, unknown>) => call(name, toolArgs(name, args ?? {}, ctx));
