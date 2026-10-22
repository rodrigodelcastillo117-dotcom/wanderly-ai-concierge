// Formato de los correos de IATOS (español de México). Funciones puras, sin Deno, probadas en
// src/test/emailSystem.test.ts.
//
// Reglas: el dinero siempre lleva el código de moneda ("$13,380 MXN"), las fechas se escriben como
// las lee una persona ("20 de mar. de 2027", nunca "2027-03-20") y las horas en el centro de México
// con "h" ("14:05 h"). Una fecha ISO sin hora ("2027-03-20") se lee como fecha de calendario, sin
// zona horaria, para que no se recorra un día.

/** Escapa texto antes de meterlo en HTML (también comillas: sirve dentro de atributos). */
export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Una línea de texto: sin caracteres de control ni saltos, recortada. */
export function oneLine(v: unknown, max: number): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export const CDMX_TZ = "America/Mexico_City";
const MONTHS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."];

const SYMBOL: Record<string, string> = { MXN: "$", USD: "US$", CAD: "C$", EUR: "€", GBP: "£", JPY: "¥" };

/** "$13,380 MXN". Sin decimales salvo montos menores a 100 con centavos. Null si no es número. */
export function formatMoney(amount: unknown, currency = "MXN"): string | null {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === "" || !Number.isFinite(n)) return null;
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "MXN";
  const digits = Math.abs(n) < 100 && Math.round(n) !== n ? 2 : 0;
  const body = new Intl.NumberFormat("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(n));
  return `${n < 0 ? "−" : ""}${SYMBOL[code] ?? ""}${body} ${code}`;
}

/** Solo el número con símbolo ("$154,840"), para cifras grandes donde el código va aparte. */
export function formatAmount(amount: number, currency = "MXN"): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "MXN";
  return `${SYMBOL[code] ?? ""}${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(Math.round(amount))}`;
}

type Ymd = { y: number; m: number; d: number };

/** Lee "2027-03-20" (o un ISO con hora: toma su fecha en CDMX). Null si no es una fecha válida. */
export function parseCalendarDate(v: unknown): Ymd | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? ymdInCdmx(v) : null;
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  const t = new Date(s);
  return Number.isFinite(t.getTime()) ? ymdInCdmx(t) : null;
}

function ymdInCdmx(t: Date): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CDMX_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "20 de mar. de 2027". Null si no hay fecha válida. */
export function formatDateMx(v: unknown, opts: { year?: boolean } = {}): string | null {
  const p = parseCalendarDate(v);
  if (!p) return null;
  return `${p.d} de ${MONTHS[p.m - 1]}${opts.year === false ? "" : ` de ${p.y}`}`;
}

/** "20 – 25 de mar. de 2027" · "28 de mar. – 2 de abr. de 2027" · "30 de dic. de 2026 – 3 de ene. de 2027". */
export function formatDateRange(from: unknown, to: unknown): string | null {
  const a = parseCalendarDate(from), b = parseCalendarDate(to);
  if (!a && !b) return null;
  if (!a || !b) return formatDateMx(a ? from : to);
  if (a.y === b.y && a.m === b.m) return a.d === b.d ? formatDateMx(from) : `${a.d} – ${b.d} de ${MONTHS[a.m - 1]} de ${a.y}`;
  if (a.y === b.y) return `${a.d} de ${MONTHS[a.m - 1]} – ${b.d} de ${MONTHS[b.m - 1]} de ${a.y}`;
  return `${formatDateMx(from)} – ${formatDateMx(to)}`;
}

/** Noches entre dos fechas de calendario (0 si faltan o están al revés). */
export function nightsBetween(from: unknown, to: unknown): number {
  const a = parseCalendarDate(from), b = parseCalendarDate(to);
  if (!a || !b) return 0;
  const diff = (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000;
  return diff > 0 ? Math.round(diff) : 0;
}

const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t : null;
};

/** "14:05 h" en la zona indicada (CDMX por defecto). */
export function formatTime(v: unknown, timeZone = CDMX_TZ): string | null {
  const t = toDate(v);
  if (!t) return null;
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
    return `${s} h`;
  } catch {
    return null;
  }
}

/** "22 de oct. de 2026, 14:05 h" en la zona indicada (CDMX por defecto). */
export function formatDateTime(v: unknown, timeZone = CDMX_TZ): string | null {
  const t = toDate(v);
  if (!t) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
    const get = (k: string) => parts.find((p) => p.type === k)?.value;
    return `${formatDateMx(`${get("year")}-${get("month")}-${get("day")}`)}, ${formatTime(t, timeZone)}`;
  } catch {
    return null;
  }
}

/** "hace 3 min" · "hace 2 h" · "hace 3 días" · "justo ahora". Null si la fecha no sirve o es futura. */
export function relativeFrom(v: unknown, now: Date = new Date()): string | null {
  const t = toDate(v);
  if (!t) return null;
  const s = Math.round((now.getTime() - t.getTime()) / 1000);
  if (s < -60) return null;
  if (s < 60) return "justo ahora";
  const min = Math.round(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** "1 viajero" / "2 viajeros". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Nombre legible de la fuente de un precio. Lo desconocido se trata como estimación de IATOS. */
export function sourceLabel(source: unknown, category?: string): string {
  const s = String(source ?? "").toLowerCase();
  if (s === "serpapi" || s === "google_flights" || s === "google_hotels") {
    if (category === "hospedaje" || s === "google_hotels") return "Google Hotels";
    if (category === "vuelos" || s === "google_flights") return "Google Flights";
    return "Google";
  }
  if (s === "travelpayouts" || s === "aviasales") return "Aviasales";
  if (s === "tripadvisor") return "Tripadvisor";
  if (s === "google_maps") return "Google Maps";
  if (s === "perplexity") return "búsqueda web";
  return "cálculo de IATOS";
}

/** Primer nombre presentable (máx. 40 caracteres) o null. El escape se hace al pintarlo. */
export function firstNameOf(name: unknown): string | null {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  // deno-lint-ignore no-control-regex
  const clean = first.replace(/[\u0000-\u001f\u007f<>"]/g, "").slice(0, 40);
  return clean ? clean.charAt(0).toLocaleUpperCase("es-MX") + clean.slice(1) : null;
}

/** Solo https (o http://localhost para pruebas). Lo demás → null (nunca javascript:, data:, etc.). */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.toString();
  } catch {
    // no es URL
  }
  return null;
}

/** Recorta en el último espacio antes de `max` y agrega "…" (para titulares). */
export function clipWords(v: unknown, max: number): string {
  const t = oneLine(v, 10_000);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}
