// Portada del viaje (R4 viajes P2-2, Valle de Bravo): la portada guardada era la foto de Google de UN
// lugar (un pastel con velas sobre una cama con pétalos, «Foto: Google») y salía como encabezado del
// viaje y en «Próximo viaje» de Inicio. Una portada debe mostrar el destino: se prefiere la foto o el
// video de paisaje del destino (Pexels, con su leyenda «Imagen ilustrativa») sobre la foto de Google de
// un lugar cualquiera. Además, los términos de Google no permiten guardar en el servidor las fotos ni
// sus URLs (solo el id del lugar): analizar-viaje ya no guarda una foto de Google como portada y la app
// no usa las que quedaron guardadas en viajes viejos. Sin Deno (lo usan la app y Vitest).

const GOOGLE_PHOTO_HOST = /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$|(^|\.)gstatic\.com$/;

/** ¿Es una foto de Google (Places / Maps)? Esas no se guardan ni se usan como portada del destino. */
export function isGooglePhotoUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (GOOGLE_PHOTO_HOST.test(u.hostname)) return true;
  if (/(^|\.)googleapis\.com$/.test(u.hostname) && /\/(place|maps\/api\/place)\b|\/photo/i.test(u.pathname)) return true;
  // La propia función place-photo (proxy de Google).
  return /\/functions\/v1\/place-photo\b/.test(u.pathname);
}

/**
 * Portada que se puede mostrar como foto del destino: https y que no sea una foto de Google de un lugar.
 * null = la página usa la foto o el video del destino de Pexels (marcados como ilustrativos).
 */
export function destinationCoverUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const t = url.trim();
  if (!/^https:\/\//i.test(t) || isGooglePhotoUrl(t)) return null;
  return t;
}
