// Caché HTTP de place-photo (ronda 2 de la auditoría técnica, P2-11: ~900 llamadas facturables al día de
// una sola cuenta; cada navegador o pestaña nueva volvía a pagar la misma foto). Sin Deno: se prueba con
// Vitest (src/test/pulidoR2.test.tsx).
//
// Términos de Google Maps Platform: no se guardan bytes ni URLs de fotos de Google en nuestra base ni en
// ningún almacenamiento propio. Solo se le dice al NAVEGADOR (caché privada; la respuesta lleva la sesión)
// que puede reutilizar la respuesta un día, igual que Google sirve sus propias fotos de googleusercontent
// (Cache-Control: max-age=86400). El modo binario ya era público por un día y no cambia.
export const PHOTO_CACHE_SECONDS = 86_400;
/** Sin foto (el lugar no tiene, o no coincidió): se vuelve a preguntar antes, por si Google agrega una. */
export const NO_PHOTO_CACHE_SECONDS = 3_600;

export type PhotoResponseKind = "url" | "resolve" | "binary" | "error";

export function photoCacheControl(kind: PhotoResponseKind, hasPhoto = true): string {
  if (kind === "error") return "no-store";
  if (kind === "binary") return `public, max-age=${PHOTO_CACHE_SECONDS}`;
  return hasPhoto ? `private, max-age=${PHOTO_CACHE_SECONDS}` : `private, max-age=${NO_PHOTO_CACHE_SECONDS}`;
}
