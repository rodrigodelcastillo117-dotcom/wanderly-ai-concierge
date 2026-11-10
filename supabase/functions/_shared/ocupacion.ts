// Quiénes viajan cuando hay niños (recorrido familia 9-nov-2026): «Cancún con mi esposa y nuestros 2 hijos de 6 y 9
// años» se cotizaba como 4 adultos en 2 habitaciones (Booking group_adults=4&no_rooms=2). Con las edades: 2 adultos +
// 2 niños (6 y 9) en 1 habitación, en Google Hotels y en Booking. Se guarda en itinerario_json.ocupacion (sin columna
// nueva). Puro: lo usan analizar-viaje, hotels-search y la app.

export type Ocupacion = { adultos: number; ninos: number[] };

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Edades válidas (0–17) y menos niños que viajeros; null si no hay niños o no cuadra. */
export function sanitizeOcupacion(ninos: unknown, total: unknown): Ocupacion | null {
  const T = Math.round(Number(total));
  if (!(T >= 2 && T <= 30)) return null;
  const ages = (Array.isArray(ninos) ? ninos : []).map((a) => Number(a)).filter((a) => Number.isInteger(a) && a >= 0 && a <= 17).slice(0, 10);
  if (!ages.length || ages.length >= T) return null;
  return { adultos: T - ages.length, ninos: ages };
}

/**
 * Porciones de comida: un niño de 12 años o menos cuenta como media porción (recorrido familia 10-nov-2026: la comida
 * de 2 adultos + niños de 5 y 10 años se estimaba como de 4 adultos).
 */
export function porcionesComida(ocupacion: Ocupacion | null | undefined, viajeros: number): number {
  if (!ocupacion) return viajeros;
  return ocupacion.adultos + ocupacion.ninos.reduce((s, a) => s + (a <= 12 ? 0.5 : 1), 0);
}

/** La ocupación guardada del viaje (si cuadra con num_viajeros). */
export function ocupacionDe(trip: { num_viajeros?: unknown; itinerario_json?: unknown } | null | undefined): Ocupacion | null {
  const it = trip?.itinerario_json;
  const o = it && typeof it === "object" && !Array.isArray(it) ? (it as Record<string, any>).ocupacion : null;
  return o ? sanitizeOcupacion(o.ninos, trip?.num_viajeros ?? (Number(o.adultos) || 0) + (Array.isArray(o.ninos) ? o.ninos.length : 0)) : null;
}

/** Habitaciones para la ocupación: una por cada 2 adultos; los niños van con ellos. */
export const habitacionesPara = (o: Ocupacion) => Math.max(1, Math.ceil(o.adultos / 2));

const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const n = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM[w] ?? NaN);

/**
 * Edades de los niños escritas en la frase: «hijos de 6 y 9 años», «2 niños (4 y 7 años)», «un bebé de 1 año»,
 * «mi hija de 12». [] si no las dice (no se inventan).
 */
export function edadesNinos(text: unknown): number[] {
  const t = norm(text);
  const out: number[] = [];
  const re = /\b(?:hij[oa]s?|nin[oa]s?|bebes?|niet[oa]s?|sobrin[oa]s?|menores|peques)\b[^.;]{0,25}?(?:\(|\bde\s+)((?:(?:\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s*(?:,|y|e)\s*)?)+)\s*(?:anos?|ano|\)|$|[,.;])/g;
  for (const m of t.matchAll(re)) {
    for (const w of m[1].split(/\s*(?:,|\by\b|\be\b)\s*/)) {
      const a = n(w.trim());
      if (Number.isInteger(a) && a >= 0 && a <= 17) out.push(a);
    }
  }
  if (/\bbebes?\b/.test(t) && !out.length && /\b(?:un|una|mi|nuestro|nuestra)\s+bebe\b/.test(t)) out.push(1);
  return out.slice(0, 10);
}
