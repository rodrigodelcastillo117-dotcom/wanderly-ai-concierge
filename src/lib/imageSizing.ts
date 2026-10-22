/**
 * Fotos de terceros al ancho que se va a pintar (Rendimiento, cierre 2026-10).
 *
 * Por qué: la portada del viaje se guarda como foto de Google a 1600×900 ("=w1600-h900-k-no",
 * analizar-viaje) y en el inicio del móvil se descargaban 364 KB para una caja de 390 px oscurecida
 * al 80 %; las fotos ilustrativas de Pexels llegan a 1200 px aunque la tarjeta mida 180. Los tres
 * servicios sirven el tamaño que se les pide en la URL:
 *   - Google (googleusercontent / ggpht): sufijo "=w<ancho>-..." al final de la ruta.
 *   - Pexels: parámetros w y h (se escala h para conservar el recorte).
 *   - Unsplash: parámetro w.
 * Solo se ACHICA una URL que ya trae su tamaño y pide más del necesario; si no trae tamaño, si ya
 * pide algo menor o si es de otro servicio, queda igual.
 */

const GOOGLE_HOST = /(^|\.)googleusercontent\.com$|(^|\.)ggpht\.com$/;

export function sizedPhotoUrl(url: string, width: number): string {
  const w = Math.round(width);
  if (!url || !Number.isFinite(w) || w <= 0) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:") return url;

  if (GOOGLE_HOST.test(u.hostname)) {
    const path = u.pathname;
    const eq = path.lastIndexOf("=");
    if (eq <= path.lastIndexOf("/")) return url;
    const params = path.slice(eq + 1);
    if (!/^[a-z0-9-]+$/i.test(params)) return url;
    const cur = /(?:^|-)[ws](\d+)/.exec(params);
    if (!cur || Number(cur[1]) <= w) return url;
    u.pathname = `${path.slice(0, eq)}=w${w}-k-no`;
    return u.toString();
  }

  if (u.hostname === "images.pexels.com" || u.hostname === "images.unsplash.com") {
    const cw = Number(u.searchParams.get("w"));
    if (!Number.isFinite(cw) || cw <= w) return url;
    const ch = Number(u.searchParams.get("h"));
    u.searchParams.set("w", String(w));
    if (cw > 0 && Number.isFinite(ch) && ch > 0) u.searchParams.set("h", String(Math.round((ch * w) / cw)));
    return u.toString();
  }
  return url;
}
