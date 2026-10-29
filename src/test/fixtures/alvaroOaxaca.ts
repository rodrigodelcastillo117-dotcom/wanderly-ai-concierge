// SIMULADO para pruebas de claridad (feedback de Álvaro, 28-oct-2026): viaje a Oaxaca de Juárez del 30 oct
// al 1 nov 2026, 2 viajeros desde CDMX, con la forma que guarda analizar-viaje. NO es la fila de producción:
// precios, textos e itinerario son de ejemplo.
export const OAXACA_TRIP: any = {
 "id": "0a0a0a0a-1111-4222-8333-444455556666",
 "user_id": "u1",
 "destino": "Oaxaca de Juárez",
 "pais_destino": "México",
 "ciudad_origen": "Ciudad de México",
 "fecha_salida": "2026-10-30",
 "fecha_regreso": "2026-11-01",
 "num_viajeros": 2,
 "presupuesto_objetivo": null,
 "status": "listo",
 "total_estimado": 24180,
 "moneda": "MXN",
 "match_score": 88,
 "created_at": "2026-10-28T20:10:00Z",
 "updated_at": "2026-10-28T20:10:00Z",
 "fuente": null,
 "selections": null,
 "current_quote_id": null,
 "cover_image_url": null,
 "analisis_ai": "Oaxaca de Juárez en Día de Muertos es uno de los viajes más especiales que puedes hacer en México: las calles del centro se llenan de altares, comparsas y tapetes de arena, y los mercados tienen pan de muerto, mole y mezcal de temporada. Con dos noches te conviene dormir en el centro histórico para caminar a todo. El primer día aprovecha la tarde en Santo Domingo y el Andador Macedonio Alcalá; el segundo, Monte Albán temprano antes del calor y en la noche las comparsas en Xoxocotlán. El vuelo de fechas cercanas que encontramos sale un día antes; verifica la fecha exacta en Google Flights. El hotel y la comida son estimados: en estas fechas suben de precio y conviene reservar ya. Respetando tu indicación de un viaje tranquilo, no incluyo excursiones de día completo a Hierve el Agua.",
 "tips_personalizados": [
  "Reserva cena en Casa Oaxaca o Los Danzantes con anticipación: en Día de Muertos se llenan.",
  "Lleva efectivo para mercados y comparsas.",
  "Monte Albán abre a las 8:00; llega temprano por el sol."
 ],
 "desglose_presupuesto": {
  "vuelos": 9800,
  "hospedaje": 7600,
  "comida": 3600,
  "tours": 1380,
  "transporte_local": 1000,
  "extras": 800
 },
 "vuelos_json": [
  {
   "tier": "ahorro",
   "aerolinea": "Viva Aerobus",
   "duracion": "1h 15m",
   "escalas": "Directo",
   "precio_por_persona": 4900,
   "fuente_precio": "travelpayouts",
   "estado_dato": "ESTIMADO",
   "approximate_dates": true,
   "consultado_at": "2026-10-28T20:05:00Z",
   "notas": "Tarifa de fechas cercanas (29 oct). Verifica la fecha exacta."
  },
  {
   "tier": "equilibrio",
   "aerolinea": "Volaris",
   "duracion": "1h 15m",
   "escalas": "Directo",
   "precio_por_persona": 5600,
   "fuente_precio": "estimado",
   "estado_dato": "ESTIMADO",
   "notas": "Precio estimado; verifica en Google Flights."
  },
  {
   "tier": "premium",
   "aerolinea": "Aeroméxico",
   "duracion": "1h 10m",
   "escalas": "Directo",
   "precio_por_persona": 7400,
   "fuente_precio": "estimado",
   "estado_dato": "ESTIMADO",
   "notas": "Precio estimado; verifica en Google Flights."
  }
 ],
 "hospedaje_json": [
  {
   "nombre": "Hotel Casa Antigua",
   "tipo": "Hotel boutique",
   "barrio": "Centro Histórico",
   "rating": 4.6,
   "precio_por_noche": 3800,
   "por_que": "A dos cuadras de Santo Domingo; patio colonial.",
   "fuente_precio": "estimado",
   "estado_dato": "ESTIMADO"
  },
  {
   "nombre": "Quinta Real Oaxaca",
   "tipo": "Hotel 5★",
   "barrio": "Centro Histórico",
   "rating": 4.7,
   "precio_por_noche": 6900,
   "por_que": "Exconvento del siglo XVI.",
   "fuente_precio": "estimado",
   "estado_dato": "ESTIMADO"
  }
 ],
 "tours_json": [
  {
   "nombre": "Zona Arqueológica de Monte Albán",
   "duracion": "3 h",
   "precio_por_persona": 95,
   "por_que": "Capital zapoteca con vista al valle.",
   "fuente": "google_places",
   "rating": 4.8,
   "num_reviews": 31000,
   "estado_dato": "ESTIMADO"
  },
  {
   "nombre": "Templo de Santo Domingo de Guzmán",
   "duracion": "1 h",
   "precio_por_persona": 0,
   "por_que": "Barroco con el Jardín Etnobotánico.",
   "fuente": "google_places",
   "rating": 4.8,
   "num_reviews": 42000,
   "estado_dato": "ESTIMADO"
  },
  {
   "nombre": "Mercado 20 de Noviembre",
   "duracion": "1.5 h",
   "precio_por_persona": 0,
   "por_que": "El pasillo de humo y el chocolate.",
   "fuente": "google_places",
   "rating": 4.5,
   "num_reviews": 25000,
   "estado_dato": "ESTIMADO"
  },
  {
   "nombre": "Comparsas de Xoxocotlán",
   "duracion": "3 h",
   "precio_por_persona": 600,
   "por_que": "La noche de muertos en el panteón.",
   "fuente": "estimado",
   "estado_dato": "ESTIMADO"
  }
 ],
 "restaurantes_json": [
  {
   "nombre": "Casa Oaxaca",
   "cocina": "Oaxaqueña contemporánea",
   "rango_precio": "$$$",
   "por_que": "Terraza con vista a Santo Domingo."
  },
  {
   "nombre": "Los Danzantes",
   "cocina": "Oaxaqueña",
   "rango_precio": "$$$",
   "por_que": "Patio y mezcal propio."
  }
 ],
 "cruceros_json": [],
 "itinerario_json": [
  {
   "dia": 1,
   "fecha": "2026-10-30",
   "titulo": "Llegada y centro histórico",
   "mañana": "Vuelo de la Ciudad de México a Oaxaca y traslado al hotel en el centro; deja maletas y desayuna en el Mercado 20 de Noviembre, en el pasillo de humo, con tasajo, tlayudas y chocolate de agua.",
   "tarde": "Recorre el Templo de Santo Domingo de Guzmán y el Jardín Etnobotánico (visitas guiadas en español a las 13:00), luego camina el Andador Macedonio Alcalá viendo los altares de muertos y las galerías.",
   "noche": "Cena en Casa Oaxaca con vista a Santo Domingo; después, mezcal en la terraza de Los Danzantes y vuelta caminando por las calles adornadas con papel picado."
  },
  {
   "dia": 2,
   "fecha": "2026-10-31",
   "titulo": "Monte Albán y comparsas",
   "mañana": "Sal a las 7:30 a la Zona Arqueológica de Monte Albán (25 min en taxi); recorre la Gran Plaza, el Juego de Pelota y la Plataforma Norte antes de que pegue el sol.",
   "tarde": "Regreso al centro, comida en el mercado Benito Juárez y tarde libre para descansar o comprar textiles en el Andador Turístico.",
   "noche": "Comparsas y velación en el panteón de Santa Cruz Xoxocotlán: llega antes de las 21:00, lleva efectivo y una chamarra ligera."
  },
  {
   "dia": 3,
   "fecha": "2026-11-01",
   "titulo": "Desayuno y regreso",
   "mañana": "Desayuno tranquilo en el centro y compras de último momento: mole, chocolate y pan de muerto.",
   "tarde": "Traslado al aeropuerto y vuelo de regreso a la Ciudad de México.",
   "noche": ""
  }
 ]
};
