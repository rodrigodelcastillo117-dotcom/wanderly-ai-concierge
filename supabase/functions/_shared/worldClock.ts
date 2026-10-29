// Hora actual en cualquier ciudad, calculada por IATOS (auditoría 10, ronda 3, N-P1-6). A "¿qué hora es
// en Tokio?" Iato respondía "No tengo un reloj en vivo para Tokio": el modelo no recibía la hora actual
// de forma usable. Aquí todo es determinista: el reloj del servidor (UTC) + la zona IANA de la ciudad,
// con Intl (incluye horario de verano). Sin red, sin IA y sin Deno (lo prueba Vitest).

import { cityAirports } from "./airports.ts";
import { tzLabel, validTz } from "./localTime.ts";

/** Ciudad (o país con una sola zona) → zona IANA. Llaves sin acentos y en minúsculas. */
const CITY_TZ: Record<string, string> = {
  // México
  "ciudad de mexico": "America/Mexico_City", cdmx: "America/Mexico_City", "mexico city": "America/Mexico_City", df: "America/Mexico_City",
  guadalajara: "America/Mexico_City", monterrey: "America/Monterrey", puebla: "America/Mexico_City", queretaro: "America/Mexico_City",
  oaxaca: "America/Mexico_City", merida: "America/Merida", "valle de bravo": "America/Mexico_City", "san miguel de allende": "America/Mexico_City",
  cancun: "America/Cancun", tulum: "America/Cancun", "playa del carmen": "America/Cancun", cozumel: "America/Cancun",
  tijuana: "America/Tijuana", mexicali: "America/Tijuana", ensenada: "America/Tijuana", "los cabos": "America/Mazatlan",
  "cabo san lucas": "America/Mazatlan", "la paz": "America/Mazatlan", mazatlan: "America/Mazatlan", "puerto vallarta": "America/Mexico_City",
  hermosillo: "America/Hermosillo", chihuahua: "America/Chihuahua", acapulco: "America/Mexico_City", veracruz: "America/Mexico_City",
  // Norteamérica y Caribe
  "nueva york": "America/New_York", "new york": "America/New_York", nyc: "America/New_York", miami: "America/New_York", orlando: "America/New_York",
  boston: "America/New_York", washington: "America/New_York", atlanta: "America/New_York", chicago: "America/Chicago", houston: "America/Chicago",
  dallas: "America/Chicago", "san antonio": "America/Chicago", austin: "America/Chicago", denver: "America/Denver", phoenix: "America/Phoenix",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles", "las vegas": "America/Los_Angeles", seattle: "America/Los_Angeles",
  "san diego": "America/Los_Angeles", honolulu: "Pacific/Honolulu", toronto: "America/Toronto", montreal: "America/Toronto", vancouver: "America/Vancouver",
  "la habana": "America/Havana", habana: "America/Havana", "punta cana": "America/Santo_Domingo", "santo domingo": "America/Santo_Domingo",
  "san juan": "America/Puerto_Rico", "ciudad de panama": "America/Panama", panama: "America/Panama", "san jose": "America/Costa_Rica",
  guatemala: "America/Guatemala", "ciudad de guatemala": "America/Guatemala",
  // Sudamérica
  bogota: "America/Bogota", medellin: "America/Bogota", cartagena: "America/Bogota", lima: "America/Lima", cusco: "America/Lima", quito: "America/Guayaquil",
  "buenos aires": "America/Argentina/Buenos_Aires", santiago: "America/Santiago", "santiago de chile": "America/Santiago", "sao paulo": "America/Sao_Paulo",
  "rio de janeiro": "America/Sao_Paulo", montevideo: "America/Montevideo", caracas: "America/Caracas", asuncion: "America/Asuncion",
  // Europa
  madrid: "Europe/Madrid", barcelona: "Europe/Madrid", sevilla: "Europe/Madrid", valencia: "Europe/Madrid", malaga: "Europe/Madrid", "palma de mallorca": "Europe/Madrid",
  lisboa: "Europe/Lisbon", lisbon: "Europe/Lisbon", oporto: "Europe/Lisbon", porto: "Europe/Lisbon", londres: "Europe/London", london: "Europe/London",
  edimburgo: "Europe/London", dublin: "Europe/Dublin", paris: "Europe/Paris", niza: "Europe/Paris", lyon: "Europe/Paris", roma: "Europe/Rome", rome: "Europe/Rome",
  florencia: "Europe/Rome", venecia: "Europe/Rome", milan: "Europe/Rome", napoles: "Europe/Rome", amalfi: "Europe/Rome", berlin: "Europe/Berlin",
  munich: "Europe/Berlin", frankfurt: "Europe/Berlin", amsterdam: "Europe/Amsterdam", bruselas: "Europe/Brussels", viena: "Europe/Vienna",
  praga: "Europe/Prague", budapest: "Europe/Budapest", zurich: "Europe/Zurich", ginebra: "Europe/Zurich", copenhague: "Europe/Copenhagen",
  estocolmo: "Europe/Stockholm", oslo: "Europe/Oslo", helsinki: "Europe/Helsinki", reikiavik: "Atlantic/Reykjavik", atenas: "Europe/Athens",
  santorini: "Europe/Athens", mykonos: "Europe/Athens", estambul: "Europe/Istanbul", istanbul: "Europe/Istanbul", varsovia: "Europe/Warsaw",
  cracovia: "Europe/Warsaw", bucarest: "Europe/Bucharest", moscu: "Europe/Moscow", dubrovnik: "Europe/Zagreb", split: "Europe/Zagreb",
  // Asia, Medio Oriente, África y Oceanía
  tokio: "Asia/Tokyo", tokyo: "Asia/Tokyo", kioto: "Asia/Tokyo", kyoto: "Asia/Tokyo", osaka: "Asia/Tokyo", seul: "Asia/Seoul", seoul: "Asia/Seoul",
  pekin: "Asia/Shanghai", beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", "hong kong": "Asia/Hong_Kong", taipei: "Asia/Taipei",
  singapur: "Asia/Singapore", singapore: "Asia/Singapore", bangkok: "Asia/Bangkok", phuket: "Asia/Bangkok", "chiang mai": "Asia/Bangkok",
  bali: "Asia/Makassar", yakarta: "Asia/Jakarta", "kuala lumpur": "Asia/Kuala_Lumpur", manila: "Asia/Manila", hanoi: "Asia/Bangkok",
  "ho chi minh": "Asia/Ho_Chi_Minh", delhi: "Asia/Kolkata", "nueva delhi": "Asia/Kolkata", bombay: "Asia/Kolkata", mumbai: "Asia/Kolkata",
  dubai: "Asia/Dubai", "abu dabi": "Asia/Dubai", doha: "Asia/Qatar", "tel aviv": "Asia/Jerusalem", jerusalen: "Asia/Jerusalem", maldivas: "Indian/Maldives",
  "el cairo": "Africa/Cairo", cairo: "Africa/Cairo", marrakech: "Africa/Casablanca", "ciudad del cabo": "Africa/Johannesburg", johannesburgo: "Africa/Johannesburg",
  nairobi: "Africa/Nairobi", sidney: "Australia/Sydney", sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", auckland: "Pacific/Auckland",
  // Países con una sola zona (si el usuario solo dice el país)
  japon: "Asia/Tokyo", japan: "Asia/Tokyo", espana: "Europe/Madrid", francia: "Europe/Paris", italia: "Europe/Rome", alemania: "Europe/Berlin",
  "reino unido": "Europe/London", inglaterra: "Europe/London", portugal: "Europe/Lisbon", grecia: "Europe/Athens", turquia: "Europe/Istanbul",
  "paises bajos": "Europe/Amsterdam", holanda: "Europe/Amsterdam", suiza: "Europe/Zurich", austria: "Europe/Vienna", colombia: "America/Bogota",
  peru: "America/Lima", argentina: "America/Argentina/Buenos_Aires", chile: "America/Santiago", "corea del sur": "Asia/Seoul", corea: "Asia/Seoul",
  china: "Asia/Shanghai", tailandia: "Asia/Bangkok", india: "Asia/Kolkata", "emiratos arabes unidos": "Asia/Dubai", emiratos: "Asia/Dubai",
  egipto: "Africa/Cairo", marruecos: "Africa/Casablanca", "costa rica": "America/Costa_Rica", cuba: "America/Havana", "republica dominicana": "America/Santo_Domingo",
};

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9/_ ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Zona IANA de un texto: una zona válida ("Asia/Tokyo"), una ciudad o un país con una sola zona. null si
 * no se reconoce (nunca se adivina una zona).
 */
