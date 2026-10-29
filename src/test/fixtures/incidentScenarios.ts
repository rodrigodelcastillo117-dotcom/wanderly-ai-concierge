// Conjunto de evaluación de incidentes: mensajes REALES de viajeros (español e inglés, con faltas, de día y de
// noche) y lo que el sistema debe hacer. Lo usan src/test/incidentesEval.test.ts (reglas, sin IA, con mocks) y
// scripts/incidentes/evalReal.ts (modo con IA real, para correrlo después a mano).
import type { ComplaintSubtype, IncidentCategory, IncidentSeverity } from "../../../supabase/functions/_shared/incident-labels";

export type IncidentScenario = {
  id: string;
  texto: string;
  /** Por dónde llega (Iato abre el caso solo; el formulario manda la categoría que eligió la persona). */
  canal: "iato" | "formulario";
  /** Hora UTC del mensaje (para la hora local del viajero). */
  at: string;
  tz?: string;
  /** null = NO es un incidente (no se abre caso). */
  categoria: IncidentCategory | null;
  severidad?: IncidentSeverity;
  queja?: ComplaintSubtype;
  /** Formulario: la categoría que eligió la persona. */
  elegida?: IncidentCategory;
};

const DAY = "2026-10-29T17:00:00Z"; // 11:00 CDMX, 18:00 Madrid

