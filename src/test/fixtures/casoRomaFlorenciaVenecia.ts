// Caso real de producción (22-oct-2026): viaje multi-destino del dueño, Ciudad de México →
// Roma → Florencia → Venecia, 2 viajeros. Datos copiados del reporte (caso_roma_florencia_venecia.md).
// Lo que el reporte resume con "…" se completó así: el token `t` de Aviasales conserva las rutas que
// sí venían (MEXCUNMADOTP a la ida, OTPBGYSTNLGWYYZMEX al regreso) y rellena con dígitos lo omitido;
// los tiers de hoteles se asignaron por precio (el reporte no los da) y `ciudad` por la ciudad del hotel.

export const AVIASALES_BUH =
  "https://www.aviasales.com/search/MEX3010BUH07111?t=Y4179300000017930000000005MEXCUNMADOTP17930800001793100000000OTPBGYSTNLGWYYZMEX_0a1b2c_1282&marker=533299";

const tpFlight = (tier: string) => ({
  tier, mode: "vuelo", aerolinea: "Y4 102", duracion: "65h", escalas: "2 escala(s)", precio_por_persona: 24052,
  fuente_precio: "travelpayouts", estado_dato: "ESTIMADO", approximate_dates: true, booking_link: AVIASALES_BUH,
  notas: "Ciudad de México  → Roma · Tarifa de referencia de Aviasales para fechas cercanas del mismo mes (no tu fecha exacta).",
  ciudad: "Roma", from: "Ciudad de México ", to: "Roma", dep_iata: null, arr_iata: null,
});

export const LOGISTICS_FLIGHTS = ["ahorro", "equilibrio", "premium"].map((tier) => ({
  tier, from: "Ciudad de México ", to: "Roma", airline_suggested: "Y4 102", duration: "65h", stops: "2 escala(s)",
  price_per_person_usd: 1282, booking_link: AVIASALES_BUH, fuente_precio: "travelpayouts", estado_dato: "ESTIMADO", approximate_dates: true,
}));

const hotel = (ciudad: string, nombre: string, precio: number, tier: string) => ({
  tipo: tier, tier, nombre, barrio: ciudad, rating: 4.6, precio_por_noche: precio, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO",
  consultado_at: "2026-10-22T15:00:00Z", noches: null, precio_total: null, ciudad,
});

export const CASO_TRIP = {
  id: "8f0d6f8e-0000-4000-8000-000000000001",
  user_id: "owner-1",
  destino: "Roma → Florencia → Venecia",
  ciudad_origen: "Ciudad de México ",
  pais_destino: "Venecia",
  fecha_salida: "2026-10-22",
  fecha_regreso: "2026-11-01",
  num_viajeros: 2,
  dates_optimized: false,
  status: "listo",
  moneda: "MXN",
  created_at: "2026-10-22T15:00:00Z",
  total_estimado: 561468,
  desglose_presupuesto: { comida: 71293, extras: 5178, hospedaje: 401960, tours: 18423, transporte_local: 16510, vuelos: 48104 },
  vuelos_json: [
    tpFlight("ahorro"), tpFlight("equilibrio"), tpFlight("premium"),
    { tier: "premium", mode: "coche", aerolinea: "Sixt / Hertz", duracion: "45 min", escalas: "coche", precio_por_persona: 1500,
      fuente_precio: "estimado", notas: "Ciudad de México (vía Aeropuerto FCO - Retiro de Coche) → Roma", ciudad: "Roma",
      from: "Ciudad de México (vía Aeropuerto FCO - Retiro de Coche)", to: "Roma" },
    { tier: "equilibrio", mode: "vuelo", aerolinea: "Aeroméxico", duracion: "12h 45m", escalas: "Directo", precio_por_persona: 24765,
      fuente_precio: "estimado", notas: "Ciudad de México → Roma", ciudad: "Roma", from: "Ciudad de México", to: "Roma" },
    { tier: "ahorro", mode: "vuelo", aerolinea: "Iberia", duracion: "15h 20m", escalas: "Directo", precio_por_persona: 19699,
      fuente_precio: "estimado", notas: "Ciudad de México → Roma", ciudad: "Roma", from: "Ciudad de México", to: "Roma" },
    { tier: "premium", mode: "coche", aerolinea: "Hertz / Sixt Italia", duracion: "3h 10m", escalas: "Ruta escénica", precio_por_persona: 1900,
      fuente_precio: "estimado", ciudad: "Florencia", from: "Roma", to: "Florencia" },
    { tier: "equilibrio", mode: "tren", aerolinea: "Trenitalia / Italo", duracion: "1h 35m", escalas: "tren", precio_por_persona: 1100,
      fuente_precio: "estimado", ciudad: "Florencia", from: "Roma", to: "Florencia" },
    { tier: "premium", mode: "coche", aerolinea: "Sixt / Europcar", duracion: "3h 20m", escalas: "Ruta escénica", precio_por_persona: 1800,
      fuente_precio: "estimado", ciudad: "Venecia", from: "Florencia", to: "Venecia" },
    { tier: "equilibrio", mode: "tren", aerolinea: "Trenitalia / Italo", duracion: "2h 05m", escalas: "tren", precio_por_persona: 900,
      fuente_precio: "estimado", ciudad: "Venecia", from: "Florencia", to: "Venecia" },
  ],
  hospedaje_json: [
    hotel("Roma", "Villa Pamphili", 5159, "ahorro"), hotel("Roma", "Hotel Eden", 28029, "equilibrio"), hotel("Roma", "Hotel de la Ville", 32795, "premium"),
    hotel("Florencia", "Poggio Baronti", 2101, "ahorro"), hotel("Florencia", "Milu", 7017, "equilibrio"), hotel("Florencia", "Four Seasons Firenze", 37035, "premium"),
    hotel("Venecia", "Mosella", 2064, "ahorro"), hotel("Venecia", "Ca' Bonfadini", 9962, "equilibrio"), hotel("Venecia", "Aman Venice", 53226, "premium"),
  ],
  tours_json: [
    { nombre: "Coliseo y Foro Romano", precio_por_persona: 1200, fuente: "estimado", ciudad: "Roma" },
    { nombre: "Galería Uffizi", precio_por_persona: 900, fuente: "estimado", ciudad: "Florencia" },
    { nombre: "Paseo en góndola", precio_por_persona: 1800, fuente: "estimado", ciudad: "Venecia" },
  ],
  restaurantes_json: [
    { nombre: "Roscioli", cocina: "Romana", rango_precio: "$$$", ciudad: "Roma" },
    { nombre: "Trattoria Mario", cocina: "Toscana", rango_precio: "$$", ciudad: "Florencia" },
    { nombre: "Antiche Carampane", cocina: "Veneciana", rango_precio: "$$$", ciudad: "Venecia" },
  ],
  itinerario_json: {
    multi: true,
    destinations: ["Roma", "Florencia", "Venecia"],
    logistics: {
      selected_tier: "premium",
      flights: LOGISTICS_FLIGHTS,
      nights: 10,
      per_destination: [
        { city: "Roma", nights: 4, checkin: "2026-10-22", checkout: "2026-10-26" },
        { city: "Florencia", nights: 3, checkin: "2026-10-26", checkout: "2026-10-29" },
        { city: "Venecia", nights: 3, checkin: "2026-10-29", checkout: "2026-11-01" },
      ],
    },
    days: Array.from({ length: 10 }, (_, i) => ({ dia: i + 1, ciudad: i < 4 ? "Roma" : i < 7 ? "Florencia" : "Venecia", titulo: `Día ${i + 1}` })),
  },
};
