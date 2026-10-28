// Tramos por mar del plan multidestino (crucero o ferry). Sin Deno: se prueba con Vitest.
//
// Un crucero no es una ciudad ni un vuelo: es cómo se llega de una parada (puerto de embarque) a la
// siguiente (puerto de desembarque). Sus noches son a bordo, así que no llevan hotel: las noches de las
// ciudades son las del viaje menos las del crucero, y la ciudad que sigue empieza cuando el barco llega.
// El precio NUNCA lo pone la IA ni el sistema: se cotiza con la naviera (no suma al total).
// Los vuelos para llegar al puerto y salir del puerto de desembarque son tramos normales del plan.

export type SeaLegIn = {
  index?: unknown; tipo?: unknown; naviera?: unknown; puerto_salida?: unknown; puerto_llegada?: unknown;
  fecha_salida?: unknown; fecha_llegada?: unknown; noches?: unknown;
};

export type SeaLeg = {
  index: number;
  tipo: "crucero" | "ferry";
  from: string;
  to: string;
  naviera: string | null;
  puerto_salida: string;
  puerto_llegada: string;
  fecha_salida: string | null;
  fecha_llegada: string | null;
  noches: number;
  precio: null;
  precio_estado: "por_cotizar_con_naviera" | "por_cotizar";
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const s = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const iso = (v: unknown) => (typeof v === "string" && ISO.test(v) ? v : null);

/** Tramos por mar válidos (índice dentro de los tramos entre destinos, uno por índice). */
export function normalizeSeaLegs(raw: unknown, destinations: string[]): SeaLeg[] {
  if (!Array.isArray(raw)) return [];
  const out: SeaLeg[] = [];
  const seen = new Set<number>();
  for (const r of raw as SeaLegIn[]) {
    const index = Number(r?.index);
    if (!Number.isInteger(index) || index < 0 || index >= destinations.length - 1 || seen.has(index)) continue;
    const tipo = r?.tipo === "ferry" ? "ferry" : "crucero";
    const fs = iso(r?.fecha_salida), fl = iso(r?.fecha_llegada);
    const byDates = fs && fl && fl > fs ? Math.round((Date.parse(`${fl}T00:00:00Z`) - Date.parse(`${fs}T00:00:00Z`)) / 86400000) : null;
    const n = Number(r?.noches);
    const noches = tipo === "ferry" ? 0 : (byDates ?? (Number.isInteger(n) && n >= 0 && n <= 120 ? n : 0));
    seen.add(index);
    out.push({
      index, tipo, from: destinations[index], to: destinations[index + 1],
      naviera: s(r?.naviera, 60),
      puerto_salida: s(r?.puerto_salida) ?? destinations[index], puerto_llegada: s(r?.puerto_llegada) ?? destinations[index + 1],
      fecha_salida: fs, fecha_llegada: fl, noches,
      precio: null, precio_estado: tipo === "crucero" ? "por_cotizar_con_naviera" : "por_cotizar",
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

export const seaNights = (legs: SeaLeg[]) => legs.reduce((a, l) => a + l.noches, 0);

/** Noches a bordo después de la ciudad i (antes de llegar a la i+1). */
export const seaNightsAfter = (legs: SeaLeg[], i: number) => legs.find((l) => l.index === i)?.noches ?? 0;

/** Bloque obligatorio para el prompt global. */
export function seaPromptBlock(legs: SeaLeg[]): string {
  if (!legs.length) return "";
  const lines = legs.map((l) => `- ${l.from} → ${l.to}: ${l.tipo === "crucero" ? "CRUCERO" : "FERRY"} de ${l.puerto_salida} a ${l.puerto_llegada}${l.naviera ? ` con ${l.naviera}` : ""}${l.noches ? `, ${l.noches} noches a bordo` : ""}${l.fecha_salida ? `, sale ${l.fecha_salida}` : ""}${l.fecha_llegada ? `, llega ${l.fecha_llegada}` : ""}.`);
  return `\n\nTRAMOS POR MAR (OBLIGATORIO; mandan sobre cualquier modo de arriba):
${lines.join("\n")}
- En internal_transport ese tramo va con mode="${legs.some((l) => l.tipo === "crucero") ? "crucero" : "ferry"}" (o "ferry"), provider = la naviera si se dijo (si no, "Naviera por confirmar") y SIN precio (price_per_person_usd = 0): el crucero se cotiza con la naviera.
- NO inventes el itinerario del crucero, sus escalas, el barco ni la naviera. Los días a bordo van como "A bordo del crucero" sin actividades inventadas.
- Llegar al puerto de salida y salir del puerto de llegada son tramos normales (vuelo, tren o coche).`;
}

/** Tramo internal_transport del mar: sin precio y con el modo correcto, aunque el modelo diga otra cosa. */
export function applySeaLegs(internal: any[], legs: SeaLeg[], norm: (s: unknown) => string): any[] {
  if (!legs.length) return internal;
  const key = (a: unknown, b: unknown) => `${norm(a)}|${norm(b)}`;
  const byPair = new Map(legs.map((l) => [key(l.from, l.to), l]));
  const out = (Array.isArray(internal) ? internal : []).filter((t) => !byPair.has(key(t?.from, t?.to)));
  for (const l of legs) {
    out.push({
      from: l.from, to: l.to, mode: l.tipo, provider: l.naviera ?? "Naviera por confirmar",
      duration: l.noches ? `${l.noches} noches` : "", price_per_person_usd: 0, precio: null,
      fuente_precio: "por_cotizar", precio_estado: l.precio_estado,
      notes: `${l.tipo === "crucero" ? "Crucero" : "Ferry"} ${l.puerto_salida} → ${l.puerto_llegada}. Precio por cotizar con la naviera; no suma al total.`,
    });
  }
  return out;
}
