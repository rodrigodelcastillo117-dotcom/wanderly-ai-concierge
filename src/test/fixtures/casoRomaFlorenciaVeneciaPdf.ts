// El viaje del caso Roma → Florencia → Venecia con el contenido que traía el PDF real que mandó el dueño
// (22-oct-2026): resumen, "tips" (que eran el mismo resumen), itinerario de 10 días, restaurantes por
// ciudad y calificaciones de los hoteles. El resto (vuelos, hoteles, total) es CASO_TRIP tal cual.
// El road trip es el que arma logistics-plan para "coche por tramo" cuando Google Routes no responde
// (buildRoadTripPlan sin datos en vivo: distancias y tiempos ESTIMADOS).
import { buildRoadTripPlan } from "@/lib/roadtrip";
import { CASO_TRIP } from "./casoRomaFlorenciaVenecia";

export const ANALISIS =
  "Itinerario exclusivo y romántico de 10 días diseñado a la medida para Rodrigo y su pareja, combinando la majestuosidad histórica de Roma, las rutas vinícolas de la Toscana en coche privado y la magia marítima y musical de Venecia. La experiencia integra hospedajes boutique de alto nivel, alta gastronomía con énfasis en mariscos frescos y estrictos protocolos libres de fresas, junto con panorámicas inolvidables por carretera y paseos acuáticos.";

const day = (dia: number, ciudad: string, titulo: string, manana: string, tarde: string, noche: string) => ({ dia, ciudad, titulo: `${ciudad} — ${titulo}`, "mañana": manana, tarde, noche });

