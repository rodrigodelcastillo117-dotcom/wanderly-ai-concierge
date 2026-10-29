// "Chofer privado / traslados con conductor" en Comprar (caso Álvaro, 28-oct-2026: "si es más premium
// me daba rentar coche, pero en la India o en Oaxaca quiero a alguien que me maneje, porque no conozco").
// Antes el único transporte en destino era "Renta de auto (opcional)" (purchasePlan.ts, paso 3).
// Lógica pura, sin red: cuándo va PRIMERO el chofer y la renta queda como alternativa, y qué se le manda
// al equipo (concierge-action, tipo "transport": la misma solicitud que usa Iato). Nunca un precio: el
// chofer va "por cotizar" y lo cotiza una persona del equipo.
import { cityAirports, normCity } from "../../supabase/functions/_shared/airports.ts";
import { tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { consultaOf } from "../../supabase/functions/_shared/tripSpec.ts";

/** Países donde lo normal para un visitante es contratar chofer (manejar es difícil o poco común). */
export const DRIVER_FIRST_COUNTRIES = new Set(["IN", "CN", "EG", "MA", "TH", "ID", "VN", "KH", "LK", "NP", "JO", "PE", "BO", "GT", "KE", "TZ", "PH", "BD", "MM"]);
/** Se maneja por la izquierda (poco familiar para quien maneja en México). */
export const LEFT_HAND_COUNTRIES = new Set(["GB", "IE", "JP", "AU", "NZ", "ZA", "SG", "HK", "MY"]);
/**
 * Ciudades donde rentar coche no conviene para un visitante (tráfico, estacionamiento, calles del centro)
 * y moverse con chofer para las salidas es lo práctico. Nombres normalizados (normCity).
 */
const NO_CAR_CITIES = new Set(["oaxaca", "oaxaca de juarez", "ciudad de mexico", "cdmx", "mexico city", "guanajuato", "san cristobal de las casas", "san miguel de allende",
  "delhi", "nueva delhi", "new delhi", "mumbai", "agra", "jaipur", "el cairo", "cairo", "marrakech", "pekin", "beijing", "shanghai", "bangkok", "cusco", "lima"]);

const PAIS = (iso2: string, name: string) => ({ iso2, name });
/** País del destino para los que no están en la tabla de aeropuertos por ciudad ("India", "Perú"…). */
const COUNTRY_WORDS: Record<string, { iso2: string; name: string }> = {
  india: PAIS("IN", "India"), china: PAIS("CN", "China"), egipto: PAIS("EG", "Egipto"), marruecos: PAIS("MA", "Marruecos"),
  tailandia: PAIS("TH", "Tailandia"), indonesia: PAIS("ID", "Indonesia"), vietnam: PAIS("VN", "Vietnam"), camboya: PAIS("KH", "Camboya"),
  "sri lanka": PAIS("LK", "Sri Lanka"), nepal: PAIS("NP", "Nepal"), jordania: PAIS("JO", "Jordania"), peru: PAIS("PE", "Perú"),
  bolivia: PAIS("BO", "Bolivia"), guatemala: PAIS("GT", "Guatemala"), kenia: PAIS("KE", "Kenia"), tanzania: PAIS("TZ", "Tanzania"),
  filipinas: PAIS("PH", "Filipinas"), japon: PAIS("JP", "Japón"), "reino unido": PAIS("GB", "Reino Unido"), inglaterra: PAIS("GB", "Reino Unido"),
  irlanda: PAIS("IE", "Irlanda"), australia: PAIS("AU", "Australia"), "nueva zelanda": PAIS("NZ", "Nueva Zelanda"), sudafrica: PAIS("ZA", "Sudáfrica"),
};

/** "no manejo", "no sé manejar", "sin licencia", "que alguien me maneje", "con chofer"… */
const NO_DRIVE_RE = /\b(no\s+(manejo|se\s+manejar|quiero\s+manejar|me\s+gusta\s+manejar|tengo\s+licencia)|sin\s+licencia|que\s+(alguien\s+)?me\s+(maneje|lleve)n?|con\s+chofer|chofer\s+privado|conductor\s+privado)\b/;

export type DriverOption = {
  /** true: el chofer va primero y la renta de auto queda como alternativa. */
  recommended: boolean;
  /** Por qué se recomienda (para la persona), o null. */
  reason: string | null;
  city: string;
  /** Lo que se manda a concierge-action (crea una SOLICITUD para el equipo; no es reserva). */
  request: { type: "transport"; title: string; payload: Record<string, unknown> };
};

const noAccents = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function countryOf(trip: any, city: string): { iso2: string; name: string } | null {
  const c = cityAirports(city);
  if (c) return { iso2: c.iso2, name: c.country };
  for (const w of [trip?.pais_destino, city, trip?.destino]) {
    const k = normCity(w);
    if (COUNTRY_WORDS[k]) return COUNTRY_WORDS[k];
  }
  return null;
}

/**
 * Chofer privado del viaje: siempre se puede pedir (salvo que vaya en su propio coche, eso lo decide
 * quien llama). Va primero si el viaje es premium, si el destino es un país donde lo normal es contratar
 * chofer o se maneja por la izquierda, si es una ciudad donde rentar no conviene o si la persona dijo
 * que no maneja.
 */
export function driverOption(trip: any, opts: { premium?: boolean } = {}): DriverOption | null {
  const cities = tripDestinations(trip);
  const city = (cities[0] ?? String(trip?.destino ?? "")).trim();
  if (!city) return null;
  const country = countryOf(trip, city);
  const text = noAccents([consultaOf(trip)?.consulta_original, trip?.notas_usuario].filter(Boolean).join(" "));
  const k = normCity(city);
  let reason: string | null = null;
  if (NO_DRIVE_RE.test(text)) reason = "Nos dijiste que prefieres no manejar.";
  else if (country && DRIVER_FIRST_COUNTRIES.has(country.iso2)) reason = `En ${country.name} lo normal para un visitante es moverse con chofer: el tráfico y las reglas son poco familiares.`;
  else if (country && LEFT_HAND_COUNTRIES.has(country.iso2)) reason = `En ${country.name} se maneja por la izquierda: con chofer no tienes que preocuparte por eso.`;
  else if (NO_CAR_CITIES.has(k)) reason = `En ${city} rentar coche no suele convenir (tráfico, estacionamiento y calles del centro): un chofer te lleva a las salidas.`;
  else if (opts.premium) reason = "Tu viaje es premium: un chofer privado te recoge y te lleva sin que manejes.";
  const travelers = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
  const payload: Record<string, unknown> = {
    servicio: "chofer_privado",
    detalle: `Chofer privado / traslados con conductor en ${city}${cities.length > 1 ? ` (ruta: ${cities.join(" → ")})` : ""}. Incluye recoger en el aeropuerto si aplica. Precio por cotizar.`,
    lugar: city,
    ...(country ? { pais: country.name } : {}),
    ...(typeof trip?.fecha_salida === "string" ? { fecha: trip.fecha_salida } : {}),
    ...(typeof trip?.fecha_regreso === "string" ? { fecha_fin: trip.fecha_regreso } : {}),
    personas: travelers,
    origen: "comprar",
  };
  return {
    recommended: !!reason, reason, city,
    request: { type: "transport", title: `Chofer privado en ${city}`.slice(0, 200), payload },
  };
}
