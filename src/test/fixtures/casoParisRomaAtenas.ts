// Caso del dueño (23-oct-2026): "paris roma y atenas 10 dias", 1 viajero, 6–15 nov 2026 (9 noches).
// Al crearse el viaje llegó el correo "Tu viaje está cotizado" con todo el desglose "— · sin precio
// confiable: no suma al total · NO DISPONIBLE", mientras la página mostraba precios en vivo.
//
// Lo que viene del reporte del dueño: vuelos Delta $17,016, Air France $21,238, Aeroméxico $39,568 y
// hoteles Pullman $41,031, "Hôtel L'In…" $48,627 (el nombre llegó recortado) y San Régis $163,278 por
// las 9 noches (= $4,559, $5,403 y $18,142 por noche). Lo demás se completó con la forma real de las
// filas que guarda analizar-viaje (fuente_precio, estado_dato, consultado_at, booking_link):
//   * El desglose del modelo en 0 para vuelos, hospedaje, experiencias, comida y transporte local (lo
//     que pinta "NO DISPONIBLE"); "extras" con monto para que la cotización sea válida (reconcileBudget
//     rechaza un total en 0). El reporte no da el monto de extras.
//   * Enlaces de Google Flights / Booking con la búsqueda del viaje.
// CASO_PRA_MULTI es el mismo viaje como multi-destino (París → Roma → Atenas, 3 noches por ciudad),
// con un hotel por ciudad, como lo arma la ruta multi-destino.

export const PRA_NOW = new Date("2026-10-23T01:30:00Z");
const AT = "2026-10-23T00:49:00Z";

const gf = (airline: string) =>
  `https://www.google.com/travel/flights?hl=es-419&curr=MXN&q=${encodeURIComponent(`Flights from MEX to CDG on 2026-11-06 through 2026-11-15 ${airline}`)}`;

const flight = (tier: string, aerolinea: string, precio: number, escalas: string, duracion: string) => ({
  tier, aerolinea, precio_por_persona: precio, escalas, duracion, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO",
  consultado_at: AT, booking_link: gf(aerolinea), dep_iata: "MEX", arr_iata: "CDG",
});

const booking = (name: string, city: string, checkin: string, checkout: string) =>
  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${name} ${city}`)}&checkin=${checkin}&checkout=${checkout}&group_adults=1&no_rooms=1&group_children=0`;

const hotel = (nombre: string, precio: number, tier: string, ciudad: string | null, stay = { checkin: "2026-11-06", checkout: "2026-11-15" }) => ({
  nombre, tipo: tier, tier, precio_por_noche: precio, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: AT,
  rating: 4.5, barrio: ciudad ?? "París", ...(ciudad ? { ciudad } : {}), booking_link: booking(nombre, ciudad ?? "Paris", stay.checkin, stay.checkout),
});

/** Como lo guardó analizar-viaje al crear el viaje desde el texto (un solo destino). */
export const CASO_PRA_CREADO = {
  id: "5b7e3c1a-2f4d-4e8a-9b6c-0d1e2f3a4b5c",
  user_id: "owner-1",
  destino: "paris roma y atenas 10 dias",
  ciudad_origen: "Ciudad de México",
  pais_destino: "Francia",
  fecha_salida: "2026-11-06",
  fecha_regreso: "2026-11-15",
  num_viajeros: 1,
  status: "listo",
  moneda: "MXN",
  created_at: "2026-10-23T00:50:00Z",
  total_estimado: 4500,
  desglose_presupuesto: { vuelos: 0, hospedaje: 0, comida: 0, tours: 0, transporte_local: 0, extras: 4500 },
  vuelos_json: [
    flight("ahorro", "Delta", 17016, "1 escala", "14h 10m"),
    flight("equilibrio", "Air France", 21238, "Directo", "11h 05m"),
    flight("premium", "Aeroméxico", 39568, "Directo", "11h 20m"),
  ],
  hospedaje_json: [
    hotel("Pullman Paris Tour Eiffel", 4559, "ahorro", null),
    hotel("Hôtel L'In…", 5403, "equilibrio", null),
    hotel("Hôtel San Régis", 18142, "premium", null),
  ],
  tours_json: [
    { nombre: "Museo del Louvre con acceso prioritario", precio_por_persona: 1450, fuente: "estimado", duracion: "3 h" },
    { nombre: "Crucero por el Sena", precio_por_persona: 620, fuente: "estimado", duracion: "1 h" },
  ],
  restaurantes_json: [
    { nombre: "Le Comptoir du Relais", cocina: "Francesa", rango_precio: "$$$", fuente: "google_places" },
    { nombre: "Bouillon Chartier", cocina: "Francesa", rango_precio: "$", fuente: "google_places" },
  ],
  itinerario_json: [],
};

const PER = [
  { city: "París", nights: 3, checkin: "2026-11-06", checkout: "2026-11-09" },
  { city: "Roma", nights: 3, checkin: "2026-11-09", checkout: "2026-11-12" },
  { city: "Atenas", nights: 3, checkin: "2026-11-12", checkout: "2026-11-15" },
];

/** El mismo viaje como multi-destino: un hotel por ciudad con sus noches. */
export const CASO_PRA_MULTI = {
  ...CASO_PRA_CREADO,
  id: "5b7e3c1a-2f4d-4e8a-9b6c-0d1e2f3a4b5d",
  destino: "París → Roma → Atenas",
  vuelos_json: CASO_PRA_CREADO.vuelos_json.map((v) => ({ ...v, from: "Ciudad de México", to: "París", ciudad: "París" })),
  hospedaje_json: [
    hotel("Pullman Paris Tour Eiffel", 4559, "ahorro", "París", PER[0]),
    hotel("Hôtel L'In…", 5403, "equilibrio", "París", PER[0]),
    hotel("Hôtel San Régis", 18142, "premium", "París", PER[0]),
    hotel("Hotel Artemide", 3900, "ahorro", "Roma", PER[1]),
    hotel("Hotel Eden", 21500, "premium", "Roma", PER[1]),
    hotel("Electra Metropolis", 4300, "ahorro", "Atenas", PER[2]),
    hotel("Hotel Grande Bretagne", 16800, "premium", "Atenas", PER[2]),
  ],
  tours_json: [
    { nombre: "Museo del Louvre con acceso prioritario", precio_por_persona: 1450, fuente: "estimado", ciudad: "París" },
    { nombre: "Coliseo y Foro Romano", precio_por_persona: 1200, fuente: "estimado", ciudad: "Roma" },
    { nombre: "Acrópolis con guía", precio_por_persona: 1100, fuente: "estimado", ciudad: "Atenas" },
  ],
  restaurantes_json: [
    { nombre: "Le Comptoir du Relais", cocina: "Francesa", rango_precio: "$$$", ciudad: "París", fuente: "google_places" },
    { nombre: "Roscioli", cocina: "Romana", rango_precio: "$$$", ciudad: "Roma", fuente: "google_places" },
    { nombre: "Karamanlidika", cocina: "Griega", rango_precio: "$$", ciudad: "Atenas", fuente: "google_places" },
  ],
  itinerario_json: {
    multi: true,
    destinations: ["París", "Roma", "Atenas"],
    logistics: { nights: 9, per_destination: PER },
    days: Array.from({ length: 9 }, (_, i) => ({ dia: i + 1, ciudad: i < 3 ? "París" : i < 6 ? "Roma" : "Atenas", titulo: `Día ${i + 1}` })),
  },
};
