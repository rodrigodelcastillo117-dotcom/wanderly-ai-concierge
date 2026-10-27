// Caso real del dueño (27-oct-2026): "viaje con mi novia de viernes a domingo a Tepoztlán desde CDMX".
// trips.id 6e74033e-1417-4589-b3c3-e822cf008353 (30 oct – 1 nov 2026, 2 viajeros).
//
// SIMULADO a partir de lo guardado que reportó el dueño (no se leyó la fila de producción):
//  - vuelos_json: 3 opciones por tierra con precios de la IA (autobús ADO $1,000, auto propio $1,800 y
//    chofer $3,400 para 2 personas), bajo el título "Vuelo";
//  - hospedaje_json: UN hotel, "The Red Tree House" (serpapi), $13,347 por noche → $26,694 por 2 noches;
//  - desglose_presupuesto: {vuelos: 1800, hospedaje: 26694, comida: 5200, tours: 1500, transporte_local: 1200, extras: 956};
//  - tours_json: Zócalo, Parroquia, Cascada de los Venaditos y Tepozteco, sin foto (la cascada con "$50" de la IA).
// TEPOZ_NUEVO es el mismo viaje como lo guarda analizar-viaje después del arreglo (con las funciones
// puras del servidor y una consulta de casetas SIMULADA con la forma de Google Routes).
import liveSearch from "./ghotels/tepoztlan_search.json";
import { carCost } from "../../../supabase/functions/_shared/carCost";
import type { TollQuote } from "../../../supabase/functions/_shared/tollQuote";
import { applyShortTripRules, capShortTripEstimates, detectShortTrip, groundSearchLinks, realGroundOptions, refineShortTrip, shortTripTransportTotal } from "../../../supabase/functions/analizar-viaje/groundTransport";
import { buildHotelTiers } from "../../../supabase/functions/analizar-viaje/hotelTiers";
import { reconcileBudget } from "../../../supabase/functions/analizar-viaje/budget";
import { adoRouteUrl } from "../../../supabase/functions/_shared/booking/groundLinks";
import { searchHotels } from "../../../supabase/functions/hotels-search/search";

export const TEPOZ_ID = "6e74033e-1417-4589-b3c3-e822cf008353";
export const TEPOZ_CREATED = "2026-10-27T15:20:00.000Z";
export const TEPOZ_FX = 18.41;

const toursIa = [
  { nombre: "Zócalo de Tepoztlán", duracion: "1 h", precio_por_persona: 0, por_que: "Mercado y ambiente del pueblo.", fuente: "estimado", estado_dato: "ESTIMADO" },
  { nombre: "Parroquia de la Natividad", duracion: "1 h", precio_por_persona: 0, por_que: "Exconvento dominico del siglo XVI.", fuente: "estimado", estado_dato: "ESTIMADO" },
  { nombre: "Cascada de los Venaditos", duracion: "3 h", precio_por_persona: 50, por_que: "Caminata entre el bosque.", fuente: "estimado", estado_dato: "ESTIMADO" },
  { nombre: "Pirámide del Tepozteco", duracion: "3 h", precio_por_persona: 120, por_que: "La subida clásica con vista al valle.", fuente: "google_places", estado_dato: "ESTIMADO", rating: 4.7, num_reviews: 25000 },
];

const restaurantes = [
  { nombre: "Los Colorines", cocina: "Mexicana", rango_precio: "$$", rating: 4.5, num_reviews: 5200, fuente: "google_places", place_id: "ChIJ_colorines" },
  { nombre: "Tepoznieves", cocina: "Nieves artesanales", rango_precio: "$", rating: 4.6, num_reviews: 3100, fuente: "google_places", place_id: "ChIJ_nieves" },
];

const base = {
  id: TEPOZ_ID, user_id: "owner-1", destino: "Tepoztlán", pais_destino: "México", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", num_viajeros: 2, created_at: TEPOZ_CREATED, status: "listo", moneda: "MXN",
  restaurantes_json: restaurantes, tours_json: toursIa, itinerario_json: [
    { dia: 1, titulo: "Llegada y centro", "mañana": "Salida de CDMX por la México–Cuernavaca.", tarde: "Zócalo y mercado.", noche: "Cena en Los Colorines." },
    { dia: 2, titulo: "Tepozteco", "mañana": "Subida al Tepozteco.", tarde: "Parroquia de la Natividad.", noche: "Nieves en Tepoznieves." },
    { dia: 3, titulo: "Cascada y regreso", "mañana": "Cascada de los Venaditos.", tarde: "Regreso a CDMX.", noche: "" },
  ],
};

