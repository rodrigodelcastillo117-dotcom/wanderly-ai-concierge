// Viaje de varias ciudades al que se llega por carretera (recorrido road trip, 9-nov-2026): «Road trip en coche desde
// CDMX a Querétaro, San Miguel de Allende y Guanajuato» cotizaba un VUELO CDMX → Querétaro de $8,004 (estimado) y
// traslados a los aeropuertos de Querétaro y del Bajío. Si el viajero dijo coche/autobús/tren para llegar (y no dijo
// avión para volver), o su casa está a menos de 300 km en línea recta de la primera y de la última ciudad, no se
// buscan vuelos: se cotiza el coche (gasolina estimada; casetas en la ruta). Puro: lo usan logistics-plan y la app.
import { placeDistanceKm } from "./airports.ts";
import { approxRoadKmOf, CAR_L_PER_100, carCost, carCostLines, MX_GASOLINA, type CarCost } from "./carCost.ts";
import type { TollQuote } from "./tollQuote.ts";
// Ciudades de México con coordenadas curadas (Cholula, Guanajuato, San Miguel…) que el catálogo de aeropuertos no tiene.
import { detectShortTrip } from "./groundTransport.ts";

/** Por debajo de esta distancia en línea recta no hay vuelo lógico (mismo umbral que la app, groundTrip.ts). */
export const NO_FLIGHT_KM = 300;

export type ModoTierra = "coche" | "autobus" | "tren";
export type LlegadaTierra = {
  version: 1;
  modo: ModoTierra;
  origen: string;
  primera: string;
  ultima: string;
  /** Km por carretera aproximados (línea recta × 1.3); null si no se conoce la ciudad. */
  km_ida: number | null;
  km_regreso: number | null;
  /** Gasolina (estimada) de ida + regreso para el coche; null en autobús/tren. */
  costo_auto: CarCost | null;
  /** Km y horas de Google Maps (Routes) si se consultaron; si no, la aproximación de arriba. */
  fuente_km?: "google_routes" | "aproximado";
  horas_ida?: number | null;
  horas_regreso?: number | null;
  /** Casetas reales de Google de cada tramo (MXN); null si no hay monto. */
  casetas_ida_mxn?: number | null;
  casetas_regreso_mxn?: number | null;
};

type Ruta = { ok: boolean; distance_meters?: number | null; duration_seconds?: number | null; tolls?: TollQuote | null } | null | undefined;

/**
 * Con las rutas reales de Google (ida casa → primera ciudad y regreso última ciudad → casa): km, horas y casetas
 * de cada tramo. El costo del coche = casetas de los dos tramos + gasolina por los km de los dos tramos.
 */
export function conRutas(t: LlegadaTierra, ida: Ruta, regreso: Ruta): LlegadaTierra {
  if (t.modo !== "coche") return t;
  const km = (x: Ruta) => (x?.ok && Number(x.distance_meters) > 0 ? Math.round(Number(x.distance_meters) / 1000) : null);
  const h = (x: Ruta) => (x?.ok && Number(x.duration_seconds) > 0 ? Math.round((Number(x.duration_seconds) / 3600) * 10) / 10 : null);
  const caseta = (x: Ruta) => (x?.ok && x.tolls?.estado === "CON_MONTO" && x.tolls.monto_mxn != null ? Math.round(Number(x.tolls.monto_mxn)) : null);
  const kIda = km(ida) ?? t.km_ida, kReg = km(regreso) ?? t.km_regreso;
  const google = km(ida) != null && km(regreso) != null;
  const cIda = caseta(ida), cReg = caseta(regreso);
  const kmMedio = kIda != null && kReg != null ? (kIda + kReg) / 2 : kIda ?? kReg;
  // carCost suma «ida × 2»: con el promedio de los dos tramos el total es exactamente ida + regreso.
  const tolls: TollQuote | null = cIda != null && cReg != null && ida?.tolls
    ? { ...ida.tolls, monto_mxn: (cIda + cReg) / 2 } : null;
  return {
    ...t, km_ida: kIda, km_regreso: kReg, fuente_km: google ? "google_routes" : "aproximado",
    horas_ida: h(ida), horas_regreso: h(regreso), casetas_ida_mxn: cIda, casetas_regreso_mxn: cReg,
    costo_auto: kmMedio ? carCost({ kmIda: kmMedio, kmFuente: google ? "google_routes" : "aproximado", tolls, tollsFailed: !tolls && (!!ida || !!regreso),
      kmTotal: kIda != null && kReg != null ? kIda + kReg : null }) : t.costo_auto,
  };
}

