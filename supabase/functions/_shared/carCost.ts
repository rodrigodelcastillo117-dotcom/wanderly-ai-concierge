// Costo de ir "en tu coche" en un trayecto corto por carretera (caso CDMX → Tepoztlán, 27-oct-2026).
// Sin Deno ni red: lo usan analizar-viaje (al generar el viaje), la pantalla Comprar y las pruebas.
//
// Reglas de honestidad (las mismas del road trip, _shared/roadtrip/plan.ts):
//  * Casetas: monto REAL de Google Maps (Routes API, extraComputations TOLLS) de la ida, × 2 por el
//    regreso (se dice así). Sin monto de Google, "por confirmar": no se suma ni se inventa.
//  * Gasolina: SIEMPRE "estimado" con su fórmula a la vista: km de ida y vuelta × consumo supuesto
//    (7 L/100 km, el mismo supuesto del road trip) × precio promedio nacional de la gasolina regular
//    publicado por Profeco (con fecha y enlace).
//  * Nunca un precio "por persona" inventado por la IA: el costo es del coche (se reparte entre quienes
//    viajan solo para que el total cuadre).
import type { TollQuote } from "./tollQuote.ts";
import { placeDistanceKm } from "./airports.ts";

/** Mismo consumo supuesto que el road trip (DEFAULT_L_PER_100 de _shared/roadtrip/plan.ts). */
export const CAR_L_PER_100 = 7;

/**
 * Precio promedio nacional de la gasolina regular (pesos por litro): Profeco, "Quién es Quién en los
 * Precios — Gasolina y Diésel" del 26-oct-2026, precios vigentes del 13 al 19 de octubre de 2026 (con
 * datos de la CNE). PDF abierto con un GET público el 27-oct-2026.
 */
export const MX_GASOLINA = {
  precio_litro: 23.69,
  moneda: "MXN",
  fuente: {
    label: "Profeco · Quién es Quién en los Precios de la Gasolina (promedio nacional, regular)",
    url: "https://combustibles.profeco.gob.mx/qqpgasolina/2026/QQPGASOLINA_102626.pdf",
    consulted_at: "2026-10-27",
    data_date: "2026-10-19",
  },
} as const;

export type CasetasEstado = "CON_MONTO" | "SIN_MONTO" | "NO_DISPONIBLE" | "SIN_CONSULTAR";

export type CarCost = {
  version: 1;
  /** Km de ida y de dónde salen (Google Maps o aproximación por línea recta × 1.3). */
  km_ida: number | null;
  km_fuente: "google_routes" | "aproximado" | null;
  viaje_redondo: true;
  casetas: {
    estado: CasetasEstado;
    /** Monto de la ida en MXN (Google). */
    ida_mxn: number | null;
    /** Ida y vuelta (× 2). */
    total_mxn: number | null;
    fuente: "google_routes" | null;
    consultado_at: string | null;
    /** La consulta de Google tal cual (para TollInfo). */
    quote: TollQuote | null;
  };
  gasolina: {
    estado: "ESTIMADO" | "SIN_DATOS";
    total_mxn: number | null;
    km_total: number | null;
    litros_100km: number;
    precio_litro: number;
    /** "208 km × 7 L/100 km × $23.69/L" */
    formula: string | null;
    fuente: { label: string; url: string; consulted_at: string; data_date: string };
  };
  /** Casetas (reales) + gasolina (estimada); null si no hay ninguno de los dos. */
  total_mxn: number | null;
  /** Parte con precio real (casetas de Google) y parte estimada (gasolina). */
  real_mxn: number;
  estimado_mxn: number;
};

const money2 = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;

export function carCost(input: {
  kmIda: number | null | undefined;
  kmFuente?: "google_routes" | "aproximado" | null;
  /** null = no se consultó a Google (sin llave o vista previa); undefined = igual. */
  tolls?: TollQuote | null;
  /** true si se intentó consultar y Google no respondió. */
  tollsFailed?: boolean;
}): CarCost {
  const km = Number(input.kmIda) > 0 ? Math.round(Number(input.kmIda)) : null;
  const q = input.tolls ?? null;
  const ida = q && q.estado === "CON_MONTO" && Number(q.monto_mxn) >= 0 && q.monto_mxn !== null ? Math.round(Number(q.monto_mxn)) : null;
  const casetasEstado: CasetasEstado = q ? (ida !== null ? "CON_MONTO" : q.estado === "CON_MONTO" ? "SIN_MONTO" : q.estado) : input.tollsFailed ? "NO_DISPONIBLE" : "SIN_CONSULTAR";
  const kmTotal = km ? km * 2 : null;
  const gas = kmTotal ? Math.round((kmTotal * CAR_L_PER_100 / 100) * MX_GASOLINA.precio_litro) : null;
  const casetasTotal = ida !== null ? ida * 2 : null;
  const total = casetasTotal === null && gas === null ? null : (casetasTotal ?? 0) + (gas ?? 0);
  return {
    version: 1,
    km_ida: km,
    km_fuente: km ? input.kmFuente ?? "aproximado" : null,
    viaje_redondo: true,
    casetas: {
      estado: casetasEstado, ida_mxn: ida, total_mxn: casetasTotal,
      fuente: q ? "google_routes" : null, consultado_at: q?.consultado_at ?? null, quote: q,
    },
    gasolina: {
      estado: gas !== null ? "ESTIMADO" : "SIN_DATOS",
      total_mxn: gas, km_total: kmTotal, litros_100km: CAR_L_PER_100, precio_litro: MX_GASOLINA.precio_litro,
      formula: kmTotal ? `${kmTotal.toLocaleString("es-MX")} km${input.kmFuente === "google_routes" ? "" : " aprox."} (ida y vuelta) × ${CAR_L_PER_100} L/100 km × $${money2(MX_GASOLINA.precio_litro)}/L` : null,
      fuente: { ...MX_GASOLINA.fuente },
    },
    total_mxn: total,
    real_mxn: casetasTotal ?? 0,
    estimado_mxn: gas ?? 0,
  };
}

