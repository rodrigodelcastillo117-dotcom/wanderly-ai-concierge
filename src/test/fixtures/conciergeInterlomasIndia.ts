// Bug real (23-oct-2026), Concierge PRO: el usuario estaba físicamente en Interlomas (Edo. Méx.) y
// tenía un viaje FUTURO a India. Pidió "restaurantes cercanos" y Iato recomendó restaurantes de India;
// al corregirlo, recomendó lugares locales pero siguió etiquetando la respuesta "sobre India".
//
// Datos de PRUEBA: nombres, place_id y hoteles ficticios (no se atribuyen datos a negocios reales).
// Lo usa src/test/conciergeContextoLugar.test.ts.
import { DATA_SENTINEL } from "../../../supabase/functions/concierge-chat/stream";

export const HOY = "2026-10-23";
export const INTERLOMAS = { lat: 19.3986, lng: -99.2746 };
export const LUGAR = "Interlomas";

/** Viaje futuro a India con hotel (el hotel es lo que se usaba como "cerca"). */
export const VIAJE_INDIA = {
  id: "11111111-2222-4333-8444-555555555555",
  destino: "India",
  pais_destino: "India",
  ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-12-05",
  fecha_regreso: "2026-12-20",
  num_viajeros: 2,
  hospedaje_json: [{ nombre: "Hotel de Prueba Delhi", ciudad: "Nueva Delhi", lat: 28.6139, lng: 77.209, check_in: "2026-12-05", check_out: "2026-12-09" }],
  vuelos_json: [],
};

/** Otro viaje, fijado como activo (para probar que "restaurantes en Nueva Delhi" no lo cambia). */
export const VIAJE_ROMA = {
  id: "66666666-7777-4888-9999-000000000000",
  destino: "Roma",
  pais_destino: "Italia",
  fecha_salida: "2026-11-10",
  fecha_regreso: "2026-11-15",
  num_viajeros: 2,
  hospedaje_json: [],
  vuelos_json: [],
};

/** Resultado simulado de search_nearby (forma de places-nearby) alrededor de Interlomas. */
export const LUGARES_INTERLOMAS = {
  ok: true, source: "google_maps",
  places: [
    { id: "ChIJPruebaInterlomas0001", name: "Cocina de Prueba Interlomas", address: "Av. de Prueba 10, Interlomas, Huixquilucan, Méx.", lat: 19.3991, lng: -99.2752, rating: 4.5, open_now: true, maps_url: "https://maps.google.com/?cid=301" },
    { id: "ChIJPruebaInterlomas0002", name: "Bistró Ejemplo", address: "Blvd. Ejemplo 22, Interlomas, Huixquilucan, Méx.", lat: 19.3975, lng: -99.2731, rating: 4.3, open_now: true, maps_url: "https://maps.google.com/?cid=302" },
  ],
};

/** Resultado simulado de search_places en Delhi. */
export const LUGARES_DELHI = {
  ok: true, source: "google_maps",
  results: [
    { id: "ChIJPruebaDelhi000000001", name: "Thali de Prueba", address: "Connaught Place, Nueva Delhi, India", lat: 28.6315, lng: 77.2167, rating: 4.6, open_now: true, maps_url: "https://maps.google.com/?cid=401" },
  ],
};

/** Respuesta simulada del modelo con cards locales y un "agregar a tu viaje" que no corresponde. */
export function respuestaLocal(tripId: string): string {
  const text = "Cerca de ti en Interlomas: **Cocina de Prueba Interlomas** (★4.5) y **Bistró Ejemplo** (★4.3), abiertos ahora según Google Maps.";
  const data = {
    cards: LUGARES_INTERLOMAS.places.map((p) => ({ type: "restaurant", title: p.name, subtitle: p.address, rating: p.rating })),
    actions: [{ type: "add_itinerary_item", params: { trip_id: tripId, fecha: HOY, hora: "20:30", titulo: "Cena en Bistró Ejemplo", lugar: "Bistró Ejemplo" } }],
  };
  return `${text}\n${DATA_SENTINEL}\n${JSON.stringify(data)}`;
}