export const DAYS = [
  day(1, "Roma", "Bienvenida a la Ciudad Eterna y Noche Gourmet",
    "Llegada al Aeropuerto Fiumicino (FCO) desde Ciudad de México. Recogida del vehículo de alquiler premium en Sixt FCO y trayecto por la autopista A91 (32 km) hacia el centro histórico. Check-in en hotel boutique junto a Piazza Navona.",
    "Caminata privada adaptada al ritmo de la pareja por el Campo de' Fiori y las callejuelas del Trastevere, descubriendo rincones románticos y arquitectura barroca. Parada para un espresso y gelato artesanal seguro.",
    "Cena romántica de bienvenida en Pierluigi, saboreando mariscos frescos del Tirreno y pasta artesanal (notificando con antelación la alergia estricta a la fresa en postres y coctelería). Paseo nocturno iluminado por el Panteón."),
  day(2, "Roma", "Íconos Imperiales, Historia Clásica y Jazz Nocturno",
    "Visita guiada exclusiva a primera hora por el Coliseo con acceso a la arena de gladiadores y paseo histórico por el Foro Romano y el Monte Palatino, explorando el pasado imperial y deportivo de Roma.",
    "Almuerzo ligero en trattoria local y tarde de exploración de los Museos Vaticanos y la Capilla Sixtina con acceso preferente sin filas, admirando las obras maestras renacentistas.",
    "Noche de música en vivo en Gregory's Jazz Club o coctelería de autor en The Jerry Thomas Project para disfrutar de la sofisticada vida nocturna romana."),
  day(3, "Roma", "Arte Barroco, Panorámicas Románticas y Alta Cocina",
    "Recorrido panorámico en coche o a pie por la Colina Aventina, visitando el Jardín de los Naranjos con vistas privilegiadas de la cúpula de San Pedro, seguido por la Fontana di Trevi temprano por la mañana.",
    "Paseo relajado por Villa Borghese y visita a la Galería Borghese para apreciar esculturas de Bernini. Sesión gastronómica privada de cata de vinos del Lacio y aceites de oliva virgen extra.",
    "Cena degustación romántica en el restaurante con estrella Michelin Aroma, disfrutando de vistas frontales al Coliseo iluminado y menú libre de fresas."),
  day(4, "Florencia", "Roadtrip por la Val d'Orcia y Llegada al Corazón Toscano",
    "Salida en coche hacia la Toscana por la Autostrada del Sole A1 y desvío panorámico por la SR2 hacia Val d'Orcia (~160 km). Primera parada escénica en Montalcino para admirar las murallas y bodegas históricas.",
    "Conducción por la SP146 hacia Pienza (20 km), deleitándose con sus quesos pecorino y vistas toscanas. Continuación por la campiña de Radda in Chianti (SR222, 60 km) antes de enfilar el tramo final a Florencia (total 273 km, ~3.1 h de manejo).",
    "Llegada a Florencia, check-in en hotel boutique a orillas del río Arno. Cena con bistec a la florentina tradicional en Buca Mario maridado con Brunello di Montalcino."),
  day(5, "Florencia", "Tesoros del Renacimiento y Sofisticación Gastronómica",
    "Visita privada matutina a la Galería de la Academia para contemplar el David de Miguel Ángel, seguido de un recorrido histórico por la Piazza del Duomo y la Catedral de Santa María del Fiore.",
    "Recorrido a pie por la Galería Uffizi contemplando El Nacimiento de Venus de Botticelli. Tiempo libre para pasear por el Ponte Vecchio y boutiques de cuero florentino.",
    "Cena en Enoteca Pinchiorri (3 estrellas Michelin) con maridaje de autor y atención estricta a la alergia alimentaria de la pareja. Vistas nocturnas de la ciudad desde el Ponte Santa Trinita."),
  day(6, "Florencia", "Colinas del Chianti y Atardecer Romántico en Michelangelo",
    "Excursión panorámica de medio día conduciendo por la carretera escénica Chiantigiana (SR222) hacia viñedos toscanos privados, explorando cavas históricas y el castillo de Verrazzano.",
    "Regreso a Florencia. Subida al Piazzale Michelangelo al atardecer para una sesión de fotos en pareja con vista completa del skyline renacentista y música acústica callejera.",
    "Cata de vinos y cena rústico-gourmet en una osteria toscana de San Frediano, seguida de un cóctel artesanal en Rasputin secret bar."),
  day(7, "Venecia", "Travesía hacia el Adriático y Llegada Espectacular en Watertaxi",
    "Salida en coche desde Florencia hacia Venecia por la autopista A1 y A13 (269 km, ~2.9 h de manejo neto), atravesando la llanura padana con vistas a las colinas euganeas.",
    "Llegada al terminal de Piazzale Roma en Venecia para el resguardo del vehículo en garaje asignado. Traslado en watertaxi privado de caoba hacia el hotel boutique/resort histórico en el Gran Canal. Paseo inicial por el Puente de Rialto.",
    "Cena íntima frente a los canales en Ristorante Riviera, saboreando mariscos del Adriático preparados con técnica contemporánea (confirmando postre seguro de cacao y cítricos)."),
  day(8, "Venecia", "Misterios Ducales, Góndola Privada y Ópera Veneciana",
    "Visita guiada privada al Palacio Ducal y la Basílica de San Marcos, explorando los secretos de la Serenísima y cruzando el icónico Puente de los Suspiros.",
    "Paseo romántico en góndola privada por los canales interiores menos transitados de Cannaregio y San Polo, con serenata musical acústica al atardecer.",
    "Velada de ópera o concierto barroco de Vivaldi en el histórico Teatro La Fenice o la Scuola Grande di San Teodoro, sumergiéndose en la tradición musical veneciana."),
  day(9, "Venecia", "Islas de la Laguna, Brisa de Playa en el Lido y Cena de Gala",
    "Excursión privada en lancha motora a la isla de Burano, famosa por sus casas multicolores y encajes artesanales, y a Murano para una demostración privada con un maestro del vidrio soplado.",
    "Paseo tranquilo por la playa del Lido de Venecia para disfrutar de la brisa marina del Adriático y relajarse en pareja frente al mar. Regreso al centro histórico para comprar recuerdos artesanales.",
    "Cena gourmet de despedida en Quadri (Plaza San Marcos), degustando mariscos venecianos con el marco de la orquesta de la plaza iluminada. Coctelería de autor en Harry's Bar."),
  day(10, "Venecia", "Despedida de la Laguna y Regreso a Ciudad de México",
    "Desayuno gourmet con vistas al Gran Canal. Check-out y traslado en watertaxi hasta Piazzale Roma para tomar el vehículo hacia el Aeropuerto Marco Polo (VCE) por la SS11 (14 km, 20 min).",
    "Devolución del vehículo de alquiler en Sixt Venecia Aeropuerto (VCE). Trámites de facturación, compras tax-free de especialidades gastronómicas italianas y embarque hacia Roma/CDMX.",
    "Llegada a Ciudad de México tras una escala inteligente en un hub europeo mayor, concluyendo una luna de miel y roadtrip inolvidable por Italia."),
];

