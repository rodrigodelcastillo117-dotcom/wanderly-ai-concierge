// Definición ÚNICA de las herramientas de Iato (Concierge 2.0). Lógica pura, importable desde Vitest.
//
// Antes cada proveedor tenía su lista en index.ts (formato OpenAI) y la descripción de
// search_attractions invitaba a usar TripAdvisor para cualquier cosa: "¿dónde está la Centurion en la
// T1?" terminó en TripAdvisor, que no trae ubicaciones de salas de aeropuerto. Ahora:
//   * una sola lista neutral → se convierte al formato de Claude (Messages API) o al de OpenAI (respaldo);
//   * cada descripción dice CUÁNDO usarla (y cuándo no), que es lo que el modelo usa para elegir;
//   * el orden es fijo: la lista forma parte del prefijo que se guarda en la caché de prompt.

export interface JsonSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  default?: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema & { type: "object"; properties: Record<string, JsonSchema> };
}

import { SEARCH_PRIVE_TOOL } from "./prive.ts";
import { ADVISORY_TOOL_DEF } from "../_shared/advisoryTool.ts";
import { REPORT_INCIDENT_TOOL } from "./incident.ts";
import { RECLAMOS_TOOL_DEFS } from "../_shared/derechos/herramientas.ts";

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "check_flight_status",
    description:
      "Estado EN VIVO de un vuelo concreto: a tiempo, retrasado o cancelado, terminal, puerta y hora estimada. " +
      "Úsala siempre que pregunten por el estatus de un vuelo (suyo o de otra persona) o cuando un vuelo del viaje sale hoy o mañana. " +
      "Nunca digas que no puedes consultar un vuelo sin haberla intentado.",
    input_schema: {
      type: "object",
      properties: {
        flight: { type: "string", description: "Número de vuelo, ej. 'AF179' o 'AM 002'" },
        date: { type: "string", description: "YYYY-MM-DD (opcional; por defecto hoy en la zona del usuario)" },
        route: { type: "string", description: "Ej. 'MEX-CDG' (opcional, ayuda a desambiguar)" },
      },
      required: ["flight"],
    },
  },
  {
    name: "search_flights",
    description:
      "Vuelos reales para comprar (Google Flights) con precio, duración, escalas y enlace de compra. " +
      "Úsala para comparar o cotizar vuelos, para buscar alternativas cuando un vuelo se canceló o se perdió una conexión, " +
      "o cuando pregunten qué vuelo conviene.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Ciudad o código IATA de origen, ej. CDMX o MEX" },
        destination: { type: "string", description: "Ciudad o código IATA de destino" },
        departure_date: { type: "string", description: "YYYY-MM-DD" },
        return_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
        adults: { type: "integer", description: "Pasajeros adultos (default 1)" },
      },
      required: ["origin", "destination", "departure_date"],
    },
  },
  {
    name: "search_hotels",
    description: "Hoteles reales (Google Hotels) con precio por noche, rating y enlace de reserva para una ciudad y fechas.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string" },
        checkin: { type: "string", description: "YYYY-MM-DD" },
        checkout: { type: "string", description: "YYYY-MM-DD" },
        adults: { type: "integer", description: "default 2" },
        hotel_class: { type: "string", description: "Ej. '5' para 5 estrellas (opcional)" },
      },
      required: ["city", "checkin", "checkout"],
    },
  },
  {
    name: "search_places",
    description:
      "Google Maps: datos de un lugar concreto o lugares por tipo cerca de un punto. Devuelve dirección, coordenadas, rating, " +
      "si está abierto, sitio web y enlace de Maps; con details=true también horario completo y teléfono del primer resultado. " +
      "Úsala para '¿dónde está X?', '¿a qué hora abre X?', 'teléfono de X', 'restaurantes cerca de mi hotel', 'un bar en Polanco'. " +
      "Para restaurantes trae además si acepta reservaciones (reservable), si sirve desayuno/brunch/comida/cena, teléfono y los botones de reserva " +
      "(sitio, TheFork, llamar, WhatsApp). Para 'cena romántica' o 'cena especial' pon esas palabras en query (no etiquetes nada como romántico por tu cuenta). " +
      "Museos de la tabla oficial traen taquilla_oficial (URL y nota). Incluye la ciudad o el punto de referencia en query.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Ej. 'restaurantes cerca de Hôtel Le Marais, París' o 'Museo Soumaya CDMX'" },
        lat: { type: "number", description: "Latitud para centrar la búsqueda (opcional)" },
        lng: { type: "number", description: "Longitud para centrar la búsqueda (opcional)" },
        details: { type: "boolean", description: "true para traer horario y teléfono del primer resultado" },
        open_now: { type: "boolean", description: "Solo lugares abiertos ahora (opcional)" },
        meal: { type: "string", enum: ["desayuno", "brunch", "comida", "cena"], description: "Solo restaurantes que Google marca que sirven esa comida (opcional)" },
        city: { type: "string", description: "Ciudad del lugar (para el botón de TheFork y la taquilla oficial), ej. 'Florencia' (opcional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_nearby",
    description:
      "Servicios cercanos a unas coordenadas: hospital, policía, farmacia, cajero, embajada, gasolinera, hotel o restaurante. " +
      "Úsala en emergencias o cuando solo tengas coordenadas. Usa la ubicación de <perfil_usuario> o la del hotel del viaje; nunca inventes coordenadas.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        kind: { type: "string", enum: ["restaurant", "hospital", "police", "pharmacy", "atm", "embassy", "gas_station", "lodging"] },
        keyword: { type: "string", description: "Filtro adicional (ej. 'sushi omakase')" },
      },
      required: ["lat", "lng", "kind"],
    },
  },
  {
    name: "web_search",
    description:
      "Búsqueda web (Google) para datos prácticos y actuales con su fuente: ubicación de salas de aeropuerto (lounges como Centurion o Priority Pass) " +
      "y en qué terminal o puerta están, reglas de equipaje, requisitos de visa o de entrada, derechos del pasajero ante cancelaciones, " +
      "huelgas, horarios de museos o eventos. Devuelve título, fragmento y enlace: cita la fuente. " +
      "Úsala antes de afirmar cualquier dato práctico que no esté en el contexto.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "La pregunta en palabras clave, con ciudad o aeropuerto. Ej. 'Centurion Lounge Terminal 1 AICM ubicación'" },
        country: { type: "string", description: "Código de país de 2 letras para los resultados (default mx)" },
      },
      required: ["query"],
    },
  },
  // Avisos oficiales (GOV.UK y Departamento de Estado; la SRE va primero como enlace).
  {
    name: ADVISORY_TOOL_DEF.name,
    description: ADVISORY_TOOL_DEF.description,
    input_schema: ADVISORY_TOOL_DEF.input_schema as unknown as ToolDef["input_schema"],
  },
  {
    name: "get_weather",
    description:
      "Clima REAL de una ciudad: pronóstico por día de MET Norway (≈9 días: máxima, mínima, cielo, lluvia y viento) y, para fechas más " +
      "lejanas, el clima típico del mes de NASA POWER (promedio de 25 años). Es la MISMA fuente que la pantalla Clima de IATOS. " +
      "Úsala SIEMPRE que pregunten por el clima, la temperatura, si va a llover o qué ropa llevar por el clima, con las fechas del viaje si es su viaje. " +
      "Cita la fuente y la hora de consulta; si las fechas están fuera del pronóstico, dilo y da el clima típico como típico, no como pronóstico. " +
      "Nunca des temperaturas de memoria.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Ciudad, ej. 'Madrid' o 'Valle de Bravo'" },
        date_from: { type: "string", description: "YYYY-MM-DD, primer día (opcional; las fechas del viaje si habla de su viaje; por defecto hoy)" },
        date_to: { type: "string", description: "YYYY-MM-DD, último día (opcional)" },
      },
      required: ["city"],
    },
  },
  {
    // Auditoría 10, ronda 3 (N-P1-6): "¿qué hora es en Tokio?" → "no tengo reloj". Ahora la calcula IATOS.
    name: "get_local_time",
    description:
      "Hora ACTUAL en una ciudad o zona horaria (reloj de IATOS: UTC del servidor + zona IANA, con horario de verano), y la diferencia con el usuario. " +
      "Úsala SIEMPRE que pregunten qué hora es en otro lugar o la diferencia de horario. Responde al instante; nunca digas que no tienes reloj.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Ciudad o país, ej. 'Tokio' o 'Lisboa'" },
        timezone: { type: "string", description: "Zona IANA si la sabes, ej. 'Asia/Tokyo' (opcional)" },
      },
      required: ["city"],
    },
  },
  {
    name: "search_events",
    description:
      "Eventos reales (Ticketmaster y Google Events): conciertos, teatro, deportes, festivales y espectáculos en una ciudad y un rango de fechas, " +
      "con fecha y hora, recinto, dirección y enlaces a sitios de boletos. Úsala SOLO cuando el usuario pida eventos, conciertos, teatro, " +
      "deportes o qué hacer en fechas concretas. Precio solo si Ticketmaster lo publica (precio_desde, puede cambiar). Si no hay resultados, dilo; nunca inventes eventos.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Ciudad, ej. 'Madrid' o 'Ciudad de México'" },
        date_from: { type: "string", description: "YYYY-MM-DD, inicio del rango (opcional; usa las fechas del viaje si las pide para su viaje)" },
        date_to: { type: "string", description: "YYYY-MM-DD, fin del rango (opcional)" },
        query: { type: "string", description: "Tipo de evento en palabras clave, ej. 'conciertos', 'teatro', 'partido Real Madrid' (opcional)" },
      },
      required: ["city"],
    },
  },
  {
    name: "search_tours",
    description:
      "Tours y actividades reales de Viator en una ciudad: título, foto, calificación y reseñas, duración, precio \"desde\" con su moneda " +
      "y el enlace a la ficha en viator.com. Úsala SOLO cuando el usuario pida tours, excursiones o actividades. \"Ver en Viator\" no es una " +
      "reserva. Si no hay resultados o no está disponible, dilo; nunca inventes tours ni precios.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Ciudad, ej. 'Roma' o 'Cancún'" },
        query: { type: "string", description: "Qué tipo de tour, en palabras clave, ej. 'Coliseo', 'snorkel', 'tour gastronómico' (opcional)" },
        date_from: { type: "string", description: "YYYY-MM-DD, inicio (opcional; las fechas del viaje si habla de su viaje)" },
        date_to: { type: "string", description: "YYYY-MM-DD, fin (opcional)" },
      },
      required: ["city"],
    },
  },
  {
    name: "search_attractions",
    description:
      "Rankings y reseñas (TripAdvisor) de restaurantes, atracciones u hoteles en una ciudad, ej. 'mejores restaurantes de sushi en Tokio'. " +
      "NO la uses para ubicaciones, horarios, teléfonos, reglas, terminales ni salas de aeropuerto: para eso usa web_search o search_places.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Incluye la ciudad. Ej. 'best michelin in Paris'" },
        category: { type: "string", enum: ["hotels", "attractions", "restaurants", "geos"] },
      },
      required: ["query"],
    },
  },
  {
    name: "search_members_venues",
    description:
      "Lugares de vida nocturna seleccionados de Members Only (rooftops, speakeasies, jazz, cabaret, clubs) en una ciudad, con fuente y " +
      "fecha de verificación. Solo para usuarios con IATOS PRO; si responde que no tiene acceso, dilo y no inventes lugares.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Ciudad o barrio, ej. 'CDMX', 'Polanco', 'Madrid'" },
        category: { type: "string", description: "Opcional: rooftop, speakeasy, jazz_lounge, cabaret, members_club…" },
      },
      required: ["city"],
    },
  },
  // IATOS Privé (prive.ts): misma definición que antes, en formato neutral.
  {
    name: SEARCH_PRIVE_TOOL.function.name,
    description: SEARCH_PRIVE_TOOL.function.description,
    input_schema: SEARCH_PRIVE_TOOL.function.parameters as unknown as ToolDef["input_schema"],
  },
  // Incidentes: abre un caso que atiende el equipo (migración 20261029080000_incidentes).
  REPORT_INCIDENT_TOOL,
  // Derechos y reclamaciones del Operador IATOS (_shared/derechos/herramientas.ts). Solo registro: la lógica
  // y las descripciones viven allá; el ejecutor está en index.ts (makeRawExecTool → runReclamosTool).
  ...(RECLAMOS_TOOL_DEFS as unknown as ToolDef[]),
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Formato de la Messages API de Claude. Con streaming se pide la entrada de la herramienta sin búfer. */
export function toAnthropicTools(defs: ToolDef[] = TOOL_DEFS, { eager = true } = {}) {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
    ...(eager ? { eager_input_streaming: true } : {}),
  }));
}

