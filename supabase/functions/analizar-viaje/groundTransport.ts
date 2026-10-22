// Trayectos cortos por carretera (N-06). Sin dependencias de Deno, para probarlo desde Vitest.
//
// Por qué: para CDMX→Puebla (~130 km) el análisis cotizaba solo vuelos con escala de 4–5 h, que
// eran casi la mitad del total. Si origen y destino están a menos de ~350 km por carretera:
//   - se le pide al modelo proponer autobús / auto como opción ESTIMADA (rango de precio y liga
//     de búsqueda), nunca como precio en vivo;
//   - los vuelos solo se muestran si son razonables (máx. 1 escala y duración total < 3 × el
//     tiempo de manejo); la búsqueda de vuelos no se quita.
// La distancia sale de coordenadas conocidas de cada ciudad (lista curada) × un factor de
// carretera: es una aproximación y siempre se presenta como "aprox.".

export const SHORT_TRIP_MAX_ROAD_KM = 350;
/** Las carreteras son más largas que la línea recta (≈1.3 en el centro de México). */
const ROAD_FACTOR = 1.3;
/** Velocidad media de manejo/autobús en carretera, con entradas y salidas de ciudad. */
const AVG_ROAD_KMH = 75;
const TP_MARKER = "533299";

type City = { key: string; name: string; lat: number; lng: number; aliases: string[] };