const r = (ciudad: string, nombre: string, cocina: string, rango_precio: string) => ({ nombre, cocina, rango_precio, ciudad });
export const RESTAURANTES = [
  r("Roma", "Pierluigi", "Mariscos Gourmet", "$$$$"),
  r("Roma", "Aroma Restaurant", "Italiana de Autor / Alta Cocina", "$$$$"),
  r("Roma", "Il Sanlorenzo", "Mariscos y Cocina Mediterránea de Mar", "$$$$"),
  r("Roma", "Roscioli Salumeria con Cucina", "Romana Tradicional Gourmet", "$$$"),
  r("Roma", "Da Enzo al 29", "Romana Auténtica / Trastevere", "$$"),
  r("Florencia", "Buca Lapi", "Toscana Gourmet / Bistecca alla Fiorentina", "$$$$ (80-120 USD pp)"),
  r("Florencia", "Cestello Ristoclub", "Mariscos & Mediterránea Contemporánea", "$$$$ (90-140 USD pp)"),
  r("Florencia", "Winter Garden Restaurant by St. Regis", "Alta Cocina Italiana (1 Estrella Michelin)", "$$$$$ (150-220 USD pp)"),
  r("Florencia", "Trattoria Cammillo (Oltrarno)", "Toscana Auténtica / Enoteca", "$$$ (50-80 USD pp)"),
  r("Venecia", "Ristorante Glam Enrico Bartolini", "Mariscos de la laguna y alta cocina veneciana", "$$$$"),
  r("Venecia", "Osteria alle Testiere", "Mariscos locales y cocina veneciana tradicional contemporánea", "$$$"),
  r("Venecia", "Quadri (Alajmo)", "Italiana moderna y mariscos de temporada", "$$$$"),
  r("Venecia", "Antiche Carampane", "Veneciana refinada e histórica", "$$$"),
];

// Calificaciones que mostraba el PDF real (las demás se quedan como en CASO_TRIP).
const RATINGS: Record<string, number> = { "Hotel Eden": 4.8, "Poggio Baronti": 4.9, Mosella: 4.9 };

export const ROAD_TRIP = buildRoadTripPlan({
  stops: ["Roma", "Florencia", "Venecia"],
  legModes: ["coche", "coche"],
  legDates: ["2026-10-26", "2026-10-29"],
  now: "2026-10-22T15:00:00Z",
});

export const CASO_TRIP_PDF = {
  ...CASO_TRIP,
  analisis_ai: ANALISIS,
  tips_personalizados: [ANALISIS],
  restaurantes_json: RESTAURANTES,
  hospedaje_json: CASO_TRIP.hospedaje_json.map((h) => (RATINGS[h.nombre] ? { ...h, rating: RATINGS[h.nombre] } : h)),
  itinerario_json: {
    ...CASO_TRIP.itinerario_json,
    days: DAYS,
    logistics: { ...CASO_TRIP.itinerario_json.logistics, road_trip: ROAD_TRIP },
  },
};
