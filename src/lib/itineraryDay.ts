// Itinerario escaneable (ola «9.5 en todo», 29-oct-2026; Álvaro: «demasiado texto en los itinerarios»).
// Cada día se lee en tres renglones —Mañana · Tarde · Noche— con el lugar del plan que menciona (o la
// primera frase corta), y con chips del transporte de ese día: el vuelo de ida, la llegada, el tren a la
// siguiente ciudad y el vuelo de regreso. Todo sale del viaje guardado:
//  - Lugares: experiencias, restaurantes y hoteles del plan, con su ficha de Google (place_id, maps_url,
//    calificación). El enlace a Maps solo existe si el lugar trae place_id o maps_url (nunca una búsqueda
//    adivinada).
//  - Transporte: el mismo vuelo con que se alinea el día 1 (tripOutbound) y los mismos tramos de «Comprar»
//    (buildBuyFlow). Duraciones del plan, marcadas «aprox.»; los tiempos reales del día los calcula Google
//    Maps con «Ruta del día».
// Puro: sin red ni precios.
import { firstClause } from "@/lib/tripGlance";
import { tripOutbound, type CalendarDay } from "@/lib/itineraryCalendar";
import type { BuyStep } from "@/lib/buyFlow";
import { transportModeOf } from "@/lib/booking";
import { sameCity, tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { arrivalFromFlight, fmtDia, returnFromFlight } from "../../supabase/functions/_shared/tripCalendar.ts";

export type DayPlace = {
  name: string;
  kind: "experiencia" | "restaurante" | "hotel";
  ciudad: string | null;
  placeId: string | null;
  /** Ficha del lugar en Google Maps (maps_url guardado o búsqueda por place_id). */
  mapsUrl: string | null;
  rating: number | null;
  /** Por qué está en tu plan (lo que escribió el plan para esa experiencia o restaurante). */
  porQue: string | null;
};

export type DayPart = "mañana" | "tarde" | "noche";
export type DaySlot = {
  part: DayPart; label: string; text: string; headline: string; place: DayPlace | null;
  /** Dice lo mismo que una franja anterior («En vuelo hacia Roma» en la mañana y la tarde): el resumen no la repite. */
  repeated?: boolean;
};

export type DayChip = {
  kind: "vuelo" | "traslado" | "regreso";
  /** vuelo · tren · coche · bus · ferry (para el ícono). */
  mode: string;
  text: string;
  sub: string | null;
  /** Paso de «Comprar» donde se elige o compra (paso-1…), si lo hay. */
  target: string | null;
};

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const norm = (v: unknown) => clean(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const isPlaceId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{16,300}$/.test(v) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);

/** Solo enlaces https de Google Maps guardados con el lugar. */
function savedMapsUrl(v: unknown): string | null {
  const s = clean(v);
  if (!/^https:\/\//i.test(s)) return null;
  try {
    const host = new URL(s).hostname.toLowerCase();
    return /(^|\.)google\.[a-z.]+$/.test(host) || host === "maps.google.com" || host === "goo.gl" || host === "maps.app.goo.gl" ? s : null;
  } catch {
    return null;
  }
}

/** Ficha del lugar en Google Maps: el enlace guardado o la búsqueda oficial por place_id (Maps URLs, api=1). */
export function placeMapsUrl(p: { name: string; placeId: string | null; mapsUrl?: string | null }): string | null {
  const saved = savedMapsUrl(p.mapsUrl);
  if (saved) return saved;
  if (!p.placeId) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${encodeURIComponent(p.placeId)}`;
}

/** Lugares con nombre del plan (experiencias, restaurantes y hoteles), con su ficha de Google si la hay. */
export function tripPlaces(trip: any): DayPlace[] {
  const out: DayPlace[] = [];
  const cols: Array<[string, DayPlace["kind"]]> = [["tours_json", "experiencia"], ["restaurantes_json", "restaurante"], ["hospedaje_json", "hotel"]];
  for (const [col, kind] of cols) {
    for (const x of Array.isArray(trip?.[col]) ? trip[col] : []) {
      const name = clean(x?.nombre);
      if (name.length < 3 || /^(elegir|zona|hotel por elegir)\b/i.test(name)) continue;
      if (out.some((p) => norm(p.name) === norm(name))) continue;
      const placeId = isPlaceId(x?.place_id) ? x.place_id : null;
      const rating = Number(x?.rating);
      out.push({
        name, kind, ciudad: clean(x?.ciudad) || null, placeId,
        mapsUrl: placeMapsUrl({ name, placeId, mapsUrl: x?.maps_url }),
        rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null,
        porQue: clean(x?.por_que) || null,
      });
    }
  }
  return out;
}

const PARTS: Array<[DayPart, string]> = [["mañana", "Mañana"], ["tarde", "Tarde"], ["noche", "Noche"]];

/**
 * Mañana, tarde y noche del día en una línea cada una: el lugar del plan que menciona (el primero que
 * aparece; empatados, el nombre más largo) o su primera frase corta. El texto completo no cambia.
 * En un viaje de varias ciudades solo cuentan los lugares de la ciudad del día.
 */
export function daySlots(day: any, places: DayPlace[] = []): DaySlot[] {
  if (!day || day.pendiente) return [];
  const city = clean(day.ciudad);
  const pool = places.filter((p) => norm(p.name).length >= 4 && (!city || !p.ciudad || sameCity(p.ciudad, city) || norm(p.ciudad) === norm(city)));
  const out: DaySlot[] = [];
  for (const [part, label] of PARTS) {
    const text = clean(part === "mañana" ? day?.["mañana"] ?? day?.manana : day?.[part]);
    if (!text) continue;
    const nt = norm(text);
    const hit = pool
      .map((p) => ({ p, at: nt.indexOf(norm(p.name)) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at || b.p.name.length - a.p.name.length)[0];
    let headline = hit ? hit.p.name : firstClause(text, 80);
    let repeated = false;
    if (out.some((o) => norm(o.headline) === norm(headline))) {
      // Otra frase del mismo texto que aún no se haya dicho; si no hay, la franja repite a la anterior.
      const alt = text.split(/\.(?=\s|$)|;|:(?=\s)/).map((x) => firstClause(x, 80)).find((x) => x && !out.some((o) => norm(o.headline) === norm(x)));
      if (alt) headline = alt; else repeated = true;
    }
    out.push({ part, label, text, headline, place: hit?.p ?? null, ...(repeated ? { repeated } : {}) });
  }
  return out;
}

/**
 * «Ruta del día en Google Maps»: los lugares del día con ficha de Google, en orden. Google calcula ahí los
 * tiempos de traslado reales (a pie, transporte o coche). Solo con 2 lugares o más.
 */
export function dayRouteUrl(slots: DaySlot[]): string | null {
  const stops: DayPlace[] = [];
  for (const s of slots) if (s.place?.placeId && !stops.some((p) => p.placeId === s.place!.placeId)) stops.push(s.place);
  if (stops.length < 2) return null;
  const first = stops[0], last = stops[stops.length - 1], mid = stops.slice(1, -1);
  const qs = new URLSearchParams({ api: "1", origin: first.name, origin_place_id: first.placeId!, destination: last.name, destination_place_id: last.placeId! });
  if (mid.length) {
    qs.set("waypoints", mid.map((p) => p.name).join("|"));
    qs.set("waypoint_place_ids", mid.map((p) => p.placeId).join("|"));
  }
  return `https://www.google.com/maps/dir/?${qs.toString()}`;
}

const MODE_WORD: Record<string, string> = { vuelo: "Vuelo", tren: "Tren", coche: "Coche", bus: "Autobús", ferry: "Ferry" };

/**
 * Chips de transporte por día (clave: número de día). Vuelo de ida el día de salida (con la llegada), cada
 * tramo entre ciudades el primer día en la ciudad nueva y el regreso el último día.
 */
export function itineraryTransport(trip: any, days: CalendarDay[], steps: BuyStep[], opts: { byLand?: boolean; brought?: boolean } = {}): Record<number, DayChip[]> {
  const out: Record<number, DayChip[]> = {};
  if (!trip || !days.length) return out;
  const push = (dia: number | undefined, chip: DayChip) => {
    if (!dia) return;
    (out[dia] ??= []).push(chip);
  };
  const byDate = (iso: string | null | undefined) => (iso ? days.find((d) => d.fecha === iso)?.dia : undefined);
  const origen = clean(trip.ciudad_origen) || null;
  const salida = typeof trip.fecha_salida === "string" ? trip.fecha_salida : null;
  const regreso = typeof trip.fecha_regreso === "string" ? trip.fecha_regreso : null;
  const flightStep = steps.find((s) => s.kind === "vuelo") ?? null;
  const flightTarget = flightStep ? `paso-${flightStep.n}` : null;
  const dests = tripDestinations(trip);
  const lastCity = dests[dests.length - 1] ?? clean(trip.destino);

  if (!opts.brought && opts.byLand && flightStep) {
    const dest = dests[0] ?? clean(trip.destino);
    // Las opciones por tierra del plan, con su duración («Coche 2.2 h aprox. · Autobús 3.3 h aprox.»).
    const ground = (Array.isArray(trip.vuelos_json) ? trip.vuelos_json : []).filter((v: any) => v && typeof v === "object");
    const opciones = ground.map((v: any) => {
      const mode = transportModeOf(v.modo) ?? transportModeOf(v.mode);
      const word = (mode && GROUND_WORD[mode]) || null;
      const dur = shortDuration(v.duracion ?? v.duration);
      return word ? [word, dur].filter(Boolean).join(" ") : null;
    }).filter((x: string | null): x is string => !!x);
    push(byDate(salida) ?? 1, {
      kind: "vuelo", mode: "coche", text: `Cómo llegar: ${origen ? `${origen} → ` : ""}${dest}`,
      sub: opciones.length ? Array.from(new Set(opciones)).join(" · ") : "Coche o autobús: lo eliges en Comprar", target: flightTarget,
    });
    if (regreso && regreso !== salida && origen) push(byDate(regreso), { kind: "regreso", mode: "coche", text: `Regreso a ${origen}`, sub: null, target: flightTarget });
  } else if (!opts.brought) {
    const ob = tripOutbound(trip);
    if (ob && salida) {
      const arr = arrivalFromFlight(ob.times, salida);
      const route = `${origen ? `${origen} → ` : ""}${ob.firstCity}`;
      const sale = arr?.salidaHora ? `Sale ${arr.salidaHora}` : null;
      const llega = arr ? (arr.fecha === salida ? `llega ${arr.hora}` : `llega ${fmtDia(arr.fecha)}, ${arr.hora}`) : null;
      push(byDate(salida) ?? 1, {
        kind: "vuelo", mode: "vuelo", text: `Vuelo ${route}`,
        sub: sale || llega ? [sale, llega].filter(Boolean).join(" · ") + (arr?.calculada ? " (llegada calculada)" : " (hora local)") : "Horario: elígelo en Comprar",
        target: flightTarget,
      });
      // La llegada otro día ya la dice el chip de la ida («llega mar 11 may, 22:40») y el texto de ese día.
      if (regreso && regreso !== salida) {
        const from = clean(ob.row?.return_from) || lastCity;
        const hora = returnFromFlight(ob.times, regreso);
        push(byDate(regreso), {
          kind: "regreso", mode: "vuelo", text: `Vuelo de regreso ${from}${origen ? ` → ${origen}` : ""}`,
          sub: hora ? `Sale ${hora} (hora local)` : "Horario: elígelo en Comprar", target: flightTarget,
        });
      }
    }
  }

  for (const s of steps) {
    if (s.kind !== "traslado") continue;
    const choice = s.choices.find((c) => c.mode === s.chosen) ?? null;
    const word = choice?.label || (s.chosen ? MODE_WORD[s.chosen] : null) || "Traslado";
    const dia = days.find((d) => !d.pendiente && d.ciudad && sameCity(d.ciudad, s.to))?.dia ?? byDate(s.date);
    push(dia, {
      kind: "traslado", mode: s.chosen ?? "otro", text: `${word} ${s.from} → ${s.to}`,
      sub: choice?.duration ? `${choice.duration} aprox.${choice.provider ? ` · ${choice.provider}` : ""}` : choice?.provider ?? null,
      target: `paso-${s.n}`,
    });
  }
  return out;
}

/** «Unas 3.3 h puerta a puerta (aprox., incluye terminal)» → «3.3 h aprox.»; «1h 36m» → «1h 36m aprox.». */
export function shortDuration(v: unknown): string | null {
  const t = clean(v);
  if (!t) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(h|horas?)\b(?:\s*(\d{1,2})\s*m(?:in)?\b)?|(\d{1,3})\s*min\b/i.exec(t);
  if (!m) return null;
  const core = m[4] ? `${m[4]} min` : `${m[1]} h${m[3] ? ` ${m[3]} min` : ""}`;
  // Un rango («45-60 min», «2 - 3 horas») se deja como está para no esconder la parte alta.
  if (/\d\s*[-–]\s*\d/.test(t)) return `${t.replace(/\s*\(.*$/, "").replace(/\s*aprox\.?/i, "")} aprox.`;
  return `${core} aprox.`;
}

const GROUND_WORD: Record<string, string> = { tren: "Tren", coche: "Coche", auto: "Coche", bus: "Autobús", autobus: "Autobús", ferry: "Ferry", taxi: "Taxi", traslado: "Traslado", vuelo: "Vuelo", vuelo_interno: "Vuelo" };

/** «2 formas de llegar» · «Tren · 32 min» : una línea que resume las opciones por tierra de una ciudad. */
export function groundSummary(options: any[]): string {
  if (!options.length) return "";
  const first = options.find((o) => o?.quoted) ?? options[0];
  const mode = transportModeOf(first?.modo) ?? transportModeOf(first?.mode);
  const what = (mode && GROUND_WORD[mode]) || null;
  const head = [what, shortDuration(first?.duracion ?? first?.duration)].filter(Boolean).join(" · ");
  const n = options.length;
  return [head, n > 1 ? `${n} opciones` : null].filter(Boolean).join(" · ");
}