// Coordenadas del centro de cada ciudad. Solo ciudades de México con conexiones terrestres
// frecuentes; si una ciudad no está, no se asume nada (se cotiza como antes).
const CITIES: City[] = [
  { key: "cdmx", name: "Ciudad de México", lat: 19.4326, lng: -99.1332, aliases: ["ciudad de mexico", "cdmx", "mexico city", "mexico df", "distrito federal"] },
  { key: "puebla", name: "Puebla", lat: 19.0414, lng: -98.2063, aliases: ["puebla", "puebla de zaragoza"] },
  { key: "cholula", name: "Cholula", lat: 19.0633, lng: -98.3036, aliases: ["cholula", "san pedro cholula", "san andres cholula"] },
  { key: "atlixco", name: "Atlixco", lat: 18.9085, lng: -98.4366, aliases: ["atlixco"] },
  { key: "tlaxcala", name: "Tlaxcala", lat: 19.3182, lng: -98.2375, aliases: ["tlaxcala"] },
  { key: "cuernavaca", name: "Cuernavaca", lat: 18.9242, lng: -99.2216, aliases: ["cuernavaca"] },
  { key: "tepoztlan", name: "Tepoztlán", lat: 18.9853, lng: -99.0997, aliases: ["tepoztlan"] },
  { key: "taxco", name: "Taxco", lat: 18.556, lng: -99.605, aliases: ["taxco"] },
  { key: "toluca", name: "Toluca", lat: 19.2826, lng: -99.6557, aliases: ["toluca"] },
  { key: "valle_bravo", name: "Valle de Bravo", lat: 19.195, lng: -100.131, aliases: ["valle de bravo"] },
  { key: "pachuca", name: "Pachuca", lat: 20.1011, lng: -98.7591, aliases: ["pachuca"] },
  { key: "queretaro", name: "Querétaro", lat: 20.5888, lng: -100.3899, aliases: ["queretaro", "santiago de queretaro"] },
  { key: "sma", name: "San Miguel de Allende", lat: 20.9144, lng: -100.7452, aliases: ["san miguel de allende"] },
  { key: "guanajuato", name: "Guanajuato", lat: 21.019, lng: -101.2574, aliases: ["guanajuato"] },
  { key: "leon", name: "León", lat: 21.125, lng: -101.686, aliases: ["leon guanajuato", "leon gto", "leon"] },
  { key: "morelia", name: "Morelia", lat: 19.706, lng: -101.195, aliases: ["morelia"] },
  { key: "aguascalientes", name: "Aguascalientes", lat: 21.8853, lng: -102.2916, aliases: ["aguascalientes"] },
  { key: "slp", name: "San Luis Potosí", lat: 22.1565, lng: -100.9855, aliases: ["san luis potosi"] },
  { key: "guadalajara", name: "Guadalajara", lat: 20.6597, lng: -103.3496, aliases: ["guadalajara"] },
  { key: "veracruz", name: "Veracruz", lat: 19.1738, lng: -96.1342, aliases: ["veracruz", "puerto de veracruz"] },
  { key: "xalapa", name: "Xalapa", lat: 19.5438, lng: -96.9102, aliases: ["xalapa", "jalapa"] },
  { key: "oaxaca", name: "Oaxaca", lat: 17.0732, lng: -96.7266, aliases: ["oaxaca de juarez", "oaxaca"] },
  { key: "acapulco", name: "Acapulco", lat: 16.8531, lng: -99.8237, aliases: ["acapulco"] },
  { key: "monterrey", name: "Monterrey", lat: 25.6866, lng: -100.3161, aliases: ["monterrey"] },
  { key: "saltillo", name: "Saltillo", lat: 25.4232, lng: -101.0053, aliases: ["saltillo"] },
  { key: "merida", name: "Mérida", lat: 20.9674, lng: -89.5926, aliases: ["merida"] },
  { key: "valladolid", name: "Valladolid", lat: 20.6896, lng: -88.2011, aliases: ["valladolid yucatan", "valladolid"] },
  { key: "cancun", name: "Cancún", lat: 21.1619, lng: -86.8515, aliases: ["cancun"] },
  { key: "playa", name: "Playa del Carmen", lat: 20.6296, lng: -87.0739, aliases: ["playa del carmen"] },
  { key: "tulum", name: "Tulum", lat: 20.2114, lng: -87.4654, aliases: ["tulum"] },
  { key: "bacalar", name: "Bacalar", lat: 18.677, lng: -88.395, aliases: ["bacalar"] },
  { key: "campeche", name: "Campeche", lat: 19.8301, lng: -90.5349, aliases: ["campeche"] },
  { key: "tijuana", name: "Tijuana", lat: 32.5149, lng: -117.0382, aliases: ["tijuana"] },
  { key: "ensenada", name: "Ensenada", lat: 31.8667, lng: -116.5964, aliases: ["ensenada", "valle de guadalupe"] },
  { key: "cabo", name: "Los Cabos", lat: 22.8905, lng: -109.9167, aliases: ["los cabos", "cabo san lucas", "san jose del cabo"] },
  { key: "lapaz", name: "La Paz", lat: 24.1426, lng: -110.3128, aliases: ["la paz baja california", "la paz bcs", "la paz"] },
  { key: "vallarta", name: "Puerto Vallarta", lat: 20.6534, lng: -105.2253, aliases: ["puerto vallarta", "vallarta"] },
  { key: "mazatlan", name: "Mazatlán", lat: 23.2494, lng: -106.4111, aliases: ["mazatlan"] },
  { key: "sancris", name: "San Cristóbal de las Casas", lat: 16.737, lng: -92.6376, aliases: ["san cristobal de las casas", "san cristobal"] },
  { key: "tuxtla", name: "Tuxtla Gutiérrez", lat: 16.7516, lng: -93.1161, aliases: ["tuxtla gutierrez", "tuxtla"] },
  { key: "huatulco", name: "Huatulco", lat: 15.77, lng: -96.13, aliases: ["huatulco"] },
  { key: "pescondido", name: "Puerto Escondido", lat: 15.872, lng: -97.0767, aliases: ["puerto escondido"] },
];

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Ciudad conocida mencionada en el texto (el alias más largo gana: "leon guanajuato" > "leon"). */
export function findCity(text: unknown): City | null {
  const t = ` ${norm(text)} `;
  if (!t.trim()) return null;
  let best: { city: City; len: number } | null = null;
  for (const city of CITIES) {
    for (const alias of city.aliases) {
      if (t.includes(` ${alias} `) && (!best || alias.length > best.len)) best = { city, len: alias.length };
    }
  }
  return best?.city ?? null;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type ShortTrip = {
  origin: string;
  destination: string;
  /** Aproximados (línea recta × factor de carretera); nunca se presentan como exactos. */
  approxRoadKm: number;
  approxDriveHours: number;
};

/** null si alguna ciudad no es conocida, si son la misma o si están a más de maxRoadKm. */
export function detectShortTrip(origin: unknown, destination: unknown, maxRoadKm = SHORT_TRIP_MAX_ROAD_KM): ShortTrip | null {
  const o = findCity(origin);
  const d = findCity(destination);
  if (!o || !d || o.key === d.key) return null;
  const approxRoadKm = Math.round(haversineKm(o, d) * ROAD_FACTOR);
  if (approxRoadKm > maxRoadKm) return null;
  const approxDriveHours = Math.round((approxRoadKm / AVG_ROAD_KMH) * 10) / 10;
  return { origin: o.name, destination: d.name, approxRoadKm, approxDriveHours };
}

/** "4h 15m", "4 h 15 min", "2h", "95 min", 255 → minutos; null si no se entiende. */
export function parseDurationMinutes(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = norm(v);
  if (!s) return null;
  const h = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hora|horas)\b/.exec(s);
  const m = /(\d+)\s*(?:m|min|mins|minutos?)\b/.exec(s);
  if (!h && !m) return null;
  const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 ? Math.round(total) : null;
}

