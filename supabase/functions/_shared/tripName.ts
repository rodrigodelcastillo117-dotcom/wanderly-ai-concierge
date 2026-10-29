// Nombre corto de un viaje para mostrarlo en listas (auditoría 10/10, 28-oct-2026).
//
// Un viaje se guardó con la frase completa que escribió la persona como destino ("Quiero conocer España
// 15 días, no sé qué ciudades. Del 4 al 19 de mayo…") y esa frase estiraba las listas (Inicio, Mis viajes,
// Perfil, Recuerdos, Gastos). Aquí:
//   - looksLikeRawPrompt: ¿el texto es una petición y no un lugar?
//   - shortTripName: el nombre a mostrar (paradas entendidas, ruta, país o el lugar que nombra la frase).
//   - storedTripDestino: lo que analizar-viaje guarda como destino al crear el viaje (la causa).
// Nunca se edita un dato guardado: la frase original sigue en itinerario_json.consulta.
// Puro (sin Deno): lo usan la app (Vitest) y las funciones.

const PROMPT_WORDS = /(^|[^a-záéíóúñü])(quiero|quisiera|queremos|me gustar[ií]a|nos gustar[ií]a|busco|buscamos|planea|planear|planifica|organiza|ay[uú]dame|conocer|viajar|ir a|vamos|d[ií]as|noches|semanas?|personas?|viajeros|presupuesto|no s[eé]|del \d|al \d)([^a-záéíóúñü]|$)/i;

/** ¿El destino guardado es la frase que escribió la persona y no un lugar? */
export function looksLikeRawPrompt(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  // "Roma → Florencia → Venecia" es una ruta, no una frase.
  if (/→/.test(t) && t.length <= 90) return false;
  if (t.length > 60) return true;
  const words = t.split(/\s+/).length;
  return words >= 4 && PROMPT_WORDS.test(t);
}

import { CITIES, TOWNS } from "./airports.ts";

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Ciudades y lugares conocidos (nombre para mostrar + nombres normalizados), los más largos primero. */
const KNOWN: Array<{ name: string; keys: string[] }> = [
  ...CITIES.map((c) => ({ name: c.name, keys: [c.name, ...(c.aliases ?? []).filter((a) => a.length >= 5)].map(norm) })),
  ...TOWNS.map((t) => ({ name: t.name, keys: [t.name, ...(t.aliases ?? []).filter((a) => a.length >= 5)].map(norm) })),
].sort((a, b) => Math.max(...b.keys.map((k) => k.length)) - Math.max(...a.keys.map((k) => k.length)));

/** Una ciudad conocida que nombra el texto ("E2E PRUEBA Presupuesto Los Cabos" → "Los Cabos"), o "". */
export function knownPlaceIn(text: string | null | undefined): string {
  const t = ` ${norm(text)} `;
  if (t.trim().length < 3) return "";
  return KNOWN.find((p) => p.keys.some((k) => k.length >= 3 && t.includes(` ${k} `)))?.name ?? "";
}

const clean = (s: unknown, max = 40): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Une hasta 3 lugares: "Madrid → Sevilla → Granada…". */
function route(places: string[]): string {
  const list = places.map((p) => clean(p)).filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
  if (!list.length) return "";
  return list.length > 3 ? `${list.slice(0, 3).join(" → ")}…` : list.join(" → ");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Paradas que se entendieron de la frase (itinerario_json.consulta.interpretacion.paradas). */
function understoodStops(itinerario: unknown): string[] {
  if (!isObj(itinerario)) return [];
  const multi = Array.isArray(itinerario.destinations) ? (itinerario.destinations as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (multi.length) return multi;
  const consulta = isObj(itinerario.consulta) ? itinerario.consulta : null;
  const interp = consulta && isObj(consulta.interpretacion) ? consulta.interpretacion : null;
  const paradas = interp && Array.isArray(interp.paradas) ? (interp.paradas as unknown[]).filter(isObj) : [];
  const estancias = paradas.filter((p) => !p.rol || p.rol === "estancia").map((p) => (typeof p.ciudad === "string" ? p.ciudad : ""));
  return estancias.filter(Boolean);
}

const PLACE = "[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü.'-]+";
const PLACE_AFTER = new RegExp(`(?:conocer|visitar|ir a|viajar a|irnos a|ir de viaje a|recorrer|vacaciones en|viaje a)\\s+(${PLACE}(?:\\s+(?:de|del|la|las|los|y|e)?\\s*${PLACE})*)`);
const FIRST_PLACE = new RegExp(`(?:^|\\s)(${PLACE}(?:\\s+(?:de|del|la|las|los)\\s+${PLACE})*)`);
const NOT_PLACE = /^(Quiero|Quisiera|Queremos|Me|Nos|Del|Al|De|En|Busco|Somos|Viajamos|No|Para|Con|Un|Una|El|La|Los|Las|Y)$/;

/** El lugar que nombra la frase ("…conocer España 15 días…" → "España"), o "". */
export function placeFromPrompt(text: string | null | undefined): string {
  const t = String(text ?? "");
  const m = PLACE_AFTER.exec(t);
  if (m) return clean(m[1]);
  for (const part of t.split(/[.,;:!?]/)) {
    const f = FIRST_PLACE.exec(part.trim());
    if (f && !NOT_PLACE.test(f[1].split(/\s+/)[0])) return clean(f[1]);
  }
  return "";
}

export type NamedTrip = { destino?: string | null; pais_destino?: string | null; itinerario_json?: unknown };

/** Nombre corto para listas: el destino si es un lugar; si es la frase, lo que se entendió de ella. */
export function shortTripName(trip: NamedTrip | null | undefined): string {
  const destino = clean(trip?.destino, 200);
  if (destino && !looksLikeRawPrompt(destino)) return destino;
  const stops = route(understoodStops(trip?.itinerario_json));
  if (stops) return stops;
  // Lo que la frase dice que quiere conocer ("…conocer España…") y, si no, la ciudad conocida que nombra,
  // antes que el país (R2: «E2E PRUEBA Presupuesto Los Cabos» salía «México»).
  const after = PLACE_AFTER.exec(destino);
  if (after) return clean(after[1]);
  const known = knownPlaceIn(destino);
  if (known) return known;
  const pais = clean(trip?.pais_destino);
  if (pais && !looksLikeRawPrompt(pais)) return pais;
  return placeFromPrompt(destino) || (destino ? "Tu viaje" : "Sin destino");
}

/**
 * Destino que se guarda al crear un viaje (analizar-viaje): si llegó la frase completa, el país que
 * identificó el análisis o el lugar que nombra la frase. La frase se guarda aparte (consulta).
 */
export function storedTripDestino(destino: string | null | undefined, paisAnalisis?: string | null): string {
  const d = String(destino ?? "").trim();
  if (!looksLikeRawPrompt(d)) return d;
  const fromText = placeFromPrompt(d);
  const pais = clean(paisAnalisis);
  return fromText || (pais && !looksLikeRawPrompt(pais) ? pais : "") || d.slice(0, 60);
}
