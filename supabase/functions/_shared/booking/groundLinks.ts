// Enlaces PRECARGADOS de transporte por tierra y mar (tren, autobús, ferry, yate o lancha). Sin Deno:
// lo usan el front (Comprar, tramos del multidestino, Trenes, Ferries, cards de Iato) y el servidor.
//
// Regla del dueño: nada inventado. Cada formato se comprobó ABRIENDO el enlace con Chromium el
// 2026-10-24 (capturas en docs/iatos/evidencia/terrestre/, resumen en docs/iatos/PROVEEDORES_TERRESTRES.md):
//   * Renfe: venta.renfe.com/vol/buscarTren.do con cdgoOrigen/cdgoDestino (códigos de la lista pública
//     de estaciones de renfe.com, estacionesEstaticas.js), FechaIdaSel DD/MM/AAAA y adultos_ → abre
//     "Viaje de Ida · Madrid (Todas) → Córdoba-Julio Anguita · Viernes 07 mayo" (T-RENFE*.jpg).
//   * Deutsche Bahn: int.bahn.de/en/buchung/fahrplan/suche#so&zo&soid&zoid&hd&r → el buscador queda con
//     "Berlin Hbf → München Hbf, 10. Nov". El número EVA de cada estación sale de bahnhof.de (sitio de DB,
//     meta evaNumbers). DB bloquea la lista de trenes a navegadores automáticos (T-DB-BLOQUEADO.jpg):
//     se comprobó el formulario, no la lista. Sin el EVA, DB no encuentra trenes (A-DB-SIN-ID.jpg).
//   * FlixBus: shop.flixbus.com/search?departureCity&arrivalCity&rideDate=DD.MM.AAAA&adult=N → resultados
//     con ruta, fecha y adultos (T-FLIXBUS-EU.jpg, T-FLIXBUS-MX.jpg). Los id de ciudad salen del buscador de
//     ciudades del propio sitio de FlixBus (global.api.flixbus.com/search/autocomplete/cities).
//   * 12Go (Asia): 12go.asia/en/travel/<origen>/<destino>?date=AAAA-MM-DD&people=N (T-12GO.jpg); solo los
//     nombres de ciudad que se abrieron con resultados.
//   * Ferryhopper: www.ferryhopper.com/en/booking/results?itinerary=<puerto>,<puerto>&dates=AAAAMMDD&
//     passengers=N&vehicles=0&pets=0 (T-FERRYHOPPER.jpg). Es el formato del widget oficial de su servidor
//     MCP (mcp.ferryhopper.com); los códigos de puerto los da la búsqueda en vivo (ferry-search).
//   * Click&Boat: www.clickandboat.com/es/alquiler?where=<Ciudad, País>&dateFrom&dateTo&numberOfPeople
//     (T-CLICKANDBOAT.jpg). Sin el país ("Ibiza" a secas) no hay resultados (A-CLICKANDBOAT-SIN-PAIS.jpg).
//   * ADO: sus páginas de ruta (international.ado.com.mx/ado-bus/<ruta>) llevan origen y destino, NO la
//     fecha (A-ADO-SIN-FECHA.jpg): solo las rutas que publica su página "Popular routes".
// Nunca hay precio aquí: "Ver horarios y precio en {operador}".
import { cityAirports } from "../airports.ts";
import { isIsoDate } from "./links.ts";

export const GROUND_EVIDENCE = {
  RENFE: "EV-RENFE-BUSCAR",
  DB: "EV-DB-SUCHE",
  FLIXBUS: "EV-FLIXBUS-SEARCH",
  TWELVEGO: "EV-12GO-TRAVEL",
  FERRYHOPPER: "EV-FERRYHOPPER-RESULTS",
  CLICKANDBOAT: "EV-CLICKANDBOAT-ALQUILER",
  ADO_ROUTE: "EV-ADO-ROUTE",
} as const;

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const isoOk = isIsoDate;
const pax = (n: unknown, max = 9) => Math.min(max, Math.max(1, Math.round(Number(n) || 1)));

/** Busca una ciudad en una tabla por sus nombres (español, inglés, local). */
function lookup<T>(table: Array<[string[], T]>, city: unknown): T | null {
  // Nombre exacto, o lo que va antes de la coma ("Madrid, España"). Nada de coincidencias parciales:
  // "Ronda del Sur" no es Ronda ni "San Juan de León" es León.
  const raw = String(city ?? "");
  for (const n of [norm(raw), norm(raw.split(",")[0])]) {
    if (!n) continue;
    for (const [names, v] of table) if (names.includes(n)) return v;
  }
  return null;
}