/** Formato OpenAI (gateway de respaldo). */
export function toOpenAiTools(defs: ToolDef[] = TOOL_DEFS) {
  return defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.input_schema } }));
}

export const toolDef = (name: string) => TOOL_DEFS.find((t) => t.name === name) ?? null;

const typeOk = (schema: JsonSchema, v: unknown): boolean => {
  switch (schema.type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "array": return Array.isArray(v);
    case "object": return !!v && typeof v === "object" && !Array.isArray(v);
    default: return true;
  }
};

/**
 * Valida la entrada de una herramienta contra su esquema (con streaming sin búfer el servidor ya no la
 * valida). Tolerante donde no importa: números que llegan como texto se convierten. Devuelve la
 * entrada limpia o el motivo del rechazo.
 */
export function validateToolInput(name: string, input: unknown): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const def = toolDef(name);
  if (!def) return { ok: false, error: `herramienta desconocida: ${name}` };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "la entrada debe ser un objeto JSON" };
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    const schema = def.input_schema.properties[k];
    if (!schema) continue; // campos de más se ignoran
    let v = raw;
    if ((schema.type === "number" || schema.type === "integer") && typeof v === "string" && v.trim() && Number.isFinite(Number(v))) v = Number(v);
    if (schema.type === "integer" && typeof v === "number") v = Math.round(v);
    if (schema.type === "boolean" && (v === "true" || v === "false")) v = v === "true";
    if (v === null || v === undefined || v === "") continue;
    if (!typeOk(schema, v)) return { ok: false, error: `"${k}" debe ser ${schema.type}` };
    if (schema.enum && typeof v === "string" && !schema.enum.includes(v)) return { ok: false, error: `"${k}" debe ser uno de: ${schema.enum.join(", ")}` };
    out[k] = v;
  }
  for (const r of def.input_schema.required ?? []) {
    if (out[r] === undefined) return { ok: false, error: `falta "${r}"` };
  }
  return { ok: true, input: out };
}