export const INCIDENT_SCENARIOS: IncidentScenario[] = [
  // ── vuelos ──
  { id: "V01", canal: "iato", at: "2026-10-29T01:05:00Z", tz: "Europe/Paris", categoria: "vuelo_cancelado", severidad: "critica",
    texto: "Me cancelaron el vuelo de París a Madrid y son las 2 de la mañana, estoy sola en el aeropuerto" },
  { id: "V02", canal: "iato", at: DAY, tz: "America/Mexico_City", categoria: "vuelo_cancelado", severidad: "alta",
    texto: "Cancelaron mi vuelo AM 402 a Monterrey, ¿qué hago?" },
  { id: "V03", canal: "iato", at: "2026-10-29T13:00:00Z", tz: "Europe/Rome", categoria: "vuelo_cancelado", severidad: "alta",
    texto: "My flight to London got cancelled, what do I do now?" },
  { id: "V04", canal: "iato", at: DAY, tz: "America/Mexico_City", categoria: "vuelo_cancelado", severidad: "alta",
    texto: "me kanselaron el bulo y no se q hacer" },
  { id: "V05", canal: "iato", at: DAY, tz: "America/Chicago", categoria: "conexion_perdida", severidad: "alta",
    texto: "El vuelo lleva 4 horas de retraso y voy a perder mi conexión en Houston" },
  { id: "V06", canal: "iato", at: DAY, tz: "America/Mexico_City", categoria: "vuelo_retrasado", severidad: "media",
    texto: "Mi vuelo está retrasado 40 minutos" },
  { id: "V07", canal: "iato", at: "2026-10-29T14:00:00Z", tz: "Europe/Berlin", categoria: "conexion_perdida", severidad: "alta",
    texto: "Perdí mi conexión en Frankfurt por el retraso del primer vuelo" },
  { id: "V08", canal: "iato", at: DAY, categoria: "overbooking", severidad: "alta",
    texto: "No me dejaron abordar, dicen que el vuelo está sobrevendido" },
  { id: "V09", canal: "iato", at: DAY, categoria: "overbooking", severidad: "alta",
    texto: "I was denied boarding, they say the flight is overbooked" },
  { id: "V10", canal: "iato", at: "2026-10-29T17:00:00Z", tz: "America/Bogota", categoria: "vuelo_cancelado", severidad: "critica",
    texto: "Estamos varados en el aeropuerto de Bogotá, cancelaron todos los vuelos y viajo con mis dos hijos" },
  { id: "V11", canal: "iato", at: DAY, tz: "America/Mexico_City", categoria: "vuelo_retrasado", severidad: "alta",
    texto: "mi vuelo se retraso 5 hrs y no nos dan nada, una verguenza" },
  { id: "V12", canal: "formulario", elegida: "vuelo_cancelado", at: "2026-10-29T03:30:00Z", tz: "Europe/Madrid", categoria: "vuelo_cancelado", severidad: "critica",
    texto: "Iberia canceló el IB6402 y la siguiente opción es en dos días" },
  // ── traslados ──
  { id: "T01", canal: "iato", at: "2026-10-29T20:00:00Z", tz: "America/Cancun", categoria: "traslado_no_llego", severidad: "alta",
    texto: "Llegué a Cancún y el chofer del traslado no ha llegado, llevo 40 minutos esperando" },
  { id: "T02", canal: "iato", at: "2026-10-30T04:00:00Z", tz: "America/Cancun", categoria: "traslado_no_llego", severidad: "critica",
    texto: "Nadie me recogió en el aeropuerto de Tulum y ya es de noche" },
  { id: "T03", canal: "iato", at: "2026-10-29T15:00:00Z", tz: "Europe/Lisbon", categoria: "traslado_no_llego", severidad: "alta",
    texto: "My driver didn't show up at the airport in Lisbon" },
  { id: "T04", canal: "iato", at: DAY, tz: "America/Mexico_City", categoria: "traslado_no_llego", severidad: "alta",
    texto: "el chofe no llega y no contesta" },
  { id: "T05", canal: "formulario", elegida: "traslado_no_llego", at: "2026-10-29T19:00:00Z", tz: "America/Cancun", categoria: "traslado_no_llego", severidad: "alta",
    texto: "El transfer de la agencia al hotel nunca apareció en la terminal 3" },
  // ── hotel ──
  { id: "H01", canal: "iato", at: "2026-10-29T22:30:00Z", tz: "Europe/Madrid", categoria: "hotel_problema", severidad: "critica",
    texto: "Estoy en el hotel y dicen que no tienen mi reserva" },
  { id: "H02", canal: "iato", at: DAY, tz: "America/Mexico_City", categoria: "hotel_problema", severidad: "alta",
    texto: "En recepción no encuentran mi reservación y no tengo dónde dormir" },
  { id: "H03", canal: "iato", at: DAY, categoria: "hotel_problema", severidad: "media",
    texto: "La habitación está sucia y hay cucarachas" },
  { id: "H04", canal: "iato", at: "2026-10-29T15:00:00Z", tz: "Europe/London", categoria: "hotel_problema", severidad: "alta",
    texto: "The hotel says they have no record of my reservation" },
  { id: "H05", canal: "iato", at: DAY, categoria: "hotel_problema", severidad: "media",
    texto: "Me cambiaron la habitación por una más chica, pésimo" },
  { id: "H06", canal: "iato", at: DAY, categoria: "hotel_problema", severidad: "media",
    texto: "El hotel quiere cobrarme de nuevo la noche que ya pagué" },
  // ── equipaje ──
  { id: "E01", canal: "iato", at: DAY, categoria: "equipaje", severidad: "media", texto: "Mi maleta no llegó a Roma" },
  { id: "E02", canal: "iato", at: DAY, categoria: "equipaje", severidad: "alta", texto: "Perdieron mi equipaje y adentro van mis medicinas de la presión" },
  { id: "E03", canal: "iato", at: DAY, categoria: "equipaje", severidad: "media", texto: "Airline lost my luggage" },
  { id: "E04", canal: "iato", at: DAY, categoria: "equipaje", severidad: "media", texto: "La maleta llegó rota" },
  { id: "E05", canal: "iato", at: DAY, categoria: "equipaje", severidad: "media", texto: "my bag never arived and nobody helps" },
  // ── robo y documentos ──
  { id: "R01", canal: "iato", at: DAY, tz: "Europe/Madrid", categoria: "robo", severidad: "alta", texto: "Me robaron la cartera en el metro de Barcelona" },
  { id: "R02", canal: "iato", at: DAY, categoria: "robo", severidad: "critica", texto: "Me asaltaron con un cuchillo en la calle" },
  { id: "R03", canal: "iato", at: DAY, categoria: "robo", severidad: "alta", texto: "I got pickpocketed, they took my wallet and phone" },
  { id: "D01", canal: "iato", at: DAY, categoria: "documentos", severidad: "alta", texto: "Perdí mi pasaporte y mi vuelo sale mañana" },
  { id: "D02", canal: "iato", at: DAY, tz: "Europe/Rome", categoria: "documentos", severidad: "alta", texto: "Me robaron el pasaporte en Roma" },
  { id: "D03", canal: "iato", at: DAY, tz: "Europe/Paris", categoria: "documentos", severidad: "alta", texto: "I lost my passport in Paris" },
  { id: "D04", canal: "iato", at: DAY, categoria: "documentos", severidad: "alta", texto: "perdi mi pasaport en el aeropuerto auxilio" },
  // ── salud y seguridad ──
  { id: "S01", canal: "iato", at: DAY, categoria: "salud", severidad: "critica", texto: "Mi hijo tiene fiebre muy alta y no sabemos a qué hospital ir" },
  { id: "S02", canal: "iato", at: DAY, categoria: "salud", severidad: "critica", texto: "Me siento muy mal, creo que es intoxicación" },
  { id: "S03", canal: "iato", at: DAY, categoria: "salud", severidad: "critica", texto: "My wife fainted and is bleeding, we need an ambulance" },
  { id: "S04", canal: "iato", at: DAY, categoria: "salud", severidad: "critica", texto: "Me picó algo y tengo alergia, se me está hinchando la cara" },
  { id: "S05", canal: "iato", at: DAY, categoria: "seguridad", severidad: "critica", texto: "Hay una balacera cerca del hotel, tengo miedo" },
  { id: "S06", canal: "iato", at: DAY, categoria: "seguridad", severidad: "critica", texto: "Hubo un terremoto y nos están evacuando del hotel" },
  { id: "S07", canal: "iato", at: DAY, categoria: "seguridad", severidad: "critica", texto: "There's a hurricane coming and we're stuck in Cancun" },
  { id: "S08", canal: "iato", at: DAY, categoria: "seguridad", severidad: "critica", texto: "Someone is following me back to the hotel, I'm scared" },
  // ── reservas y cobros ──
  { id: "B01", canal: "iato", at: DAY, categoria: "reserva_problema", severidad: "alta", texto: "Llegué al restaurante y no aparece mi reserva" },
  { id: "B02", canal: "iato", at: DAY, categoria: "reserva_problema", severidad: "media", texto: "El tour de mañana no aparece en el sistema de la agencia" },
  { id: "B03", canal: "iato", at: DAY, categoria: "reserva_problema", severidad: "media", texto: "The rental car company has no record of my booking" },
  { id: "B04", canal: "iato", at: DAY, categoria: "reserva_problema", severidad: "media", texto: "No me llegó la confirmación de mi hotel y viajo mañana" },
  { id: "C01", canal: "iato", at: DAY, categoria: "cobro_reembolso", severidad: "media", texto: "Me cobraron dos veces la reserva del hotel" },
  { id: "C02", canal: "iato", at: DAY, categoria: "cobro_reembolso", severidad: "media", texto: "¿Cuándo me llega el reembolso de la cancelación?" },
  // ── quejas ──
  { id: "Q01", canal: "iato", at: DAY, categoria: "queja", queja: "cobro", severidad: "alta",
    texto: "Me cobraron doble la suscripción, son unos ladrones, quiero mi dinero de vuelta" },
  { id: "Q02", canal: "iato", at: DAY, categoria: "queja", queja: "servicio_iatos", severidad: "media",
    texto: "El restaurante que me recomendaste estaba cerrado, pésima recomendación" },
  { id: "Q03", canal: "iato", at: DAY, categoria: "queja", queja: "servicio_iatos", severidad: "alta", texto: "esto es una porquería" },
  { id: "Q04", canal: "iato", at: DAY, categoria: "queja", queja: "servicio_iatos", severidad: "alta", texto: "ESTO NO SIRVE PARA NADA, NADIE ME RESPONDE" },
  { id: "Q05", canal: "iato", at: DAY, categoria: "queja", queja: "app", severidad: "media", texto: "This app is useless, it keeps crashing" },
  { id: "Q06", canal: "iato", at: DAY, categoria: "queja", queja: "cobro", severidad: "alta", texto: "Worst service ever, I want my money back" },
  { id: "Q07", canal: "iato", at: DAY, categoria: "queja", queja: "trato", severidad: "alta", texto: "El recepcionista fue muy grosero conmigo, inaceptable" },
  { id: "Q08", canal: "iato", at: DAY, categoria: "queja", queja: "app", severidad: "media", texto: "La app se traba cada vez que quiero ver mi viaje, qué mal" },
  { id: "Q09", canal: "iato", at: DAY, categoria: "queja", queja: "servicio_iatos", severidad: "media",
    texto: "Iato me dio un horario equivocado del museo y llegamos cerrado, muy molesto" },
  { id: "Q10", canal: "iato", at: DAY, categoria: "queja", queja: "trato", severidad: "alta", texto: "El chofer fue grosero y manejó como loco, pésimo servicio" },
  { id: "Q11", canal: "iato", at: DAY, categoria: "queja", queja: "proveedor", severidad: "alta",
    texto: "El tour estuvo horrible, el guía ni hablaba español, nos sentimos estafados" },
  { id: "Q12", canal: "iato", at: DAY, categoria: "queja", queja: "proveedor", severidad: "alta",
    texto: "quiero poner una queja formal contra la aerolínea, perdieron mi silla de ruedas" },
  { id: "Q13", canal: "iato", at: DAY, categoria: "queja", queja: "servicio_iatos", severidad: "media", texto: "no me gustó" },
  { id: "Q14", canal: "formulario", elegida: "queja", at: DAY, categoria: "queja", queja: "cobro", severidad: "alta",
    texto: "Me cobraron el plan anual sin avisarme y nadie me contesta el correo" },
  // ── otros ──
  { id: "O01", canal: "iato", at: DAY, categoria: "otro", severidad: "alta", texto: "Necesito ayuda urgente, estoy en problemas" },
  // ── NO son incidentes (no se abre caso) ──
  { id: "N01", canal: "iato", at: DAY, categoria: null, texto: "¿Mi vuelo AF179 está a tiempo?" },
  { id: "N02", canal: "iato", at: DAY, categoria: null, texto: "Busca vuelos a Madrid para diciembre" },
  { id: "N03", canal: "iato", at: DAY, categoria: null, texto: "Quiero cancelar mi reserva del restaurante de mañana" },
  { id: "N04", canal: "iato", at: DAY, categoria: null, texto: "Recomiéndame un restaurante romántico en Roma" },
  { id: "N05", canal: "iato", at: DAY, categoria: null, texto: "¿Qué tiempo hará en Cancún el sábado?" },
  { id: "N06", canal: "iato", at: DAY, categoria: null, texto: "Gracias, todo salió perfecto" },
  { id: "N07", canal: "iato", at: DAY, categoria: null, texto: "Can you find me a hotel near the Colosseum?" },
  { id: "N08", canal: "iato", at: DAY, categoria: null, texto: "Perdón, ¿te molesto con una pregunta sobre mi itinerario?" },
];