/** "Directo" → 0, "1 escala" → 1, 2 → 2; null si no se entiende. */
export function parseStops(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const s = norm(v);
  if (!s) return null;
  if (/\b(directo|sin escalas|nonstop|non stop)\b/.test(s)) return 0;
  const n = /(\d+)\s*(escala|parada|stop)/.exec(s);
  if (n) return Number(n[1]);
  if (/\buna escala\b/.test(s)) return 1;
  return null;
}

/** Un vuelo es razonable para un trayecto corto con máx. 1 escala y duración < 3 × manejo. */
export function isReasonableShortFlight(stops: number | null, minutes: number | null, driveHours: number): boolean {
  if (stops === null || minutes === null) return false; // sin datos no se puede afirmar
  return stops <= 1 && minutes < 3 * driveHours * 60;
}

/** Ligas de búsqueda: Omio (afiliado Travelpayouts, autobuses) y la ruta en Google Maps (auto). */
export function groundSearchLinks(origin: string, destination: string, date?: string | null) {
  const p = new URLSearchParams({ fromCity: origin, toCity: destination, adults: "1", marker: TP_MARKER });
  if (date) p.set("outboundDate", date);
  const omio = `https://www.omio.com/search?${p.toString()}`;
  const bus = `https://tp.media/click?${new URLSearchParams({ marker: `${TP_MARKER}.bus`, u: omio }).toString()}`;
  const car = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" }).toString()}`;
  return { bus, car };
}

/** Texto para el prompt del modelo cuando el trayecto es corto. */
export function shortTripPromptBlock(t: ShortTrip): string {
  return `TRAYECTO CORTO POR CARRETERA (${t.origin} → ${t.destination}, aprox. ${t.approxRoadKm} km, unas ${t.approxDriveHours} h de manejo; cifras aproximadas)
- NO fuerces vuelos. En "vuelos" propone primero transporte terrestre: autobús (y/o auto propio o rentado) con modo="autobus" o modo="auto".
- Esas opciones terrestres son ESTIMACIONES: pon fuente_precio="estimado", precio_min y precio_max (rango por persona, viaje redondo, en MXN) y precio_por_persona dentro de ese rango. No digas que es un precio en vivo ni inventes horarios exactos; en notas indica que el precio real se confirma en el buscador.
- Los vuelos de las listas solo se pueden usar si tienen máximo 1 escala y duran menos de ${Math.round(3 * t.approxDriveHours * 10) / 10} h en total; si ninguno cumple, no propongas vuelos.
- Sugerencia de tiers: ahorro = autobús, equilibrio = autobús de lujo o auto, premium = vuelo razonable (si existe) o auto/traslado privado.`;
}

