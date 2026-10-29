// Presupuesto del análisis de viaje (sin dependencias de Deno, para probar el código real).
//
// El modelo propone un desglose; aquí se recalcula de forma determinista con las opciones que
// el usuario va a ver, respetando lo que el usuario excluyó, y total = suma exacta del desglose.

// Habitaciones: módulo compartido con logistics-plan (Supabase solo empaqueta la carpeta de la
// función y _shared).
import { hotelPriceRooms, roomsFor } from "../_shared/rooms.ts";
export { hotelPriceRooms, roomsFor };

export const TIER_ORDER = ["ahorro", "equilibrio", "premium"];

/** Techo de comida por persona y día (fine dining: hasta $4,000 MXN por comida, 3 comidas). */
export const COMIDA_TECHO_DIA_PP = 12000;

/**
 * Agrupa los vuelos en los 3 tiers. Si el modelo devolvió varios tramos del mismo tier, se suman
 * (el precio de un tier es la ruta completa por persona). El tier se compara sin mayúsculas: antes
 * "Premium" no coincidía, caía en "equilibrio" y se sumaba ahí, inflando el vuelo base.
 */
export function normalizarVuelos(vuelos: any[]): any[] {
  if (!Array.isArray(vuelos)) return [];

  const agrupados = new Map<string, any>();
  for (const vuelo of vuelos) {
    const raw = String(vuelo?.tier ?? "").trim().toLowerCase();
    const tier = TIER_ORDER.includes(raw) ? raw : "equilibrio";
    const precio = Number(vuelo?.precio_por_persona) || 0;
    const existente = agrupados.get(tier);

    if (!existente) {
      agrupados.set(tier, { ...vuelo, tier, precio_por_persona: precio, _segmentos: [vuelo] });
      continue;
    }
    existente.precio_por_persona += precio;
    existente._segmentos.push(vuelo);
  }

  return TIER_ORDER.map((tier) => agrupados.get(tier))
    .filter(Boolean)
    .map((vuelo) => {
      const segmentos = vuelo._segmentos ?? [];
      const aerolineas = [...new Set(segmentos.map((s: any) => s?.aerolinea).filter(Boolean))];
      const notasSegmentos = segmentos
        .map((s: any) => `${s?.aerolinea ?? "Vuelo"}: $${Math.round(Number(s?.precio_por_persona) || 0).toLocaleString("es-MX")} MXN`)
        .join(" + ");
      const normalizado = {
        ...vuelo,
        aerolinea: segmentos.length > 1 ? aerolineas.join(" + ") : vuelo.aerolinea,
        duracion: segmentos.length > 1 ? "Ruta completa, varios segmentos" : vuelo.duracion,
        escalas: segmentos.length > 1 ? `${segmentos.length} segmentos sumados` : vuelo.escalas,
        // Varios tramos sumados ya no son "el" vuelo de una lista en vivo: es un total armado.
        ...(segmentos.length > 1 ? { fuente_precio: "estimado" } : {}),
        precio_por_persona: Math.round(vuelo.precio_por_persona),
        notas: segmentos.length > 1 ? `Total por persona sumando todos los tramos: ${notasSegmentos}` : vuelo.notas,
      };
      delete normalizado._segmentos;
      return normalizado;
    });
}

export type Exclusions = {
  vuelos: boolean;
  /** "all": sin hospedaje en todo el viaje · "partial": solo en alguna ciudad · false: incluido. */
  hospedaje: "all" | "partial" | false;
  tours: boolean;
  comida: boolean;
};

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

/**
 * Lo que el usuario dijo que NO quiere cotizar ("ya tengo vuelo", "sin hotel en París", "solo
 * vuelos"). Antes el recálculo del servidor volvía a sumar esos renglones aunque el modelo los
 * hubiera dejado en 0.
 */
