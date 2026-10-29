// Tarjetas "Destinos que matchean tu perfil" de Inicio (auditoría 28-oct-2026).
//  - Un toque NUNCA genera un viaje: lleva a Planear con el destino puesto y fechas sugeridas visibles y
//    editables; el análisis corre solo cuando la persona pulsa «Armar mi viaje» (antes ?autoCheapest=1
//    disparaba analizar-viaje y creó Budapest y Liubliana sin preguntar).
//  - Van ordenadas por match (antes un 76% salía antes que un 96%).
import type { AIRecommendation } from "@/hooks/useAIRecommendations";

/** Enlace de una recomendación a Planear (sugerencia, sin generar nada). */
export function recoPlanHref(d: Pick<AIRecommendation, "name" | "country">): string {
  const qs = new URLSearchParams({ destino: d.name });
  if (d.country) qs.set("pais", d.country);
  qs.set("sugerencia", "1");
  return `/dashboard/planear?${qs.toString()}`;
}

/** Mayor match primero; empate: el orden en que llegaron (estable). */
export function sortRecosByMatch<T extends { score?: number | null }>(recos: T[]): T[] {
  return recos.map((r, i) => [r, i] as const)
    .sort((a, b) => (Number(b[0].score) || 0) - (Number(a[0].score) || 0) || a[1] - b[1])
    .map(([r]) => r);
}