/** Gasolina estimada de un tramo en tu coche (MXN del coche, no por persona); null sin km. */
export function gasolinaTramoMxn(km: unknown): number | null {
  const k = Number(km);
  return k > 0 ? Math.round((k * CAR_L_PER_100 / 100) * MX_GASOLINA.precio_litro) : null;
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function modoDe(v: unknown): ModoTierra | "avion" | null {
  const m = norm(v);
  if (!m) return null;
  if (/^(avion|vuelo|volar)/.test(m)) return "avion";
  if (/^(coche|auto|carro|camioneta|manej)/.test(m)) return "coche";
  if (/^(autobus|bus|camion)/.test(m)) return "autobus";
  if (/^tren/.test(m)) return "tren";
  return null;
}

export function llegadaPorTierra(origin: unknown, destinations: unknown[], prefs?: { arrival_mode?: unknown; return_mode?: unknown } | null): LlegadaTierra | null {
  const cities = (Array.isArray(destinations) ? destinations : []).map((c) => String(c ?? "").trim()).filter(Boolean);
  const origen = String(origin ?? "").trim();
  if (!origen || !cities.length) return null;
  const ida = modoDe(prefs?.arrival_mode), vuelta = modoDe(prefs?.return_mode);
  if (ida === "avion" || vuelta === "avion") return null;
  const primera = cities[0], ultima = cities[cities.length - 1];
  const cerca = (a: string, b: string) => {
    const k = placeDistanceKm(a, b);
    return (k != null && k < NO_FLIGHT_KM) || !!detectShortTrip(a, b);
  };
  const porTierraIda = !!ida || cerca(origen, primera);
  const porTierraVuelta = !!vuelta || (!vuelta && !!ida) || cerca(ultima, origen);
  if (!porTierraIda || !porTierraVuelta) return null;
  const modo: ModoTierra = ida ?? vuelta ?? "coche";
  const roadKm = (a: string, b: string) => approxRoadKmOf(a, b) ?? detectShortTrip(a, b, 2000)?.approxRoadKm ?? null;
  const km_ida = roadKm(origen, primera), km_regreso = roadKm(ultima, origen);
  // carCost suma ida × 2: con ciudades distintas de ida y regreso se usa el promedio para que el total sea ida + regreso.
  const kmMedio = km_ida != null && km_regreso != null ? (km_ida + km_regreso) / 2 : km_ida ?? km_regreso;
  return {
    version: 1, modo, origen, primera, ultima, km_ida, km_regreso,
    costo_auto: modo === "coche" && kmMedio ? carCost({ kmIda: kmMedio, kmFuente: "aproximado", tolls: null, kmTotal: km_ida != null && km_regreso != null ? km_ida + km_regreso : null }) : null,
  };
}

const enlaceMaps = (a: string, b: string) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(a)}&destination=${encodeURIComponent(b)}&travelmode=driving`;

/**
 * La fila de «Cómo llegar» del viaje (trips.vuelos_json) con la misma forma que el coche de un viaje de un destino
 * (analizar-viaje/realGroundOptions): así Comprar, el total y el correo la tratan como terrestre.
 */
export function filaLlegadaTierra(t: LlegadaTierra, viajeros: number): Record<string, unknown> {
  const T = Math.max(1, Math.round(Number(viajeros) || 1));
  const aprox = t.fuente_km === "google_routes" ? "" : "~";
  const tramo = `${t.origen} → ${t.primera}${t.km_ida ? ` (${aprox}${t.km_ida} km)` : ""} y regreso ${t.ultima} → ${t.origen}${t.km_regreso ? ` (${aprox}${t.km_regreso} km)` : ""}`;
  if (t.modo !== "coche" || !t.costo_auto) {
    return {
      tier: "equilibrio", modo: t.modo, aerolinea: t.modo === "tren" ? "Tren" : "Autobús", duracion: "", escalas: "Terrestre",
      precio_por_persona: 0, precio_min: null, precio_max: null, fuente_precio: "estimado", estado_dato: "ESTIMADO",
      booking_link: null, notas: `${tramo}. Horarios y precio con la línea: IATOS no lo cotiza.`,
      from: t.origen, to: t.primera, ciudad: t.primera,
    };
  }
  const lines = carCostLines(t.costo_auto);
  // Casetas de dos tramos distintos: se dice la suma real (no «ida × 2»).
  const casetas = t.casetas_ida_mxn != null && t.casetas_regreso_mxn != null
    ? `Casetas: $${(t.casetas_ida_mxn + t.casetas_regreso_mxn).toLocaleString("es-MX")} MXN ida + regreso ($${t.casetas_ida_mxn.toLocaleString("es-MX")} + $${t.casetas_regreso_mxn.toLocaleString("es-MX")}) · Google Maps`
    : lines.casetas;
  return {
    tier: "equilibrio", modo: "auto", aerolinea: "En tu coche",
    duracion: t.horas_ida ? `${t.horas_ida} h de ida según Google Maps (sin tráfico)` : t.km_ida ? `Unas ${Math.round((t.km_ida / 75) * 10) / 10} h de ida por carretera (aprox.)` : "",
    escalas: "Terrestre", km: t.km_ida,
    precio_por_persona: t.costo_auto.total_mxn ? t.costo_auto.total_mxn / T : 0, precio_min: null, precio_max: null,
    fuente_precio: "estimado", estado_dato: "ESTIMADO",
    booking_link: enlaceMaps(t.origen, t.primera), costo_auto: t.costo_auto,
    notas: `${tramo}. ${casetas}. ${lines.gasolina}. Costo del coche, no por persona; no incluye estacionamiento.`,
    from: t.origen, to: t.primera, ciudad: t.primera,
  };
}

/** Lo que suma «Cómo llegar» al total (MXN, del grupo): la gasolina estimada del coche; 0 en autobús/tren. */
export function totalLlegadaTierra(t: LlegadaTierra | null): number {
  return t?.costo_auto?.total_mxn ? Math.round(t.costo_auto.total_mxn) : 0;
}
