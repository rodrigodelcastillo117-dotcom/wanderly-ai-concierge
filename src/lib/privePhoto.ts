/**
 * Fotos de IATOS Privé (Pexels por pexels-image), con las reglas de images_pexels.md: ilustrativas,
 * con crédito, en caché y bajo el límite.
 *
 * Por qué existe (dueño, 2026-10-22: "no salieron fotos en algunos"): la bienvenida y las tarjetas de
 * Privé llamaban a pexels-image por su cuenta, sin la fila de stockPhoto.ts (20/min, 3 a la vez,
 * pausa tras 429). Seis fotos de golpe + las del resto de la app pasaban el límite del servidor
 * (30/min por persona, contando también aciertos de caché) y lo que volvía 429 o con Pexels caído
 * (200 + image:null) se quedaba como "sin foto" para siempre: tarjeta negra con la "P". Ahora:
 *   - todo pasa por loadStockPhoto (misma fila, misma caché de sesión que el resto de IATOS);
 *   - cada destino trae varias consultas (curada → "<ciudad> <país>" → "<ciudad>");
 *   - un fallo temporal NO se recuerda: se reintenta con espera creciente;
 *   - solo si ninguna consulta tiene foto se usa el respaldo de marca.
 */
import { cachedStockPhoto, loadStockPhoto, type StockPhoto } from "@/lib/stockPhoto";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";

export type PrivePhotoStatus = "ok" | "none" | "retry";
export type PrivePhotoResult = { photo: StockPhoto | null; status: PrivePhotoStatus };

/** Esperas antes de reintentar un fallo temporal (429 / Pexels caído / red). Después: respaldo. */
export const PRIVE_PHOTO_RETRY_MS = [4_000, 15_000, 45_000] as const;

const clean = (queries: readonly (string | null | undefined)[]) =>
  [...new Set(queries.map((q) => (q ?? "").trim().slice(0, 100)).filter(Boolean))];

/** Lo que ya se sabe sin llamar: foto, null (ninguna consulta tiene foto) o undefined (hay que pedir). */
export function cachedPrivePhoto(queries: readonly (string | null | undefined)[]): StockPhoto | null | undefined {
  for (const q of clean(queries)) {
    const c = cachedStockPhoto(q);
    if (c === undefined) return undefined;
    if (c) return c;
  }
  return null;
}

/** Prueba las consultas en orden. Un fallo temporal corta la cadena (las demás fallarían igual). */
export async function loadPrivePhoto(queries: readonly (string | null | undefined)[]): Promise<PrivePhotoResult> {
  for (const q of clean(queries)) {
    const r = await loadStockPhoto(q);
    if (r.photo) return { photo: r.photo, status: "ok" };
    if (r.transient) return { photo: null, status: "retry" };
  }
  return { photo: null, status: "none" };
}

/** Consultas de portada de un destino de prive_home (slug + nombre en español). */
export function destinationPhotoQueries(slug: string, name?: string | null, coverQuery?: string | null): string[] {
  const meta = PRIVE_DESTINATION_INDEX[slug];
  return clean([coverQuery, ...(meta?.q ?? []), meta ? null : name ? `${name} city` : null, meta ? null : name]);
}