export function detectExclusions(notas: unknown): Exclusions {
  const t = norm(notas);
  const out: Exclusions = { vuelos: false, hospedaje: false, tours: false, comida: false };
  if (!t) return out;

  const LODGING = "(hotel(es)?|hospedaje|alojamiento|donde (quedarme|quedarnos|dormir)|airbnb)";
  const FLIGHT = "(vuelos?|avion|boletos? de avion)";

  if (new RegExp(`(ya tengo|ya tenemos|ya compre|ya compramos|sin|no (necesito|necesitamos|quiero|queremos|incluyas|cotices)) (el |los |mi |mis |nuestro |nuestros )?${FLIGHT}`).test(t) ||
      new RegExp(`\\bsolo (el |los )?${LODGING}`).test(t) ||
      /\b(vamos|voy|iremos|ire) (en|por) (carro|coche|auto|camion|autobus|tren)\b/.test(t)) {
    out.vuelos = true;
  }

  // Exclusión de hospedaje por frase: "sin hotel", "ya tengo hotel", "París sin hospedaje"… Es
  // parcial si la frase nombra una ciudad ("en Roma", o "París sin hospedaje").
  const lodgingRe = new RegExp(`(ya tengo|ya tenemos|sin|no (necesito|necesitamos|quiero|queremos|incluyas|cotices)) (el |los |un |mi |nuestro )?${LODGING}`);
  for (const clause of String(notas ?? "").split(/[,.;\n]| pero | y luego /i)) {
    const c = norm(clause);
    if (!lodgingRe.test(c)) continue;
    const cityAfter = /\b(en|para) (?!todo|ningun|ninguna|nada|el viaje)[a-z]/.test(c);
    const cityBefore = /[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+(sin|no)\b/.test(clause.trim());
    const partial = cityAfter || cityBefore;
    out.hospedaje = partial ? (out.hospedaje === "all" ? "all" : "partial") : "all";
  }
  if (new RegExp(`\\bsolo (el |los )?${FLIGHT}`).test(t)) {
    out.hospedaje = "all";
    out.tours = true;
  }
  if (/\b(sin|no (quiero|queremos|incluyas|cotices)) (tours?|actividades|experiencias|excursiones)\b/.test(t)) out.tours = true;
  if (/\b(sin|no (quiero|queremos|incluyas|cotices)) (la |las )?(comidas?|alimentos)\b/.test(t)) out.comida = true;
  return out;
}

/** Rubros del desglose (los del esquema de la herramienta y los que agrega el servidor). */
export const RUBROS = ["vuelos", "hospedaje", "comida", "tours", "transporte_local", "extras"] as const;

const toAmount = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]|MXN/gi, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/**
 * El desglose que devolvió el modelo, solo si es un OBJETO de rubros con montos. Caso Budapest /
 * Liubliana (28-oct-2026): el modelo lo devolvió como TEXTO; `Object.entries` sobre el texto daba
 * claves "0".."30" con un dígito cada una y el viaje se guardó con total $7 MXN. Un texto que sea JSON
 * de un objeto se acepta; un arreglo, un texto libre o un objeto con claves numéricas → null (inválido).
 */
export function coerceDesglose(raw: unknown): Record<string, number> | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    const m = v.match(/\{[\s\S]*\}/);
    try { v = m ? JSON.parse(m[0]) : null; } catch { v = null; }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return null;
  // Claves de índice ("0", "1"…) = un texto o arreglo convertido en objeto: no son rubros.
  if (entries.some(([k]) => /^\d+$/.test(k))) return null;
  if (!entries.some(([k]) => (RUBROS as readonly string[]).includes(k) || k === "casetas")) return null;
  const out: Record<string, number> = {};
  for (const [k, val] of entries) out[k] = toAmount(val);
  return out;
}

/**
 * Piso de cordura del total (MXN): por debajo, la cotización no es creíble y no se guarda.
 * Internacional con vuelos: $500 por viajero (un viaje a Budapest no cuesta $7). Nacional: $100.
 */
export function totalFloor(o: { internacional?: boolean | null; viajeros: number; vuelosExcluidos?: boolean }): number {
  const T = Math.max(1, Math.round(Number(o.viajeros) || 1));
  return o.internacional && !o.vuelosExcluidos ? 500 * T : 100;
}

export type BudgetInput = {
  /** Noches del viaje (diferencia entre fechas). */
  dias: number;
  viajeros: number;
  notas?: string | null;
  /** Nivel de hotel que suma el total (el del perfil; por defecto el medio). Solo si algún hotel trae ese `tier`. */
  hotelTier?: "ahorro" | "equilibrio" | "premium" | null;
  /** Origen y destino en países distintos (para el piso de cordura del total). */
  internacional?: boolean | null;
  /** El servidor ya descartó el desglose del modelo por inválido (antes de agregarle el transporte terrestre). */
  reconstruir?: boolean;
};

/** Procedencia del precio de un renglón (la de la opción que se usó para calcularlo). */
export type Procedencia = { fuente: string | null; estado: string | null; consultado_at: string | null; nombre: string | null };

