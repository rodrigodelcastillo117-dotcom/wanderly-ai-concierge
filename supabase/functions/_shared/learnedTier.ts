// IATOS aprende del cliente (pedido del dueño, 11-nov-2026: «todo en base al usuario, eso es lo padre de IATOS, que
// aprende del cliente»): el nivel de hotel con el que arranca una cotización nueva sale de lo que la persona ELIGIÓ en
// sus viajes (trips.selections: el hotel que tocó en Comprar), no solo de lo que declaró en su perfil. Con 2 o más
// elecciones y un nivel claramente preferido (≥ 60 %), ese nivel manda. Sin Deno: se prueba con Vitest.
export type HotelTier = "ahorro" | "equilibrio" | "premium";
const TIERS = new Set<HotelTier>(["ahorro", "equilibrio", "premium"]);

/**
 * Nivel pedido en el texto de ESTE viaje («luna de miel… de lujo», «algo económico», «mochilero»): manda sobre lo
 * aprendido y el perfil (recorrido 11-nov-2026: «algo romántico y de lujo» arrancaba con el hotel equilibrado).
 */
export function tierFromTripText(text: unknown): HotelTier | null {
  const t = String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(sin lujos|nada de lujo|no (muy )?caro)\b/.test(t)) return /\b(barato|economic|mochiler|low cost|ahorr)/.test(t) ? "ahorro" : null;
  if (/\b(de lujo|lujos[oa]s?|luxury|5 estrellas|cinco estrellas|todo lo mejor|lo mejor de lo mejor|premium|vip|exclusiv[oa])\b/.test(t)) return "premium";
  if (/\b(barat[oa]s?|economic[oa]s?|mochiler[oa]s?|low cost|ahorrar|presupuesto (bajo|ajustado|limitado)|lo mas barato|sin gastar (tanto|mucho|demasiado)|gastar poco|gastando poco|con poco dinero)\b/.test(t)) return "ahorro";
  return null;
}

/** Nivel de hotel aprendido de las elecciones reales, o null si no hay suficientes. */
export function learnedHotelTier(trips: unknown): { tier: HotelTier; veces: number; de: number } | null {
  const counts: Record<HotelTier, number> = { ahorro: 0, equilibrio: 0, premium: 0 };
  let total = 0;
  for (const t of Array.isArray(trips) ? trips : []) {
    const list: any[] = Array.isArray((t as any)?.hospedaje_json) ? (t as any).hospedaje_json : [];
    const s = (t as any)?.selections;
    const picks: number[] = [];
    if (typeof s?.hospedaje?.i === "number" && s.hospedaje.i >= 0) picks.push(s.hospedaje.i);
    for (const h of Array.isArray(s?.hoteles) ? s.hoteles : []) if (typeof h?.i === "number" && h.i >= 0) picks.push(h.i);
    for (const i of picks) {
      const tier = String(list[i]?.tier ?? "") as HotelTier;
      if (!TIERS.has(tier)) continue; // «alternativa» y viejos sin nivel no cuentan
      counts[tier]++;
      total++;
    }
  }
  if (total < 2) return null;
  const [tier, veces] = (Object.entries(counts) as Array<[HotelTier, number]>).sort((a, b) => b[1] - a[1])[0];
  return veces / total >= 0.6 ? { tier, veces, de: total } : null;
}
