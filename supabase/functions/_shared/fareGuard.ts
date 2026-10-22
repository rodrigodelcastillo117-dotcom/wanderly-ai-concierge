// Filtro de tarifas de referencia (Travelpayouts/Aviasales) antes de mostrarlas o sumarlas. Sin Deno.
//
// Caso Roma → Florencia → Venecia (22-oct-2026): la "tarifa de Roma" guardada era una búsqueda
// MEX→BUH (Bucarest) de 65 h con Volaris, y se presentó igual en los 3 niveles. Una tarifa solo se
// usa si sale del origen pedido y llega al destino pedido (o a otro aeropuerto de su área: CIA para
// Roma), con una duración creíble para la distancia. Sin tarifa válida el vuelo queda por cotizar.
import { airlineFitsRoute, cityAirports, codeServesCity, maxPlausibleHours } from "./airports.ts";

export type FareRow = {
  origin?: string | null;
  destination?: string | null;
  origin_airport?: string | null;
  destination_airport?: string | null;
  airline?: string | null;
  /** Minutos (Travelpayouts: duration = ida + vuelta; duration_to / duration_back por sentido). */
  duration?: number | null;
  duration_to?: number | null;
  duration_back?: number | null;
  duration_minutes?: number | null;
  duration_to_minutes?: number | null;
  duration_back_minutes?: number | null;
  link?: string | null;
  booking_link?: string | null;
};

export type FareProblem = "destino_distinto" | "origen_distinto" | "duracion_absurda" | "aerolinea_no_opera_la_ruta";

/** Origen y destino de un enlace /search/MEX3010BUH07111 de Aviasales (o del "link" de la API). */
export function routeFromAviasalesLink(link: unknown): { origin: string; destination: string } | null {
  const m = /\/search\/([A-Z]{3})\d{4}([A-Z]{3})/.exec(String(link ?? ""));
  return m ? { origin: m[1], destination: m[2] } : null;
}

const matches = (code: string, wantCode: string, wantCity: string | null | undefined) => {
  const c = code.toUpperCase();
  // Con la ciudad que pidió el usuario, manda la ciudad: si el código pedido a la API ya venía mal
  // (autocompletado), una tarifa a ese código tampoco sirve.
  const byCity = wantCity ? codeServesCity(c, wantCity) : null;
  if (byCity !== null) return byCity;
  if (c === wantCode.toUpperCase()) return true;
  return codeServesCity(c, wantCode) === true;
};

/**
 * Problemas de una tarifa para la ruta pedida. `want.origin`/`want.destination` son los códigos que se
 * pidieron a la API (ciudad o aeropuerto); `originCity`/`destinationCity`, lo que escribió el usuario.
 */
export function fareProblems(row: FareRow, want: { origin: string; destination: string; originCity?: string | null; destinationCity?: string | null }): FareProblem[] {
  const out: FareProblem[] = [];
  const link = routeFromAviasalesLink(row.link ?? row.booking_link);
  const dests = [row.destination, row.destination_airport, link?.destination].filter((x): x is string => typeof x === "string" && /^[A-Za-z]{3}$/.test(x));
  const origs = [row.origin, row.origin_airport, link?.origin].filter((x): x is string => typeof x === "string" && /^[A-Za-z]{3}$/.test(x));
  if (dests.some((d) => !matches(d, want.destination, want.destinationCity))) out.push("destino_distinto");
  if (origs.some((o) => !matches(o, want.origin, want.originCity))) out.push("origen_distinto");
  const from = want.originCity || want.origin;
  const to = want.destinationCity || want.destination;
  const max = maxPlausibleHours(from, to) * 60;
  const to1 = Number(row.duration_to ?? row.duration_to_minutes) || 0;
  const back = Number(row.duration_back ?? row.duration_back_minutes) || 0;
  const total = Number(row.duration ?? row.duration_minutes) || 0;
  if (to1 > max || back > max || (!to1 && !back && total > 2 * max)) out.push("duracion_absurda");
  // Una aerolínea regional fuera de su región (Volaris a Europa) no puede ser la de esta ruta.
  const airline = String(row.airline ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{2}$/.test(airline) && !airlineFitsRoute(airline, from, to)) out.push("aerolinea_no_opera_la_ruta");
  return out;
}

/** Separa las tarifas que sirven de las descartadas (con el motivo, para el registro). */
export function filterFares<T extends FareRow>(rows: T[], want: Parameters<typeof fareProblems>[1]): { valid: T[]; rejected: Array<{ row: T; problems: FareProblem[] }> } {
  const valid: T[] = [];
  const rejected: Array<{ row: T; problems: FareProblem[] }> = [];
  for (const r of rows ?? []) {
    const p = fareProblems(r, want);
    if (p.length) rejected.push({ row: r, problems: p });
    else valid.push(r);
  }
  return { valid, rejected };
}

/** Código que se le pide a Travelpayouts para una ciudad conocida (ROM para Roma); null si no se conoce. */
export function knownCityCode(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  return cityAirports(raw)?.metro ?? null;
}


/**
 * Ciudades de escala de la ida, leídas del token `t` de un enlace de Aviasales (la ruta va escrita
 * como códigos seguidos: "…MEXCUNMADOTP…" = MEX → Cancún → Madrid → OTP). null si el enlace no la trae
 * o no se puede leer con seguridad: entonces se dice "Escalas por confirmar", nunca un número suelto.
 */
export function layoverCodesFromAviasalesLink(link: unknown): string[] | null {
  let t: string | null = null;
  try { t = new URL(String(link ?? "")).searchParams.get("t"); } catch { return null; }
  const route = routeFromAviasalesLink(link);
  if (!t || !route) return null;
  const runs = t.match(/[A-Z]{6,}/g) ?? [];
  for (const run of runs) {
    if (run.length % 3 !== 0) continue;
    const codes = run.match(/.{3}/g)!;
    const startsAtOrigin = codes[0] === route.origin || codeServesCity(codes[0], route.origin) === true;
    const last = codes[codes.length - 1];
    const endsAtDest = last === route.destination || codeServesCity(last, route.destination) === true || cityAirports(last)?.metro === route.destination;
    if (startsAtOrigin && endsAtDest) return codes.slice(1, -1);
  }
  return null;
}
