// Los 3 hoteles por ciudad (ahorro · equilibrio · premium) de la lista en vivo de Google Hotels, ordenada por precio.
// Premium = la categoría de estrellas más alta, el más caro de esa categoría, PERO sin pasar de 4× el equilibrio
// (recorrido familia 10-nov-2026: «Hacienda Santa Cruz» en Mérida a $167,092 MXN la noche, 37× el del medio: renta de
// la hacienda completa, no un hotel premium).
export const PREMIUM_MAX_X_MID = 4;

export function pickCityHotels<T extends { nightly_usd?: unknown; hotel_class?: unknown }>(sortedAsc: T[]): { cheap?: T; mid?: T; top?: T } {
  const cheap = sortedAsc[0];
  if (!cheap) return {};
  const mid = sortedAsc[Math.floor(sortedAsc.length / 2)] ?? cheap;
  const cap = Number(mid.nightly_usd) * PREMIUM_MAX_X_MID;
  const sane = sortedAsc.filter((h) => Number(h.nightly_usd) <= cap);
  const pool = sane.length ? sane : sortedAsc;
  const maxClass = Math.max(...pool.map((h) => Number(h.hotel_class) || 0));
  const topPool = maxClass > 0 ? pool.filter((h) => (Number(h.hotel_class) || 0) === maxClass) : pool;
  const top = topPool[topPool.length - 1] ?? pool[pool.length - 1] ?? mid;
  return { cheap, mid, top };
}