// ── Renfe (España) ──
// Códigos de renfe.com (estacionesEstaticas.js, consultado 2026-10-24). "(TODAS)" agrupa las estaciones.
type RenfeStation = { code: string; label: string };
const R = (code: string, label: string): RenfeStation => ({ code, label });
export const RENFE_STATIONS: Array<[string[], RenfeStation]> = [
  [["madrid"], R("MADRI", "MADRID (TODAS)")],
  [["barcelona"], R("BARCE", "BARCELONA (TODAS)")],
  [["valencia"], R("VALEN", "VALENCIA (TODAS)")],
  [["bilbao"], R("BILBA", "BILBAO (TODAS)")],
  [["santander"], R("SANTA", "SANTANDER (TODAS)")],
  [["zaragoza"], R("ZARAG", "ZARAGOZA (TODAS)")],
  [["salamanca"], R("SALAM", "SALAMANCA (TODAS)")],
  [["segovia"], R("SEGOV", "SEGOVIA (TODAS)")],
  [["tarragona"], R("TARRA", "TARRAGONA (TODAS)")],
  [["cuenca"], R("CUENC", "CUENCA (TODAS)")],
  [["vigo"], R("VIGO-", "VIGO (TODAS)")],
  [["gijon"], R("GIJON", "GIJÓN/XIXÓN (TODAS)")],
  [["sevilla", "seville"], R("51003", "SEVILLA-SANTA JUSTA")],
  [["cordoba"], R("50500", "CORDOBA-JULIO ANGUITA")],
  [["malaga"], R("54413", "MALAGA MARIA ZAMBRANO")],
  [["granada"], R("05000", "GRANADA")],
  [["alicante", "alacant"], R("60911", "ALICANTE/ALACANT-TERMINAL")],
  [["toledo"], R("92102", "TOLEDO")],
  [["valladolid"], R("10600", "VALLADOLID-CAMPO GRANDE")],
  [["cadiz"], R("51405", "CADIZ")],
  [["jerez", "jerez de la frontera"], R("51300", "JEREZ DE LA FRONTERA")],
  [["leon"], R("15100", "LEON")],
  [["a coruna", "la coruna", "coruna"], R("31412", "A CORUÑA")],
  [["santiago de compostela", "santiago"], R("31400", "SANTIAGO DE COMPOSTELA-DANIEL CASTELAO")],
  [["girona", "gerona"], R("79300", "GIRONA")],
  [["figueres", "figueras"], R("04307", "FIGUERES-VILAFANT")],
  [["lleida", "lerida"], R("78400", "LLEIDA-PIRINEUS")],
  [["burgos"], R("11014", "BURGOS-ROSA MANZANO")],
  [["pamplona"], R("80100", "PAMPLONA/IRUÑA")],
  [["logrono"], R("81100", "LOGROÑO")],
  [["oviedo"], R("15211", "OVIEDO")],
  [["san sebastian", "donostia"], R("11511", "SAN SEBASTIAN-DONOSTIA")],
  [["murcia"], R("61200", "MURCIA DEL CARMEN")],
  [["castellon", "castello", "castellon de la plana"], R("65300", "CASTELLO DE LA PLANA")],
  [["albacete"], R("60600", "ALBACETE-LOS LLANOS")],
  [["badajoz"], R("37606", "BADAJOZ")],
  [["huelva"], R("43019", "HUELVA")],
  [["ciudad real"], R("37200", "CIUDAD REAL")],
  [["jaen"], R("03100", "JAEN")],
  [["almeria"], R("56312", "ALMERIA")],
  [["caceres"], R("35400", "CACERES")],
  [["merida"], R("37500", "MERIDA")],
  [["ronda"], R("55007", "RONDA")],
  [["ourense", "orense"], R("22100", "OURENSE")],
];

const dmy = (iso: string, sep: string) => `${iso.slice(8, 10)}${sep}${iso.slice(5, 7)}${sep}${iso.slice(0, 4)}`;

export type GroundQuery = { from: string; to: string; date?: string | null; adults?: number | null; time?: string | null };

