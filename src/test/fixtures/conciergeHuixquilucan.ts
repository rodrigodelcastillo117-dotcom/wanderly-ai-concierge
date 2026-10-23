// Caso real del dueño (22-oct-2026), Concierge PRO: estaba en Huixquilucan (CDMX) el día que salía
// su viaje Roma → Florencia → Venecia ("Viaje en contexto: Automático · Roma → Florencia → Venecia ·
// en curso"). Pidió "Cena cerca". Iato respondió 3 párrafos largos (restaurantes en Pirules, una nota
// sobre mariscos y "tu vuelo sale en el día: haz check-in…") y propuso "Agregar a tu viaje a Roma →
// Florencia → Venecia: Cena · jue 22 de oct 20:30" para un restaurante de CDMX.
//
// Lo usan las pruebas (src/test/conciergeUbicacion.test.ts) y las capturas
// (scripts/concierge/make_ui_fixture.ts). Los lugares son de PRUEBA (nombres ficticios): no se
// atribuyen calificaciones a negocios reales.
import { CASO_TRIP } from "./casoRomaFlorenciaVenecia";
import { DATA_SENTINEL } from "../../../supabase/functions/concierge-chat/stream";

export const HOY = "2026-10-22";
export const HUIXQUILUCAN = { lat: 19.3606, lng: -99.3509 };
export const LUGAR = "Huixquilucan";
export const ROMA_CENTRO = { lat: 41.9009, lng: 12.4833 };

/** El viaje del caso, tal cual, con un vuelo de hoy para probar el consejo de check-in que nadie pidió. */
export const VIAJE = CASO_TRIP;
export const VIAJE_CON_VUELO_HOY = {
  ...CASO_TRIP,
  vuelos_json: [
    ...CASO_TRIP.vuelos_json,
    { aerolinea: "Aeroméxico", numero_vuelo: "AM 006", fecha: HOY, from: "MEX", to: "FCO", hora_salida: "21:40", estado_reserva: "reservado" },
  ],
};

/** Texto del botón "Cena cerca" con el usuario fuera de los destinos del viaje (conciergeChips). */
export const CENA_CERCA = "¿Dónde ceno hoy cerca de donde estoy? Dame 3 opciones abiertas con cómo llegar.";

/** Resultado simulado de search_nearby (forma real de places-nearby) alrededor de Huixquilucan. */
export const LUGARES_LOCALES = {
  ok: true, source: "google_maps",
  places: [
    { name: "La Mesa de Prueba", address: "Av. de Prueba 41, Interlomas, Huixquilucan, Méx.", lat: 19.3986, lng: -99.2746, rating: 4.6, open_now: true, maps_url: "https://maps.google.com/?cid=101" },
    { name: "Cocina Ejemplo", address: "Blvd. Ejemplo 120, Pirules, Huixquilucan, Méx.", lat: 19.3893, lng: -99.2861, rating: 4.4, open_now: true, maps_url: "https://maps.google.com/?cid=102" },
    { name: "Bistró Simulado", address: "Calle Simulada 8, Huixquilucan, Méx.", lat: 19.3712, lng: -99.3311, rating: 4.5, open_now: true, maps_url: "https://maps.google.com/?cid=103" },
  ],
};

/** Restaurante simulado en Roma (cuando el usuario sí está en el destino). */
export const LUGARES_ROMA = {
  ok: true, source: "google_maps",
  results: [
    { id: "r1", name: "Trattoria de Prueba", address: "Via di Prova 12, Roma, Italia", lat: 41.8986, lng: 12.4769, rating: 4.7, open_now: true, maps_url: "https://maps.google.com/?cid=201" },
  ],
};

/**
 * Lo que respondió el modelo en producción (reconstruido): 3 párrafos largos, mariscos sin que los
 * pidiera, consejo de check-in, y "agregar a tu viaje" un restaurante de CDMX.
 */
export function respuestaLargaDelModelo(tripId: string): string {
  const text = [
    "¡Claro! Para cenar hoy cerca de donde estás, en la zona de Pirules e Interlomas tienes buenas opciones abiertas ahora según Google Maps: **La Mesa de Prueba** (★4.6), con cocina mexicana contemporánea y terraza; **Cocina Ejemplo** (★4.4), más casual y rápida; y **Bistró Simulado** (★4.5), un bistró tranquilo ideal para platicar. Todas están a menos de 15 minutos en auto.",
    "",
    "Si te gustan los mariscos, en la zona hay varias marisquerías que suelen llenarse los jueves por la noche, así que conviene llegar temprano o reservar; también puedes pedir para llevar si prefieres no salir. Los precios por persona suelen ir de $400 a $900 MXN dependiendo del lugar y de si pides vino.",
    "",
    "Recuerda que tu vuelo sale en el día: haz check-in en línea desde ahora y llega al aeropuerto 3 horas antes. Te recomiendo cenar temprano para no ir con prisas y dejar tu maleta lista. Si quieres, te agrego la cena a tu viaje a Roma → Florencia → Venecia y te paso el Uber.",
  ].join("\n");
  const data = {
    cards: LUGARES_LOCALES.places.map((p) => ({ type: "restaurant", title: p.name, subtitle: p.address, rating: p.rating, meta: "Abierto ahora" })),
    actions: [{ type: "add_itinerary_item", params: { trip_id: tripId, fecha: HOY, hora: "20:30", titulo: "Cena en La Mesa de Prueba", lugar: "La Mesa de Prueba" } }],
  };
  return `${text}\n${DATA_SENTINEL}\n${JSON.stringify(data)}`;
}
