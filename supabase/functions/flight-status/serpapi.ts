// Normalize only the requested day's structured Google flight widget; never infer status from search snippets.
type Json = Record<string, any>;

const present = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value.trim() || /^(?:-|—|n\/a|unknown)$/i.test(value.trim())) return undefined;
  return value.trim();
};

const localTime = (value: unknown) => {
  const text = present(value);
  return text?.match(/T(\d{2}:\d{2})/)?.[1] ?? text;
};

export function normalizeFlightWidget(widget: Json | undefined, date: string) {
  if (!widget) return null;
  const days = Array.isArray(widget.dates)
    ? widget.dates
    : Object.entries(widget.dates ?? {}).map(([date, value]) => ({ ...(value as Json), date }));
  const day = days.find((entry: Json) => entry.date === date);
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
  };
}

export async function querySerpApi(key: string, flight: string, date: string, route?: string) {
  const params = new URLSearchParams({ engine: "google", api_key: key, hl: "en", gl: "us",
    q: `${flight} flight status ${date}${route ? ` ${route}` : ""}` });
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  // Never log the request URL (it contains the private key).
  if (!response.ok || result.error) throw new Error("serpapi_unavailable");
  const data = normalizeFlightWidget(result.flight_result, date);
  if (!data) return null;
  const source = `https://www.google.com/search?q=${encodeURIComponent(`${flight} flight status ${date}`)}`;
  return { data: { ...data, source, fuente: "serpapi", source_name: "Google flight widget (SerpApi)",
    retrieved_at: new Date().toISOString() }, citations: [source], raw: "", provider: "serpapi" };
}