const GROUND_WORDS = /\b(autobus|bus|camion|auto propio|auto rentado|renta de auto|coche|carro|manejando|carretera|ado|estrella roja|primera plus|etn)\b/;

export function groundMode(v: any): "autobus" | "auto" | null {
  const m = norm(v?.modo);
  if (m === "autobus" || m === "bus") return "autobus";
  if (m === "auto" || m === "carro" || m === "coche") return "auto";
  const text = norm(`${v?.aerolinea ?? ""} ${v?.escalas ?? ""}`);
  if (!GROUND_WORDS.test(text)) return null;
  return /\b(auto|coche|carro|manejando)\b/.test(text) ? "auto" : "autobus";
}

const pos = (v: unknown) => (Number(v) > 0 ? Math.round(Number(v)) : null);

/**
 * Aplica las reglas de trayecto corto a las opciones de "vuelos" ya normalizadas y con fuente:
 * - terrestres: siempre "estimado", con la liga de búsqueda del servidor (no la del modelo);
 * - vuelos: solo los razonables;
 * - si no queda ninguna opción terrestre, agrega una sin precio (solo la liga), para no inventar.
 */
export function applyShortTripRules(vuelos: any[], t: ShortTrip, links: { bus: string; car: string }): any[] {
  const out: any[] = [];
  for (const v of Array.isArray(vuelos) ? vuelos : []) {
    if (!v || typeof v !== "object") continue;
    const mode = groundMode(v);
    if (mode) {
      let min = pos(v.precio_min);
      let max = pos(v.precio_max);
      if (min && max && min > max) [min, max] = [max, min];
      let precio = pos(v.precio_por_persona) ?? 0;
      if (min && max) precio = precio >= min && precio <= max ? precio : Math.round((min + max) / 2);
      const g: any = {
        ...v,
        modo: mode,
        precio_por_persona: precio,
        precio_min: min && max ? min : null,
        precio_max: min && max ? max : null,
        fuente_precio: "estimado",
        estado_dato: "ESTIMADO",
        booking_link: mode === "auto" ? links.car : links.bus,
        notas: [v.notas, "Precio estimado; confírmalo en el buscador."].filter(Boolean).join(" "),
      };
      delete g.consultado_at;
      delete g.approximate_dates;
      delete g.cta_action;
      out.push(g);
      continue;
    }
    if (isReasonableShortFlight(parseStops(v.escalas), parseDurationMinutes(v.duracion), t.approxDriveHours)) {
      out.push({ ...v, modo: "avion" });
    }
  }
  if (!out.some((v) => v.modo === "autobus" || v.modo === "auto")) {
    const used = new Set(out.map((v) => v.tier));
    const tier = ["ahorro", "equilibrio", "premium"].find((x) => !used.has(x)) ?? "ahorro";
    out.unshift({
      tier,
      modo: "autobus",
      aerolinea: "Autobús o auto",
      duracion: `Unas ${t.approxDriveHours} h por carretera (aprox.)`,
      escalas: "Terrestre",
      precio_por_persona: 0,
      precio_min: null,
      precio_max: null,
      fuente_precio: "estimado",
      estado_dato: "ESTIMADO",
      booking_link: links.bus,
      notas: "Trayecto corto: conviene ir por carretera. No tenemos precio en vivo; consulta horarios y precios en el buscador.",
    });
  }
  const order = ["ahorro", "equilibrio", "premium"];
  return out.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
}

/**
 * Renglón de transporte del desglose en un trayecto corto: opción "equilibrio" con precio (o la
 * primera con precio) × viajeros. 0 si ninguna trae precio: no se inventa un costo.
 */
export function shortTripTransportTotal(vuelos: any[], viajeros: number): number {
  const priced = (Array.isArray(vuelos) ? vuelos : []).filter((v) => Number(v?.precio_por_persona) > 0);
  const ref = priced.find((v) => v.tier === "equilibrio") ?? priced[0];
  return ref ? Math.round(Number(ref.precio_por_persona) * Math.max(1, Math.round(Number(viajeros) || 1))) : 0;
}