/** ¿La fila trae el costo del coche armado por el servidor? */
export function readCarCost(v: any): CarCost | null {
  const c = v?.costo_auto;
  return c && typeof c === "object" && c.version === 1 && c.casetas && c.gasolina ? (c as CarCost) : null;
}

/** Textos para la pantalla y el correo (nunca "sin casetas"). */
export function carCostLines(c: CarCost): { casetas: string; gasolina: string; total: string | null } {
  const casetas = c.casetas.total_mxn !== null
    ? `Casetas: ${money0(c.casetas.total_mxn)} MXN ida y vuelta (${money0(c.casetas.ida_mxn ?? 0)} de ida × 2) · Google Maps`
    : c.casetas.estado === "SIN_MONTO" ? "Casetas: hay casetas en la ruta; Google no publica el monto"
    : c.casetas.estado === "SIN_CONSULTAR" ? "Casetas: sin consultar"
    : "Casetas: información no disponible para esta ruta";
  const gasolina = c.gasolina.total_mxn !== null
    ? `Gasolina: ~${money0(c.gasolina.total_mxn)} MXN · estimado (${c.gasolina.formula})`
    : "Gasolina: sin distancia para estimarla";
  const total = c.total_mxn !== null ? `${money0(c.total_mxn)} MXN por el coche${c.casetas.total_mxn === null ? " (sin casetas)" : ""}` : null;
  return { casetas, gasolina, total };
}

/** Carretera ≈ 1.3 × línea recta en el centro de México (mismo factor del análisis de trayectos cortos). */
export const ROAD_FACTOR_MX = 1.3;

/** Km de ida por carretera aproximados entre dos lugares conocidos (_shared/airports.ts); null si no se conocen. */
export function approxRoadKmOf(origin: unknown, destination: unknown): number | null {
  const km = placeDistanceKm(origin, destination);
  return km != null && km > 0 ? Math.round(km * ROAD_FACTOR_MX) : null;
}

/** Chofer, taxi o traslado privado: no es "tu coche" (no se le calculan casetas ni gasolina). */
export const isHiredCar = (v: any) => /chofer|privad|taxi|uber|didi|traslado/i.test(String(v?.aerolinea ?? v?.provider ?? ""));

const groundModeOf = (v: any): "auto" | "autobus" | "contratado" | null => {
  const m = String(v?.modo ?? v?.mode ?? "").toLowerCase();
  if ((m === "auto" || m === "coche" || m === "carro") && isHiredCar(v)) return "contratado";
  if (m === "auto" || m === "coche" || m === "carro") return "auto";
  if (m === "autobus" || m === "bus") return "autobus";
  return null;
};

/**
 * Precio para el GRUPO de una opción terrestre de trips.vuelos_json, el mismo en la página, en el total y
 * en el correo (enviar-seleccion lo vuelve a calcular con la fila del viaje):
 *  - coche: casetas reales + gasolina estimada (costo_auto del análisis; en un viaje guardado antes, la
 *    gasolina con km aproximados). Nunca el "precio_por_persona" que escribió la IA.
 *  - autobús o chofer/traslado contratado: null (el precio se ve con la línea o el operador).
 * `undefined` si la fila no es terrestre (se usa precio_por_persona × viajeros como siempre).
 */
export function groundGroupPrice(v: any, trip: { ciudad_origen?: unknown; destino?: unknown } | null | undefined): number | null | undefined {
  const mode = groundModeOf(v);
  if (!mode) return undefined;
  // Autobús y chofer contratado: sin precio inventado (se ve con la línea o el operador).
  if (mode === "autobus" || mode === "contratado") return null;
  const saved = readCarCost(v);
  const cost = saved ?? carCost({ kmIda: Number(v?.km) > 0 ? Number(v.km) : approxRoadKmOf(trip?.ciudad_origen, trip?.destino), kmFuente: "aproximado", tolls: null });
  return cost.total_mxn;
}
