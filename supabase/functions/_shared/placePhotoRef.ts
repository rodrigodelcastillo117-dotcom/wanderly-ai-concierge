// Nombre de foto de Google Places (API New): "places/<placeId>/photos/<photoId>". Sin Deno: se
// prueba con Vitest (src/test/placePhoto.test.ts).
export function isPhotoRef(ref: unknown): ref is string {
  return typeof ref === "string" && ref.length <= 1200 && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(ref);
}
