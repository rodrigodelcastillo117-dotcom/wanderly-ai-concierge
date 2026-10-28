// Fixtures de la salida de la IA de interpretar-viaje (formato de _shared/tripSpec.ts), para probar sin red.
// El texto exacto de Diego no se guardó en ningún lado (ese era parte del problema): este es representativo.

export const DIEGO_TEXT =
  "Quiero ir a Arabia Saudita, luego un crucero, Cape Town y el regreso por Londres, más o menos del 15 de noviembre al 19 de diciembre de 2027, somos 2 personas desde Ciudad de México. Algo de lujo.";

/** Lo que devolvería el modelo (con lo que suele hacer mal: sin pregunta del regreso, puertos propuestos). */
export const DIEGO_AI = {
  intencion: "viaje_futuro",
  origen: "Ciudad de México",
  paradas: [
    { id: "p1", ciudad: "Riad", pais: "Arabia Saudita", de_region: "Arabia Saudita", rol: "estancia", noches: null, llegada_por: "vuelo", sugerida: true, texto: "Arabia Saudita" },
    { id: "p2", ciudad: "AlUla", pais: "Arabia Saudita", de_region: "Arabia Saudita", rol: "estancia", noches: null, llegada_por: "por_definir", sugerida: true, texto: "Arabia Saudita" },
    { id: "p3", ciudad: "Yeda", pais: "Arabia Saudita", de_region: "Arabia Saudita", es_puerto: true, rol: "estancia", noches: null, llegada_por: "por_definir", sugerida: true, texto: "Arabia Saudita" },
    // El modelo inventa naviera y precio: el validador los quita.
    { id: "p4", ciudad: "Ciudad del Cabo", pais: "Sudáfrica", es_puerto: true, rol: "estancia", noches: null, llegada_por: "crucero", sugerida: false, texto: "Cape Town",
      crucero: { naviera: "MSC Cruceros", puerto_salida: "Yeda", puerto_llegada: "Ciudad del Cabo", noches: null, precio_por_persona: 45000 } },
  ],
  regreso: { a: "Ciudad de México", via: "Londres", modo: "vuelo" },
  fecha_salida: "2027-11-15", fecha_regreso: "2027-12-19", fechas_expresas: true,
  viajeros: 2,
  preferencias: ["Lujo"],
  reservas: [],
  menciones: [
    { texto: "Arabia Saudita", tipo: "pais", estado: "parada", ref: "p1" },
    { texto: "crucero", tipo: "crucero", estado: "tramo", ref: "p4" },
    { texto: "Cape Town", tipo: "ciudad", estado: "parada", ref: "p4" },
    { texto: "Londres", tipo: "regreso", estado: "regreso", ref: null },
    { texto: "Ciudad de México", tipo: "origen", estado: "origen", ref: null },
  ],
  preguntas: [
    { id: "q1", tipo: "ciudades_de_pais", texto: "Arabia Saudita", pregunta: "Arabia Saudita: te proponemos Riad, AlUla y Yeda. ¿Así?", opciones: ["Sí, Riad, AlUla y Yeda"], parada: "p1" },
  ],
  sugerencias: ["Podrías terminar en Yeda para tomar el crucero sin volver a Riad."],
};

export const ITALIA_TEXT = "Roma, Florencia, Venecia y Toscana 15 días";
export const ITALIA_AI = {
  intencion: "viaje_futuro", origen: null,
  paradas: [
    { id: "p1", ciudad: "Roma", rol: "estancia", noches: 4, llegada_por: "vuelo", texto: "Roma" },
    { id: "p2", ciudad: "Florencia", rol: "estancia", noches: 3, llegada_por: "tren", texto: "Florencia" },
    { id: "p3", ciudad: "Venecia", rol: "estancia", noches: 3, llegada_por: "tren", texto: "Venecia" },
    { id: "p4", ciudad: "Siena", de_region: "Toscana", rol: "estancia", noches: 2, llegada_por: "tren", sugerida: true, texto: "Toscana" },
    { id: "p5", ciudad: "Lucca", de_region: "Toscana", rol: "estancia", noches: 2, llegada_por: "coche", sugerida: true, texto: "Toscana" },
  ],
  regreso: { a: null, via: null, modo: "vuelo" },
  fecha_salida: null, fecha_regreso: null, fechas_expresas: false, noches_total: 14, viajeros: null,
  menciones: [
    { texto: "Roma", tipo: "ciudad", estado: "parada", ref: "p1" }, { texto: "Florencia", tipo: "ciudad", estado: "parada", ref: "p2" },
    { texto: "Venecia", tipo: "ciudad", estado: "parada", ref: "p3" }, { texto: "Toscana", tipo: "region", estado: "parada", ref: "p4" },
  ],
  preguntas: [{ id: "q1", tipo: "fechas", texto: "15 días", pregunta: "¿Qué fechas? Son 15 días.", opciones: [] }],
};

export const TEPOZ_TEXT = "fin de semana en Tepoztlán";
export const TEPOZ_AI = {
  intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [{ id: "p1", ciudad: "Tepoztlán", pais: "México", rol: "estancia", noches: 2, llegada_por: "coche", texto: "Tepoztlán" }],
  regreso: { a: "Ciudad de México", via: null, modo: "coche" },
  fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", fechas_expresas: true, viajeros: 2,
  menciones: [{ texto: "Tepoztlán", tipo: "ciudad", estado: "parada", ref: "p1" }],
  preguntas: [],
};

export const AMBIGUO_TEXT = "Córdoba y luego algo de playa, como en marzo";
export const AMBIGUO_AI = {
  intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [{ id: "p1", ciudad: "Córdoba", rol: "estancia", llegada_por: "por_definir", texto: "Córdoba" }],
  regreso: { a: "Ciudad de México", via: null, modo: "por_definir" },
  fecha_salida: null, fecha_regreso: null, fechas_expresas: false, viajeros: null,
  menciones: [
    { texto: "Córdoba", tipo: "ciudad", estado: "pregunta", ref: "q1" },
    { texto: "algo de playa", tipo: "otro", estado: "pregunta", ref: "q2" },
  ],
  preguntas: [
    { id: "q1", tipo: "lugar_desconocido", texto: "Córdoba", pregunta: "¿Córdoba, España o Córdoba, Argentina?", opciones: ["Córdoba, España", "Córdoba, Argentina"], parada: "p1" },
    { id: "q2", tipo: "otro", texto: "algo de playa", pregunta: "¿Qué playa tienes en mente? Podemos sugerirte una.", opciones: [] },
  ],
};