/** Como quedó guardado en producción (antes del arreglo). */
export const TEPOZ_GUARDADO: any = {
  ...base,
  total_estimado: 37350,
  vuelos_json: [
    { tier: "ahorro", modo: "autobus", aerolinea: "Autobús ADO", duracion: "1 h 30 min", escalas: "Terrestre", precio_por_persona: 500, precio_min: 400, precio_max: 600,
      fuente_precio: "estimado", estado_dato: "ESTIMADO", booking_link: "https://www.google.com/maps/dir/?api=1&origin=Ciudad+de+M%C3%A9xico&destination=Tepoztl%C3%A1n&travelmode=transit",
      notas: "Desde Terminal Taxqueña. Precio estimado; confírmalo en el buscador." },
    { tier: "equilibrio", modo: "auto", aerolinea: "Auto propio", duracion: "1 h 20 min", escalas: "Terrestre", precio_por_persona: 900, precio_min: 800, precio_max: 1000,
      fuente_precio: "estimado", estado_dato: "ESTIMADO", booking_link: "https://www.google.com/maps/dir/?api=1&origin=Ciudad+de+M%C3%A9xico&destination=Tepoztl%C3%A1n&travelmode=driving",
      notas: "Gasolina y casetas. Precio estimado; confírmalo en el buscador." },
    { tier: "premium", modo: "auto", aerolinea: "Chofer privado", duracion: "1 h 20 min", escalas: "Terrestre", precio_por_persona: 1700, precio_min: 1500, precio_max: 1900,
      fuente_precio: "estimado", estado_dato: "ESTIMADO", booking_link: "https://www.google.com/maps/dir/?api=1&origin=Ciudad+de+M%C3%A9xico&destination=Tepoztl%C3%A1n&travelmode=driving" },
  ],
  hospedaje_json: [
    { nombre: "The Red Tree House", tipo: "Boutique", barrio: "Centro", rating: 4.8, precio_por_noche: 13347, por_que: "Boutique con jardín.",
      fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: TEPOZ_CREATED, property_token: "TOKEN_RED_TREE" },
  ],
  desglose_presupuesto: { vuelos: 1800, hospedaje: 26694, comida: 5200, tours: 1500, transporte_local: 1200, extras: 956 },
};

/** Casetas de la ida (SIMULADAS con la forma de _shared/google-tolls.ts): 1 caseta en MXN. */
export const TEPOZ_TOLLS: TollQuote = {
  estado: "CON_MONTO", montos: [{ moneda: "MXN", monto: 196 }], monto_mxn: 196, fx: [], fuente: "google_routes",
  consultado_at: "2026-10-27T15:19:40.000Z", pase: null, from_cache: false,
};

/** hotels-search real (searchHotels) con la respuesta simulada de Google Hotels; sin red. */
export async function tepozLiveHotels(): Promise<any[]> {
  const serpFetch = (async () => new Response(JSON.stringify(liveSearch), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const r = await searchHotels({ city: "Tepoztlán", checkin: "2026-10-30", checkout: "2026-11-01", adults: 2 }, { serpKey: "llave-de-prueba", serpFetch });
  return (r.body.results as any[]) ?? [];
}

/** El mismo viaje como lo guarda analizar-viaje con el arreglo. */
export async function tepozNuevo(): Promise<any> {
  const short = refineShortTrip(detectShortTrip("Ciudad de México", "Tepoztlán", 500), { ok: true, duration_seconds: 4800, distance_meters: 81_500, consultado_at: TEPOZ_TOLLS.consultado_at })!;
  const links = groundSearchLinks(short.origin, short.destination, "2026-10-30");
  const cost = carCost({ kmIda: short.approxRoadKm, kmFuente: "google_routes", tolls: TEPOZ_TOLLS });
  const vuelos = realGroundOptions(applyShortTripRules(TEPOZ_GUARDADO.vuelos_json, short, links), short, cost, { ...links, ado: adoRouteUrl(short.origin, short.destination) }, 2);
  const hospedaje = buildHotelTiers(TEPOZ_GUARDADO.hospedaje_json, await tepozLiveHotels(), { fxUsd: TEPOZ_FX, consultedAt: TEPOZ_CREATED });
  const a: any = { vuelos, hospedaje, desglose_presupuesto: { ...TEPOZ_GUARDADO.desglose_presupuesto, vuelos: shortTripTransportTotal(vuelos, 2) } };
  a.desglose_presupuesto = capShortTripEstimates(a.desglose_presupuesto, { noches: 2, viajeros: 2, enCoche: true }).desglose;
  const budget = reconcileBudget(a, { dias: 2, viajeros: 2, notas: "viaje con mi novia de viernes a domingo a Tepoztlán desde CDMX", hotelTier: "equilibrio" });
  return { ...base, vuelos_json: vuelos, hospedaje_json: hospedaje, desglose_presupuesto: budget.desglose, total_estimado: budget.total };
}