export function timeZoneFor(place: unknown): string | null {
  const raw = String(place ?? "").trim();
  if (!raw) return null;
  if (raw.includes("/") && validTz(raw)) return raw;
  const n = norm(raw).replace(/^(la |el |en )/, "");
  if (CITY_TZ[n]) return CITY_TZ[n];
  // "Tokio, Japón" / "Shinjuku, Tokio": cualquier parte que sea una ciudad conocida.
  for (const part of raw.split(/[,(]/).map(norm)) if (CITY_TZ[part]) return CITY_TZ[part];
  const c = cityAirports(raw.split(",")[0].trim());
  if (c) {
    const byName = CITY_TZ[norm(c.name)];
    if (byName) return byName;
  }
  return null;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Partes de la fecha y hora de `now` en la zona `tz` (calendario gregoriano, 24 h). */
function partsIn(now: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const iso = `${p.year}-${p.month}-${p.day}`;
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return { iso, hour: p.hour === "24" ? "00" : p.hour, minute: p.minute, dow, day: Number(p.day), month: Number(p.month) };
}

/** Diferencia (en minutos) de la zona contra UTC en ese instante. */
export function utcOffsetMinutes(now: Date, tz: string): number {
  const p = partsIn(now, tz);
  const asUtc = Date.UTC(Number(p.iso.slice(0, 4)), p.month - 1, p.day, Number(p.hour), Number(p.minute));
  return Math.round((asUtc - Math.floor(now.getTime() / 60000) * 60000) / 60000);
}

const fmtOffset = (min: number) => {
  const s = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `UTC${s}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
};

export interface LocalClock {
  zona: string;
  etiqueta: string;
  fecha: string;
  hora: string;
  /** "jueves 29 oct 2026, 14:44 (hora de Tokio)": para copiarlo tal cual. */
  texto: string;
  utc_offset: string;
}

/** Hora actual en la zona `tz` (null si la zona no es válida). */
export function clockIn(now: Date, tz: string): LocalClock | null {
  if (!validTz(tz)) return null;
  const p = partsIn(now, tz);
  const hora = `${p.hour}:${p.minute}`;
  const etiqueta = tzLabel(tz);
  return {
    zona: tz, etiqueta, fecha: p.iso, hora, utc_offset: fmtOffset(utcOffsetMinutes(now, tz)),
    texto: `${DIAS[p.dow]} ${p.day} ${MESES[p.month - 1]} ${p.iso.slice(0, 4)}, ${hora} (${etiqueta})`,
  };
}

/** Línea para el sistema: la hora local actual del usuario, ya calculada. "" si no se sabe su zona. */
export function userClockLine(now: Date, tz: string | null | undefined): string {
  const c = tz ? clockIn(now, tz) : null;
  if (!c) return "";
  return `HORA ACTUAL DEL USUARIO: ${c.texto}, ${c.utc_offset}. Para la hora de otra ciudad usa la herramienta get_local_time; nunca digas que no tienes reloj.`;
}

/**
 * Herramienta get_local_time: hora actual en la ciudad o zona pedida y la diferencia con el usuario.
 * Sin red: siempre responde al instante (o dice que no reconoce el lugar, sin inventar una zona).
 */
export function runLocalTime(args: Record<string, unknown>, deps: { now?: Date; userTz?: string | null } = {}): Record<string, unknown> {
  const now = deps.now ?? new Date();
  const place = String(args.city ?? args.zona ?? args.timezone ?? "").trim().slice(0, 80);
  const tz = timeZoneFor(args.timezone) ?? timeZoneFor(place);
  if (!tz) {
    return {
      ok: false, disponible: false, estado: "sin_resultados", lugar: place,
      motivo: `No reconozco la zona horaria de «${place || "ese lugar"}». Pide la ciudad (o la zona IANA, ej. Asia/Tokyo); no digas que no tienes reloj ni inventes la hora.`,
    };
  }
  const c = clockIn(now, tz)!;
  const out: Record<string, unknown> = {
    ok: true, fuente: "reloj de IATOS (UTC del servidor + zona IANA, Intl)", consultado_at: now.toISOString(),
    lugar: place || tz, ...c,
    nota: "Di la hora tal cual viene en `texto` (ya incluye horario de verano). Es la hora de este momento.",
  };
  const user = deps.userTz && validTz(deps.userTz) ? clockIn(now, deps.userTz) : null;
  if (user) {
    const diff = (utcOffsetMinutes(now, tz) - utcOffsetMinutes(now, deps.userTz!)) / 60;
    out.hora_del_usuario = user.texto;
    out.diferencia_con_el_usuario = diff === 0 ? "misma hora" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} h respecto al usuario`;
  }
  return out;
}

/** "¿qué hora es en Tokio?", "hora local en Madrid", "diferencia de horario con Lisboa". */
export function timeRequested(message: unknown): boolean {
  const m = norm(message);
  return /\b(que hora es|que hora son|hora (actual|local|exacta)|zona horaria|diferencia de hora\w*|cuantas horas de diferencia|diferencia horaria|huso horario)\b/.test(m)
    && !/\b(abre|cierra|sale|llega|despega|aterriza|check ?in|check ?out|horario)\b/.test(m);
}
