// Road trip en Iato (grupo roadtrip). Lógica pura, sin modelo: el planeador del turno la usa cuando
// el mensaje pide un road trip ("quiero hacer un road trip por la Toscana en 7 días"). No es otro
// chatbot: agrega notas (datos con fuente) al contexto del turno y una card con enlaces armados por
// IATOS (Google Maps y la ruta de varios destinos con el coche ya elegido). Sin llamadas de API: las
// distancias son ESTIMADAS (línea recta × 1.3); las reales salen al generar la ruta en IATOS.
import { DEFAULT_ORIGIN } from "../_shared/origin.ts";
import { CURATED_ROUTES } from "../_shared/roadtrip/data.ts";
import { buildRoadTripPlan, detectRoadTrip, mapsDrivingUrl, routePlannerPath, splitDays, uniqueStops } from "../_shared/roadtrip/plan.ts";

export type RoadTripTurn = { notes: string[]; cards: Record<string, unknown>[] };

const money = (n: number, cur: string) => `${n.toLocaleString("es-MX", { maximumFractionDigits: 2 })} ${cur}`;

export function roadTripTurn(message: string): RoadTripTurn | null {
  const intent = detectRoadTrip(message);
  if (!intent.isRoadTrip && !intent.route) return null;
  const r = intent.route;
  if (!r) {
    return {
      notes: [
        "El usuario quiere un road trip pero no dijo la región. Pregunta en una línea por dónde y cuántos días; ofrece estas rutas curadas con fuente oficial: " +
          CURATED_ROUTES.map((x) => x.name).join("; ") + ".",
      ],
      cards: [],
    };
  }
  const days = intent.days ?? r.days_suggested;
  const stops = r.stops;
  const plan = buildRoadTripPlan({ stops, legModes: stops.slice(1).map(() => "coche") });
  const reparto = splitDays(r, days).map((d) => `Día ${d.day}: ${d.stops.join(" + ")}`).join("; ");
  const tramos = (plan?.legs ?? []).map((l) => `${l.from} → ${l.to}: ${l.distance_km ?? "?"} km, ~${l.duration_min ? Math.round((l.duration_min / 60) * 10) / 10 : "?"} h (ESTIMADO)`).join("; ");
  const fuel = (plan?.costs ?? []).filter((c) => c.id.startsWith("combustible-total") && c.monto !== null)
    .map((c) => `${money(c.monto!, c.moneda!)} (ESTIMADO; ${c.detalle} Fuente: ${c.fuente?.label}, ${c.fuente?.url})`).join("; ");
  const vinetas = (plan?.costs ?? []).filter((c) => c.id.startsWith("vineta-"))
    .map((c) => `${c.concepto}: ${money(c.monto!, c.moneda!)} (precio oficial; ${c.fuente?.url}, consultado ${c.fuente?.consulted_at})`).join("; ");
  const avisos = (plan?.notices ?? []).map((n) => `${n.title} — ${n.body} (fuente: ${n.sources.map((s) => s.url).join(", ")}, consultada ${n.sources[0]?.consulted_at})`).join(" | ");
  const loop = r.stops[0] === r.stops[r.stops.length - 1];
  const notes = [
    `ROAD TRIP EN COCHE (ruta curada "${r.name}", fuente oficial: ${r.source.label} — ${r.source.url}, consultada ${r.source.consulted_at}). Paradas en orden: ${stops.join(" → ")}.` +
      ` Días: ${intent.days ? `${days} (los pidió el usuario)` : `${days} (sugerencia IATOS)`}${r.days_source ? `; la fuente propone ${r.days_source.min === r.days_source.max ? r.days_source.min : `${r.days_source.min}–${r.days_source.max}`}` : ""}.` +
      ` Mejor época: ${r.best_season.text} (${r.best_season.from === "fuente" ? "según la fuente" : "sugerencia IATOS, no viene de la fuente"}).${r.distance_source ? ` Distancia según la fuente: ${r.distance_source}.` : ""}`,
    `Reparto sugerido: ${reparto}. Recoger el auto: ${r.pickup_hint} (sugerencia IATOS)${loop ? "; es un circuito, se devuelve donde se recoge" : `; devolver en ${stops[stops.length - 1]} implica cargo por devolución en otro lugar (el monto lo da la arrendadora, NO lo inventes)`}.`,
    `Tramos (distancia en línea recta × 1.3, ESTIMADO, no es dato de Google): ${tramos}.`,
    `Costos del coche: combustible ${fuel || "por confirmar"}${vinetas ? `; viñetas: ${vinetas}` : ""}; renta POR COTIZAR (sin tarifa en vivo); casetas y estacionamiento POR CONFIRMAR. No des otros montos.`,
    avisos ? `Avisos por país (cítalos con su fuente): ${avisos}` : "",
    "Propón la ruta día por día con estos datos, di qué es estimado y ofrece la card 'Planear en IATOS' para cotizar con distancias reales y reservar el auto. No emitas otra card de transporte.",
  ].filter(Boolean);
  const card = {
    type: "transport",
    title: `Road trip: ${r.name}`,
    subtitle: `${days} días · ${uniqueStops(r).join(" → ")}`,
    meta: "Distancias estimadas. Al planear en IATOS se calculan con Google Maps y puedes reservar el auto (recogida y devolución precargadas).",
    links: [
      { kind: "website", label: "Planear en IATOS", url: `${DEFAULT_ORIGIN}${routePlannerPath(r, days)}` },
      { kind: "directions", label: "Ruta en Google Maps", url: mapsDrivingUrl(stops) },
      { kind: "website", label: "Fuente oficial", url: r.source.url },
    ],
  };
  return { notes, cards: [card] };
}
