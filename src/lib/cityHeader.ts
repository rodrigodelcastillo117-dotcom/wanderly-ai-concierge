/**
 * Subtítulo del encabezado de cada destino en "Tu viaje por destino" (pendiente E2E 28-oct-2026): antes
 * decía "· días de itinerario · 2 por tierra" junto a una etiqueta "4 opciones" que sumaba días del
 * itinerario con opciones de transporte. Ahora cada dato dice qué es y lo que no hay no se escribe.
 */
export function citySubtitle(p: { nights?: number | null; days?: number | null; ground?: number | null }): string {
  const parts: string[] = [];
  const n = Number(p.nights) || 0;
  if (n > 0) parts.push(`${n} ${n === 1 ? "noche" : "noches"}`);
  const d = Number(p.days) || 0;
  if (d > 0) parts.push(`${d} ${d === 1 ? "día" : "días"} de itinerario`);
  const g = Number(p.ground) || 0;
  if (g > 0) parts.push(`${g} ${g === 1 ? "forma" : "formas"} de llegar por tierra`);
  return parts.join(" · ");
}