export type BudgetResult = {
  desglose: Record<string, number>;
  /**
   * Renglones sin precio: el modelo los dejó en 0, el usuario NO los excluyó y no hay ninguna opción
   * en vivo para calcularlos. Quedan "por cotizar": no suman al total (no son $0) y se dice que faltan.
   */
  porCotizar: Array<"vuelos" | "hospedaje">;
  /** De dónde salió el precio de vuelos y hospedaje. */
  procedencia: { vuelos: Procedencia | null; hospedaje: Procedencia | null };
  total: number;
  valido: boolean;
  /** Por qué no es válida: total en 0 o por debajo del piso de cordura. */
  motivoInvalido: "total_cero" | "total_absurdo" | null;
  /** El desglose del modelo no era un objeto de rubros: vuelos y hospedaje se reconstruyeron con las opciones. */
  reconstruido: boolean;
  exclusions: Exclusions;
  rooms: number;
  /** Habitaciones por las que se multiplicó el precio del hotel de referencia (1 si el precio es del grupo). */
  roomsPrecio: number;
  /** Hotel usado como referencia del renglón de hospedaje (precio medio). */
  hotelReferencia: any | null;
  /** Vuelo usado como referencia del renglón de vuelos (tier equilibrio). */
  vueloReferencia: any | null;
};

const LIVE_ESTADOS = new Set(["CONSULTADO_EN_VIVO", "VERIFICADO", "CONFIRMADO"]);
const LIVE_FUENTES = new Set(["serpapi", "google_flights", "google_hotels", "serpapi-hotels"]);

/**
 * ¿La opción trae un precio consultado en vivo? Lo decide enforceSources (estado_dato); sin estado, solo
 * una fuente en vivo conocida. Una tarifa de la caché de Travelpayouts ("ESTIMADO") no cuenta.
 */
export function isLiveOption(x: any): boolean {
  const estado = String(x?.estado_dato ?? "").toUpperCase();
  if (estado) return LIVE_ESTADOS.has(estado);
  return LIVE_FUENTES.has(String(x?.fuente_precio ?? x?.fuente ?? "").toLowerCase());
}

/** La opción en vivo a usar: la del nivel "equilibrio" si es en vivo; si no, la de precio medio. */
export function pickLiveOption(options: any[], priceKey: "precio_por_persona" | "precio_por_noche"): any | null {
  const live = (Array.isArray(options) ? options : []).filter((o) => isLiveOption(o) && Number(o?.[priceKey]) > 0);
  if (!live.length) return null;
  const eq = live.find((o) => String(o?.tier ?? "").toLowerCase() === "equilibrio");
  if (eq) return eq;
  const sorted = [...live].sort((x, y) => Number(x[priceKey]) - Number(y[priceKey]));
  return sorted[Math.floor(sorted.length / 2)];
}

const procedenciaDe = (x: any): Procedencia | null => x ? {
  fuente: x?.fuente_precio ?? x?.fuente ?? null, estado: x?.estado_dato ?? null, consultado_at: x?.consultado_at ?? null,
  nombre: x?.nombre ?? x?.aerolinea ?? null,
} : null;

/**
 * Desglose final de analizar-viaje:
 * - vuelos = vuelo "equilibrio" × viajeros, salvo que el usuario lo excluyó (0).
 * - Si el modelo dejó vuelos u hospedaje en 0 SIN que el usuario lo excluyera: con una opción en vivo
 *   para esa categoría se usa su precio (con su procedencia); sin opción en vivo el renglón queda
 *   "por cotizar" (porCotizar): no suma al total y se avisa que falta. Antes se respetaba el 0 y el
 *   total y el correo decían "no disponible" en un viaje con vuelos y hoteles en vivo.
 * - hospedaje = hotel de precio medio × noches × habitaciones (ceil(viajeros/2) si el precio es
 *   estimado por habitación; 1 si es un precio en vivo que ya cubre al grupo); antes era una
 *   sola habitación sin importar cuántos viajaban. Si el usuario excluyó una ciudad se respeta el
 *   monto del modelo (que ya descontó esas noches) y nunca se sube por encima del cálculo completo.
 * - comida: acotada al techo por persona y día.
 * - total = suma exacta del desglose; si la suma es 0 la cotización no es válida.
 */
