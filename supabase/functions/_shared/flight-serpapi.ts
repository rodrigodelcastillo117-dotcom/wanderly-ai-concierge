// Normalize only the requested day's structured Google flight widget; never infer status from search snippets.
import { redactSecrets } from "./redact.ts";

type Json = Record<string, any>;

const present = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim() || /^(?:-|—|n\/a|unknown)$/i.test(value.trim())) return undefined;
  return value.trim();
};

const localTime = (value: unknown) => {
  const text = present(value);
  return text?.match(/T(\d{2}:\d{2})/)?.[1] ?? text;
};

/** Instante absoluto solo si el proveedor manda fecha, hora y zona (ej. 2026-10-22T21:40:00-06:00). */
const instant = (value: unknown): string | undefined => {
  const text = present(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

const earliest = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : a ?? b);

const widgetDays = (widget: Json): Json[] => Array.isArray(widget.dates)
  ? widget.dates
  : Object.entries(widget.dates ?? {}).map(([date, value]) => ({ ...(value as Json), date }));

export function normalizeFlightWidget(widget: Json | undefined, date: string) {
  if (!widget) return null;
  const day = widgetDays(widget).find((entry: Json) => entry.date === date);
  if (!day) return null;
  const metadata = day.metadata ?? {};
  const departure = day.departure_airport ?? {};
  const arrival = day.arrival_airport ?? {};
  const rawStatus = present(metadata.status) ?? present(departure.status) ?? "";
  const code = rawStatus.toUpperCase();
  const delay = typeof metadata.departure_delay === "number" && Number.isFinite(metadata.departure_delay)
    ? Math.max(0, metadata.departure_delay) : undefined;
  let status = "desconocido";
  if (/CANCEL/.test(code)) status = "cancelado";
  else if (/ARRIV|LANDED/.test(code)) status = "aterrizado";
  else if (/DEPART|AIRBORNE|EN.?ROUTE|IN.?AIR/.test(code)) status = "en vuelo";
  else if (/BOARD/.test(code)) status = "abordando";
  else if (/DELAY/.test(code) || (delay ?? 0) > 0) status = "retrasado";
  else if (/SCHEDULED|ON.?TIME/.test(code)) status = "a tiempo";
  if (status === "desconocido" && !present(departure.scheduled_time) && !present(departure.time)) return null;
  return {
    status, scheduled_departure: localTime(departure.scheduled_time),
    estimated_departure: localTime(departure.time),
    gate: present(departure.gate), terminal: present(departure.terminal),
    origin: present(metadata.origin) ?? present(departure.id),
    destination: present(metadata.destination) ?? present(arrival.id),
    delay_minutes: delay, provider_status: rawStatus,
    scheduled_arrival: localTime(arrival.scheduled_time), estimated_arrival: localTime(arrival.time),
    arrival_delay_minutes: typeof metadata.arrival_delay === "number" ? Math.max(0, metadata.arrival_delay) : undefined,
    // Instantes absolutos (solo si el proveedor trae la zona horaria): para revisar seguido solo
    // cerca de la salida y dejar de vigilar cuando ya llegó. Salida = la más temprana entre
    // programada y estimada, para no empezar tarde si el retraso se corrige.
    departure_at: earliest(instant(departure.scheduled_time), instant(departure.time)),
    arrival_at: instant(arrival.time) ?? instant(arrival.scheduled_time),
  };
}

export type FlightData = NonNullable<ReturnType<typeof normalizeFlightWidget>>;

/**
 * Resultado de una consulta, sin mezclar "no hubo respuesta" con "todo sigue igual":
 * - ok: el widget trae el día pedido.
 * - no_data: Google no mostró el widget del vuelo.
 * - date_mismatch: hay widget, pero de otro día (nunca se usa).
 * - quota / provider_error: SerpApi falló; `message` ya viene sin llaves.
 */
export type FlightOutcome =
  // fetchedAt: cuándo se consultó de verdad (si salió de la caché compartida de 10 min, esa hora).
  | { kind: "ok"; data: FlightData; fetchedAt?: string }
  | { kind: "no_data" }
  | { kind: "date_mismatch" }
  | { kind: "quota" | "provider_error"; message: string };

export function classifyFlightWidget(widget: Json | undefined, date: string): FlightOutcome {
  if (!widget) return { kind: "no_data" };
  const days = widgetDays(widget);
  if (days.length > 0 && !days.some((d) => d?.date === date)) return { kind: "date_mismatch" };
  const data = normalizeFlightWidget(widget, date);
  return data ? { kind: "ok", data } : { kind: "no_data" };
}

const QUOTA_RE = /run out of searches|searches? (?:left|limit)|plan.*(?:limit|exceeded)|quota|rate limit/i;

export async function fetchFlightStatus(
  key: string, flight: string, date: string, route?: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<FlightOutcome> {
  const params = new URLSearchParams({ engine: "google", api_key: key, hl: "en", gl: "us",
    q: `${flight} flight status ${date}${route ? ` ${route}` : ""}` });
  const doFetch = opts.fetch ?? fetch;
  let response: Response;
  let result: Json;
  try {
    response = await doFetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 20000) });
    result = await response.json().catch(() => ({}));
  } catch (e) {
    const name = (e as Error)?.name;
    // Never keep the request URL (it contains the private key).
    const message = name === "TimeoutError" || name === "AbortError" ? "timeout" : redactSecrets((e as Error)?.message) ?? "network_error";
    return { kind: "provider_error", message };
  }
  const providerError = typeof result?.error === "string" ? result.error : "";
  if (!response.ok || providerError) {
    const message = redactSecrets(providerError || `HTTP ${response.status}`) ?? `HTTP ${response.status}`;
    const quota = response.status === 429 || QUOTA_RE.test(providerError);
    return { kind: quota ? "quota" : "provider_error", message };
  }
  const outcome = classifyFlightWidget(result.flight_result, date);
  const fetchedAt = response.headers?.get?.("x-iatos-fetched-at");
  return outcome.kind === "ok" && fetchedAt ? { ...outcome, fetchedAt } : outcome;
}

export async function querySerpApi(key: string, flight: string, date: string, route?: string, opts: { fetch?: typeof fetch } = {}) {
  const outcome = await fetchFlightStatus(key, flight, date, route, opts);
  // Never log the request URL (it contains the private key).
  if (outcome.kind === "quota" || outcome.kind === "provider_error") throw new Error("serpapi_unavailable");
  if (outcome.kind !== "ok") return null;
  const source = `https://www.google.com/search?q=${encodeURIComponent(`${flight} flight status ${date}`)}`;
  return { data: { ...outcome.data, source, fuente: "serpapi", source_name: "Google flight widget (SerpApi)",
    retrieved_at: outcome.fetchedAt ?? new Date().toISOString() }, citations: [source], raw: "", provider: "serpapi" };
}
