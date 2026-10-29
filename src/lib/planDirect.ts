// Planear DIRECTO, como antes del 28-oct-2026 (queja de Carlo, 29-oct: "te manda 2 veces para hacer
// cotización"). Desde el intérprete (681655c / 7de3e3b) todo texto pasaba por "Tu viaje, como lo
// entendimos" y luego, al confirmar, a la cotización; los viajes de varias ciudades ya no llegaban a la
// ruta con el globo. Ahora, con lo entendido:
//   - sin preguntas pendientes y varias ciudades → la ruta multidestino con el globo (/dashboard/ruta),
//     como antes; ahí se pulsa "Generar".
//   - sin preguntas pendientes y una ciudad → la cotización directa (analizar-viaje), como antes.
//   - crucero o tramos elegidos (tren, coche…) → la cotización directa (la ruta no los lleva en la URL).
//   - con preguntas pendientes reales (fechas, origen, un lugar que no reconocemos…) → un paso corto
//     solo con esas preguntas. "Ver todo lo que entendimos" sigue disponible ahí y en el viaje
//     ("¿No entendimos bien tu viaje?"); ya no es un paso obligatorio.
// Nada se inventa: sin fechas exactas se preguntan (antes se ponían "dentro de 30 días").
import { addIsoDays } from "@/lib/multiCityText";
import {
  makeStop, openQuestions, routeOfSpec, savedConsulta,
  type Question, type SavedConsulta, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec.ts";

export type PlanNext =
  | { kind: "ruta"; qs: string }
  | { kind: "cotizar" }
  | { kind: "preguntar"; pendientes: Question[] }
  | { kind: "revisar" };

/** Qué sigue después de entender el texto. Puro (lo prueba src/test/comoAntes.test.tsx). */
export function nextPlanStep(spec: TripSpec, o: { presupuesto?: number | null } = {}): PlanNext {
  const r = routeOfSpec(spec);
  if (r.kind === "preguntas") return { kind: "preguntar", pendientes: r.pendientes };
  if (r.kind === "vacio" || r.kind === "relato_pasado") return { kind: "revisar" };
  if (r.kind === "unico") return { kind: "cotizar" };
  if (r.seaLegs.length || r.legModes) return { kind: "cotizar" };
  const qs = new URLSearchParams({ origin: r.origen, destinos: r.destinos.join("|"), viajeros: String(r.viajeros) });
  if (r.fecha_salida) qs.set("fecha_salida", r.fecha_salida);
  if (r.fecha_regreso) qs.set("fecha_regreso", r.fecha_regreso);
  if (r.noches && r.noches.length === r.destinos.length) qs.set("noches", r.noches.join("|"));
  if (o.presupuesto != null) qs.set("presupuesto", String(o.presupuesto));
  qs.set("auto", "1");
  return { kind: "ruta", qs: qs.toString() };
}

/** Preguntas abiertas del paso corto (las mismas que bloquean la cotización). */
export const pendingQuestions = (spec: TripSpec): Question[] => openQuestions(spec);

/**
 * "10 días en abril": el día de salida dentro de ese mes y el regreso con esas noches (sin inventar el
 * día: lo elige la persona). `nights` = noches que dijo el texto ("10 días" → 9).
 */
export function returnFor(salida: string | null, nights: number | null | undefined): string | null {
  if (!salida || !/^\d{4}-\d{2}-\d{2}$/.test(salida) || !nights || nights < 1) return null;
  return addIsoDays(salida, nights);
}

export function monthBounds(m: { month: number; year: number } | null): { min: string; max: string } | null {
  if (!m) return null;
  const mm = String(m.month + 1).padStart(2, "0");
  const last = new Date(m.year, m.month + 1, 0).getDate();
  return { min: `${m.year}-${mm}-01`, max: `${m.year}-${mm}-${String(last).padStart(2, "0")}` };
}

// ── Lo escrito viaja a la ruta: el texto original y lo entendido se guardan en el viaje que se genere
// ahí (itinerario_json.consulta), para que "¿No entendimos bien tu viaje?" lo muestre. Se guarda en la
// sesión de la pestaña (no en la URL) y caduca en un día.
const ROUTE_KEY = "iatos.ruta.consulta";
type Stashed = { at: number; destinos: string[]; spec: TripSpec; notas: string };

export function stashRouteConsulta(spec: TripSpec, destinos: string[], notas: string): void {
  try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify({ at: Date.now(), destinos, spec, notas } satisfies Stashed)); } catch { /* sin almacenamiento */ }
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Consulta para el viaje que se genera en la ruta: solo si la ruta sigue siendo la que vino del texto
 * (comparte al menos una ciudad). Las paradas son las de la ruta final (la persona pudo moverlas).
 */
export function routeConsultaFor(stops: string[]): { consulta: SavedConsulta; notas: string } | null {
  let v: Stashed | null = null;
  try { v = JSON.parse(sessionStorage.getItem(ROUTE_KEY) ?? "null"); } catch { return null; }
  if (!v?.spec?.consulta_original || !Array.isArray(v.destinos) || Date.now() - Number(v.at) > 86_400_000) return null;
  const wanted = new Set(v.destinos.map(norm));
  if (!stops.some((c) => wanted.has(norm(c)))) return null;
  const paradas = stops.map((c) => v!.spec.paradas.find((p) => norm(p.ciudad) === norm(c)) ?? makeStop(c, { texto: c }));
  return { consulta: savedConsulta({ ...v.spec, paradas }), notas: typeof v.notas === "string" ? v.notas : "" };
}

export function clearRouteConsulta(): void {
  try { sessionStorage.removeItem(ROUTE_KEY); } catch { /* sin almacenamiento */ }
}