export function reconcileBudget(a: any, input: BudgetInput): BudgetResult {
  const dias = Math.max(1, Math.round(Number(input.dias) || 1));
  const viajeros = Math.max(1, Math.round(Number(input.viajeros) || 1));
  const exclusions = detectExclusions(input.notas);
  const rooms = roomsFor(viajeros);
  // Desglose inválido (texto, arreglo, claves numéricas): se reconstruye con la lógica determinista de
  // abajo a partir de las opciones que la persona verá (vuelo equilibrio × viajeros, hotel × noches).
  const parsed = coerceDesglose(a?.desglose_presupuesto);
  const reconstruido = !parsed || !!input.reconstruir;
  const desglose: Record<string, number> = { ...(parsed ?? {}) };

  const porCotizar: BudgetResult["porCotizar"] = [];
  const vuelos: any[] = Array.isArray(a?.vuelos) ? a.vuelos : [];
  let vueloReferencia = vuelos.find((v) => v?.tier === "equilibrio") ?? vuelos[0] ?? null;
  if (exclusions.vuelos) {
    desglose.vuelos = 0;
  } else if ((desglose.vuelos ?? 0) > 0 || reconstruido) {
    const vuelosGrupo = Math.round((Number(vueloReferencia?.precio_por_persona) || 0) * viajeros);
    if (vuelosGrupo > 0) desglose.vuelos = vuelosGrupo;
    else if (reconstruido) { desglose.vuelos = 0; porCotizar.push("vuelos"); }
  } else {
    // El modelo puso 0 sin exclusión: precio en vivo si lo hay; si no, "por cotizar" (no es $0).
    const live = pickLiveOption(vuelos, "precio_por_persona");
    if (live) {
      vueloReferencia = live;
      desglose.vuelos = Math.round(Number(live.precio_por_persona) * viajeros);
    } else {
      desglose.vuelos = 0;
      porCotizar.push("vuelos");
    }
  }

  const hoteles: any[] = Array.isArray(a?.hospedaje) ? a.hospedaje : [];
  const ordenados = [...hoteles].sort((x, y) => (Number(x?.precio_por_noche) || 0) - (Number(y?.precio_por_noche) || 0));
  const porTier = input.hotelTier ? hoteles.find((h) => String(h?.tier ?? "") === input.hotelTier && Number(h?.precio_por_noche) > 0) : null;
  let hotelReferencia = porTier ?? (ordenados.length ? ordenados[Math.floor(ordenados.length / 2)] : null);
  // El precio en vivo ya es del grupo; uno estimado es por habitación (hotelPriceRooms).
  let roomsPrecio = hotelReferencia ? hotelPriceRooms(hotelReferencia, viajeros) : rooms;
  const hospedajeCompleto = Math.round((Number(hotelReferencia?.precio_por_noche) || 0) * dias * roomsPrecio);
  if (exclusions.hospedaje === "all") {
    desglose.hospedaje = 0;
  } else if (exclusions.hospedaje === "partial") {
    if (hospedajeCompleto > 0) desglose.hospedaje = Math.min(desglose.hospedaje ?? 0, hospedajeCompleto);
  } else if ((desglose.hospedaje ?? 0) > 0 || reconstruido) {
    if (hospedajeCompleto > 0) desglose.hospedaje = hospedajeCompleto;
    else if (reconstruido) { desglose.hospedaje = 0; porCotizar.push("hospedaje"); }
  } else {
    const live = pickLiveOption(hoteles, "precio_por_noche");
    if (live) {
      hotelReferencia = live;
      roomsPrecio = hotelPriceRooms(live, viajeros);
      desglose.hospedaje = Math.round(Number(live.precio_por_noche) * dias * roomsPrecio);
    } else {
      desglose.hospedaje = 0;
      porCotizar.push("hospedaje");
    }
  }

  if (exclusions.tours) desglose.tours = 0;
  if (exclusions.comida) desglose.comida = 0;
  const comidaTecho = COMIDA_TECHO_DIA_PP * dias * viajeros;
  if ((desglose.comida ?? 0) > comidaTecho) desglose.comida = comidaTecho;

  for (const k of ["vuelos", "hospedaje", "comida", "tours", "transporte_local", "extras"]) {
    desglose[k] = Math.max(0, Math.round(desglose[k] ?? 0));
  }
  for (const k of Object.keys(desglose)) desglose[k] = Math.max(0, Math.round(desglose[k]));
  const total = Object.values(desglose).reduce((s, v) => s + v, 0);
  const procedencia = {
    vuelos: desglose.vuelos > 0 ? procedenciaDe(vueloReferencia) : null,
    hospedaje: desglose.hospedaje > 0 ? procedenciaDe(hotelReferencia) : null,
  };
  const piso = totalFloor({ internacional: input.internacional, viajeros, vuelosExcluidos: exclusions.vuelos });
  const motivoInvalido = total <= 0 ? "total_cero" as const : total < piso ? "total_absurdo" as const : null;
  return { desglose, total, valido: !motivoInvalido, motivoInvalido, reconstruido, exclusions, rooms, roomsPrecio, hotelReferencia, vueloReferencia, porCotizar, procedencia };
}