/** Búsqueda de Renfe con origen, destino, fecha y adultos; null si alguna ciudad no está en la tabla. */
export function renfeSearchUrl(q: GroundQuery): string | null {
  const a = lookup(RENFE_STATIONS, q.from);
  const b = lookup(RENFE_STATIONS, q.to);
  if (!a || !b || a.code === b.code || !isoOk(q.date)) return null;
  const f = dmy(q.date, "/");
  const p = new URLSearchParams({
    tipoBusqueda: "autocomplete", currenLocation: "menuBusqueda", vengoderenfecom: "SI",
    desOrigen: a.label, desDestino: b.label, cdgoOrigen: a.code, cdgoDestino: b.code, idiomaBusqueda: "ES",
    FechaIdaSel: f, _fechaIdaVisual: f, adultos_: String(pax(q.adults)), ninos_: "0", ninosMenores: "0",
    numJoven: "0", numDorada: "0", codPromocional: "", plazaH: "false", sinEnlace: "false", asistencia: "false",
    franjaHoraI: "", franjaHoraV: "", Idioma: "es", Pais: "ES",
  });
  return `https://venta.renfe.com/vol/buscarTren.do?${p.toString()}`;
}

// ── Deutsche Bahn (Alemania) ──
// Número EVA de bahnhof.de (meta "evaNumbers", consultado 2026-10-24).
type DbStation = { eva: string; name: string };
export const DB_STATIONS: Array<[string[], DbStation]> = [
  [["berlin", "berlin hbf"], { eva: "8011160", name: "Berlin Hbf" }],
  [["munich", "munchen", "muenchen", "munich hbf", "munchen hbf"], { eva: "8000261", name: "München Hbf" }],
  [["frankfurt", "frankfurt am main", "francfort", "frankfurt main"], { eva: "8000105", name: "Frankfurt(Main)Hbf" }],
  [["hamburgo", "hamburg"], { eva: "8002549", name: "Hamburg Hbf" }],
  [["colonia", "koln", "koeln", "cologne"], { eva: "8000207", name: "Köln Hbf" }],
  [["stuttgart"], { eva: "8000096", name: "Stuttgart Hbf" }],
  [["dusseldorf", "duesseldorf"], { eva: "8000085", name: "Düsseldorf Hbf" }],
  [["nuremberg", "nurnberg", "nuernberg"], { eva: "8000284", name: "Nürnberg Hbf" }],
  [["leipzig"], { eva: "8010205", name: "Leipzig Hbf" }],
  [["dresde", "dresden"], { eva: "8010085", name: "Dresden Hbf" }],
  [["hannover", "hanover"], { eva: "8000152", name: "Hannover Hbf" }],
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Búsqueda de DB con estaciones (EVA), fecha, hora y adultos; null si alguna ciudad no está en la tabla. */
export function dbSearchUrl(q: GroundQuery): string | null {
  const a = lookup(DB_STATIONS, q.from);
  const b = lookup(DB_STATIONS, q.to);
  if (!a || !b || a.eva === b.eva || !isoOk(q.date)) return null;
  const time = q.time && HHMM.test(q.time) ? q.time : "08:00";
  const id = (s: DbStation) => encodeURIComponent(`A=1@O=${s.name}@L=${s.eva}@`);
  const n = pax(q.adults);
  // r = <edad>:<tipo>:<clase>:<número de viajeros> (13 = adulto, 16 = sin descuento), formato de bahn.de.
  return `https://int.bahn.de/en/buchung/fahrplan/suche#sts=true&so=${encodeURIComponent(a.name)}&zo=${encodeURIComponent(b.name)}&kl=2&r=13:16:KLASSENLOS:${n}`
    + `&soid=${id(a)}&zoid=${id(b)}&hd=${q.date}T${time}:00&hza=D&ar=false&s=true&d=false&hz=%5B%5D&fm=false&bp=false`;
}

// ── FlixBus ──
// Id de ciudad del buscador del sitio de FlixBus (consultado 2026-10-24). Solo ciudades con id propio.
export const FLIX_CITIES: Array<[string[], string]> = [
  [["ciudad de mexico", "cdmx", "mexico city", "mexico df"], "de2da3db-1fa4-469b-b687-c5ab89d09c42"],
  [["puebla"], "5f8c0dfa-952a-4a23-992a-9b7aa1c3b86f"],
  [["queretaro", "santiago de queretaro"], "ae913937-552f-499c-a272-2d76a184ce8f"],
  [["monterrey"], "879879a1-e4c8-4d85-ab4c-20f52a0f8f36"],
  [["leon"], "45ea7fdd-5924-459b-aff3-0cd81650036a"],
  [["san luis potosi"], "b483894e-2cc5-4779-b8af-4ec914f9f6e4"],
  [["aguascalientes"], "9f413674-97ed-481a-98d4-d1025dc4a260"],
  [["veracruz"], "d35fb215-7f69-4ce5-90a1-9b0af9c1ee51"],
  [["berlin"], "40d8f682-8646-11e6-9066-549f350fcb0c"],
  [["munich", "munchen"], "40d901a5-8646-11e6-9066-549f350fcb0c"],
  [["hamburgo", "hamburg"], "40d91e53-8646-11e6-9066-549f350fcb0c"],
  [["frankfurt", "francfort"], "40d90407-8646-11e6-9066-549f350fcb0c"],
  [["colonia", "koln", "cologne"], "40d91025-8646-11e6-9066-549f350fcb0c"],
  [["stuttgart"], "40d90995-8646-11e6-9066-549f350fcb0c"],
  [["dusseldorf"], "40d911c7-8646-11e6-9066-549f350fcb0c"],
  [["nuremberg", "nurnberg"], "40d90d0f-8646-11e6-9066-549f350fcb0c"],
  [["leipzig"], "40d917f9-8646-11e6-9066-549f350fcb0c"],
  [["dresde", "dresden"], "40db219f-8646-11e6-9066-549f350fcb0c"],
  [["paris"], "40de8964-8646-11e6-9066-549f350fcb0c"],
  [["lyon"], "40df89c1-8646-11e6-9066-549f350fcb0c"],
  [["marsella", "marseille"], "40df8e99-8646-11e6-9066-549f350fcb0c"],
  [["niza", "nice"], "40e13a46-8646-11e6-9066-549f350fcb0c"],
  [["burdeos", "bordeaux"], "40df577e-8646-11e6-9066-549f350fcb0c"],
  [["toulouse", "tolosa"], "40dfd612-8646-11e6-9066-549f350fcb0c"],
  [["estrasburgo", "strasbourg"], "40d90f52-8646-11e6-9066-549f350fcb0c"],
  [["roma", "rome"], "40de90ff-8646-11e6-9066-549f350fcb0c"],
  [["milan", "milano"], "40ddcc6e-8646-11e6-9066-549f350fcb0c"],
  [["florencia", "firenze", "florence"], "40de71c6-8646-11e6-9066-549f350fcb0c"],
  [["venecia", "venezia", "venice"], "40dea03b-8646-11e6-9066-549f350fcb0c"],
  [["napoles", "napoli", "naples"], "40e096c1-8646-11e6-9066-549f350fcb0c"],
  [["bolonia", "bologna"], "40df3653-8646-11e6-9066-549f350fcb0c"],
  [["turin", "torino"], "40deee02-8646-11e6-9066-549f350fcb0c"],
  [["pisa"], "40e09bc2-8646-11e6-9066-549f350fcb0c"],
  [["verona"], "40dea1ff-8646-11e6-9066-549f350fcb0c"],
  [["madrid"], "9a07bb38-3596-48eb-a857-18fd01199c62"],
  [["barcelona"], "40e086ed-8646-11e6-9066-549f350fcb0c"],
  [["valencia"], "fe6bf6e1-6198-4eec-8843-ab6001133840"],
  [["sevilla", "seville"], "033b1bde-970c-45af-9504-91c4006fd466"],
  [["malaga"], "ef2cc114-c257-402c-bc45-3f7e3eb70223"],
  [["granada"], "246101b8-2880-4b2f-a71a-171c927c442d"],
  [["lisboa", "lisbon"], "14eefc82-b630-4aea-88dc-eb91e0b9d482"],
  [["oporto", "porto"], "74923e7b-3ace-43d2-8278-41ee00193a85"],
  [["amsterdam"], "40dde3b8-8646-11e6-9066-549f350fcb0c"],
  [["bruselas", "brussels", "bruxelles"], "40de6287-8646-11e6-9066-549f350fcb0c"],
  [["praga", "prague", "praha"], "40de1ad1-8646-11e6-9066-549f350fcb0c"],
  [["viena", "vienna", "wien"], "40de1f31-8646-11e6-9066-549f350fcb0c"],
  [["salzburgo", "salzburg"], "40de3471-8646-11e6-9066-549f350fcb0c"],
  [["budapest"], "40de6527-8646-11e6-9066-549f350fcb0c"],
  [["zurich"], "40d8fa3c-8646-11e6-9066-549f350fcb0c"],
  [["ginebra", "geneva", "geneve"], "40df585b-8646-11e6-9066-549f350fcb0c"],
  [["copenhague", "copenhagen"], "40de7db1-8646-11e6-9066-549f350fcb0c"],
  [["varsovia", "warsaw"], "40e19c59-8646-11e6-9066-549f350fcb0c"],
  [["cracovia", "krakow"], "40de7eb5-8646-11e6-9066-549f350fcb0c"],
  [["zagreb"], "40dea87d-8646-11e6-9066-549f350fcb0c"],
  [["split"], "40e128e9-8646-11e6-9066-549f350fcb0c"],
  [["nueva york", "new york"], "c0a47c54-53ea-46dc-984b-b764fc0b2fa9"],
  [["washington", "washington dc"], "adcc1f7d-3bfe-471d-9946-28253814a09b"],
  [["boston"], "eeff627f-2fda-4e75-8468-783d47955b3a"],
  [["filadelfia", "philadelphia"], "fd509c08-0a3e-4a44-b933-79f4a9db13da"],
  [["los angeles"], "490d29d8-7151-4e05-86df-68fba4f000be"],
  [["san francisco"], "65e6af81-18ec-4b36-9e19-d0b9e732eee6"],
  [["las vegas"], "30e3dcd2-f9a7-4900-8f39-7a77c261904e"],
  [["san diego"], "11347692-6eb9-4d05-b2b3-234d5b3a5e0e"],
];

/** Búsqueda de FlixBus con ruta, fecha y adultos; null si alguna ciudad no tiene id comprobado. */
export function flixbusSearchUrl(q: GroundQuery): string | null {
  const a = lookup(FLIX_CITIES, q.from);
  const b = lookup(FLIX_CITIES, q.to);
  if (!a || !b || a === b || !isoOk(q.date)) return null;
  const p = new URLSearchParams({ departureCity: a, arrivalCity: b, rideDate: dmy(q.date, "."), adult: String(pax(q.adults)) });
  return `https://shop.flixbus.com/search?${p.toString()}`;
}

// ── 12Go (Asia) ──
// Nombres que 12Go abrió con resultados (2026-10-24).
export const TWELVEGO_CITIES: Array<[string[], string]> = [
  [["bangkok"], "bangkok"], [["chiang mai"], "chiang-mai"], [["phuket"], "phuket"], [["krabi"], "krabi"],
  [["koh samui", "ko samui"], "koh-samui"], [["hanoi"], "hanoi"], [["ha long", "halong", "bahia de ha long"], "ha-long"],
  [["sapa", "sa pa"], "sapa"], [["ho chi minh", "ho chi minh city", "saigon"], "ho-chi-minh-city"], [["da lat", "dalat"], "da-lat"],
  [["siem reap"], "siem-reap"], [["phnom penh"], "phnom-penh"], [["kuala lumpur"], "kuala-lumpur"], [["singapur", "singapore"], "singapore"],
];

export function twelveGoSearchUrl(q: GroundQuery): string | null {
  const a = lookup(TWELVEGO_CITIES, q.from);
  const b = lookup(TWELVEGO_CITIES, q.to);
  if (!a || !b || a === b || !isoOk(q.date)) return null;
  return `https://12go.asia/en/travel/${a}/${b}?date=${q.date}&people=${pax(q.adults)}`;
}

// ── ADO (México): páginas de ruta (sin fecha) ──
export const ADO_ROUTES: Array<[string, string, string]> = [
  ["ciudad de mexico", "puebla", "mexico-city-to-puebla"],
  ["ciudad de mexico", "acapulco", "mexico-city-to-acapulco"],
  ["ciudad de mexico", "veracruz", "mexico-city-to-veracruz"],
  ["ciudad de mexico", "tepoztlan", "mexico-city-to-tepoztlan"],
  ["ciudad de mexico", "zihuatanejo", "mexico-city-to-zihuatanejo"],
  ["cancun", "tulum", "cancun-to-tulum"],
  ["cancun", "playa del carmen", "cancun-to-playa-del-carmen"],
  ["cancun", "chichen itza", "cancun-to-chichen-itza"],
  ["cancun", "chiquila", "cancun-to-chiquila"],
];
const MX_ALIASES: Record<string, string> = { cdmx: "ciudad de mexico", "mexico city": "ciudad de mexico", "mexico df": "ciudad de mexico" };

export function adoRouteUrl(from: string, to: string): string | null {
  const f = MX_ALIASES[norm(from)] ?? norm(from);
  const t = MX_ALIASES[norm(to)] ?? norm(to);
  const r = ADO_ROUTES.find(([a, b]) => a === f && b === t);
  return r ? `https://international.ado.com.mx/ado-bus/${r[2]}?locale=es-MX&currency=MXN` : null;
}

// ── Ferryhopper (con códigos de puerto de la búsqueda en vivo) ──
const PORT = /^[A-Z0-9]{2,5}$/;
export function ferryhopperResultsUrl(q: { ports: string[]; dates: string[]; passengers?: number | null }): string | null {
  if (q.ports.length < 2 || q.dates.length !== q.ports.length - 1) return null;
  if (!q.ports.every((p) => PORT.test(p)) || !q.dates.every((d) => isoOk(d))) return null;
  const p = new URLSearchParams({ itinerary: q.ports.join(","), dates: q.dates.map((d) => d.replace(/-/g, "")).join(","),
    passengers: String(pax(q.passengers, 20)), vehicles: "0", pets: "0" });
  return `https://www.ferryhopper.com/en/booking/results?${p.toString()}`;
}

// ── Click&Boat (yate o lancha) ──
/** Búsqueda de barcos con "Ciudad, País", fechas y personas. Sin país no hay búsqueda (no da resultados). */
export function clickAndBoatSearchUrl(q: { city: string; country?: string | null; from?: string | null; to?: string | null; people?: number | null }): string | null {
  const city = String(q.city ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const known = cityAirports(city);
  const country = String(q.country ?? known?.country ?? "").trim();
  if (!city || !country || norm(city) === norm(country)) return null;
  const name = known?.name ?? city;
  const p = new URLSearchParams({ where: `${name}, ${country}` });
  if (isoOk(q.from)) {
    p.set("dateFrom", q.from);
    p.set("dateTo", isoOk(q.to) && q.to >= q.from ? q.to : q.from);
  }
  if (q.people) p.set("numberOfPeople", String(pax(q.people, 30)));
  return `https://www.clickandboat.com/es/alquiler?${p.toString()}`;
}

// ── Elegir los enlaces de un tramo ──
export type GroundLink = {
  provider: "renfe" | "db" | "flixbus" | "12go" | "ado" | "ferryhopper" | "clickandboat";
  site: string;
  url: string;
  /** Qué datos llegan precargados (para decirlo junto al botón). */
  lleva: string;
  evidence: string;
};

const label = (site: string) => `Ver horarios y precio en ${site}`;
export const groundButtonLabel = label;

/** Enlace precargado del operador de tren oficial (Renfe en España, DB en Alemania), si se puede armar. */
export function railOperatorSearch(operatorId: string, q: GroundQuery): GroundLink | null {
  if (operatorId === "renfe") {
    const url = renfeSearchUrl(q);
    return url ? { provider: "renfe", site: "Renfe", url, lleva: "origen, destino, fecha y pasajeros", evidence: GROUND_EVIDENCE.RENFE } : null;
  }
  if (operatorId === "db") {
    const url = dbSearchUrl(q);
    return url ? { provider: "db", site: "Deutsche Bahn", url, lleva: "estaciones, fecha, hora y pasajeros", evidence: GROUND_EVIDENCE.DB } : null;
  }
  return null;
}

/** Multimodal con ruta y fecha fuera de Europa: 12Go en el Sudeste Asiático. */
export function multimodalSearch(q: GroundQuery): GroundLink | null {
  const url = twelveGoSearchUrl(q);
  return url ? { provider: "12go", site: "12Go", url, lleva: "ruta, fecha y pasajeros", evidence: GROUND_EVIDENCE.TWELVEGO } : null;
}

/** Autobús: FlixBus con ruta y fecha; en México, además, la página de la ruta de ADO (sin fecha). */
export function busSearches(q: GroundQuery): GroundLink[] {
  const out: GroundLink[] = [];
  const ado = adoRouteUrl(q.from, q.to);
  if (ado) out.push({ provider: "ado", site: "ADO", url: ado, lleva: "origen y destino (la fecha se elige en ADO)", evidence: GROUND_EVIDENCE.ADO_ROUTE });
  const flix = flixbusSearchUrl(q);
  if (flix) out.push({ provider: "flixbus", site: "FlixBus", url: flix, lleva: "ruta, fecha y pasajeros", evidence: GROUND_EVIDENCE.FLIXBUS });
  const asia = multimodalSearch(q);
  if (asia) out.push(asia);
  return out;
}

/** Texto honesto debajo del botón. */
export function groundLinkNote(l: Pick<GroundLink, "site" | "lleva">): string {
  return `Llega con: ${l.lleva}. El precio y la compra son en ${l.site}; IATOS no lo cotiza.`;
}
