// "Lo TOP de {ciudad}" (pestaña Experiencias del viaje y plan de luna de miel): restaurantes de Google
// Places con sus botones de reserva, museos de la tabla de taquillas oficiales (con su horario real de
// Google si aparece), tours TOP de Viator, experiencias "wow" de Viator y eventos de Ticketmaster en
// las fechas. Sin dependencias de Deno (se prueba con Vitest); experiencias-top/index.ts pone llaves,
// caché, límites y cuota.
//
// Reglas:
//   * Solo se llama al pulsar "Buscar lo TOP de {ciudad}" (o una búsqueda de restaurantes): nunca al abrir.
//   * TOP = números del proveedor, visibles: Google 4.5★ con 500 reseñas (si quedan menos de 3, 4.3★
//     con 200, y se dice); Viator 4.6★ con 300 reseñas. Sin opinión ni etiquetas inventadas: si la
//     búsqueda fue "restaurantes románticos", se dice que es lo que Google devolvió para ESA consulta.
//   * Museos: los de la tabla oficial (officialTickets.ts) de esa ciudad. Su horario sale de Google solo
//     si el lugar aparece en la búsqueda; si no, "horario no consultado".
//   * Distancias reales (coordenadas de Places) al hotel del viaje o, sin hotel, al centro aproximado de
//     los lugares encontrados (y se dice cuál de los dos es).
import type { GoogleTransport } from "./google-maps.ts";
import { callError, googleErrorMessage } from "./google-maps.ts";
import { type GooglePlace, searchText } from "./google-places.ts";
import { matchOfficialTicket, officialTicketsForCity, ticketSummary } from "./officialTickets.ts";
import { restaurantBooking, TOP_GOOGLE, TOP_GOOGLE_RELAXED, TOP_VIATOR, topByRating } from "./restaurantBooking.ts";
import type { ViatorResult, ViatorTour } from "./viator.ts";
import type { TmQuery, TmResult } from "./ticketmaster.ts";

export type Block = "restaurantes" | "museos" | "tours" | "wow" | "eventos";
export const BLOCKS: Block[] = ["restaurantes", "museos", "tours", "wow", "eventos"];

export type LatLng = { lat: number; lng: number };
export type Anchor = { tipo: "hotel" | "centro_aprox"; nombre: string | null; lat: number; lng: number; nota: string };

export type ExperienciasInput = {
  city: string;
  date_from?: string | null;
  date_to?: string | null;
  hotel?: (Partial<LatLng> & { nombre?: string | null }) | null;
  /** Consulta de restaurantes del usuario ("cena romántica", "brunch"): va tal cual a Text Search. */
  query?: string | null;
  blocks?: Block[];
};

export type ExperienciasDeps = {
  transport: GoogleTransport | null;
  viator: (args: Record<string, unknown>) => Promise<ViatorResult>;
  ticketmaster?: ((q: TmQuery) => Promise<TmResult>) | null;
  now?: () => number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const normTxt = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const validPoint = (p: Partial<LatLng> | null | undefined): p is LatLng =>
  !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);

/** Distancia en línea recta (km, 1 decimal). */
export function kmBetween(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** Centro aproximado: promedio de las coordenadas encontradas (null si no hay). */
export function centroid(points: Array<Partial<LatLng> | null | undefined>): LatLng | null {
  const ok = points.filter(validPoint);
  if (!ok.length) return null;
  return { lat: ok.reduce((s, p) => s + p.lat, 0) / ok.length, lng: ok.reduce((s, p) => s + p.lng, 0) / ok.length };
}

/** "restaurantes románticos" → "restaurantes románticos en Florencia" (sin repetir la ciudad). */
export function restaurantTextQuery(city: string, query?: string | null): string {
  const q = clean(query, 80);
  if (!q) return `mejores restaurantes en ${city}`;
  return normTxt(q).includes(normTxt(city)) ? q : `${q} en ${city}`;
}

/** Restaurante de Google → lo que ve la pantalla (todo con fuente y fecha de consulta). */
export function restaurantView(p: GooglePlace, city: string, anchor: LatLng | null) {
  const booking = restaurantBooking({
    name: p.name, city, address: p.address, website: p.website, phone: p.phone, phoneInternational: p.phone_international, reservable: p.reservable,
  });
  return {
    place_id: p.place_id, nombre: p.name, direccion: p.address, lat: p.lat, lng: p.lng, maps_url: p.maps_url,
    rating: p.rating, resenas: p.user_rating_count, nivel_precio: p.price_level_label, simbolo_precio: p.price_symbol,
    rango_precio: p.price_range?.text ?? null, tipo: p.primary_type_label,
    sirve: { desayuno: p.serves.breakfast, brunch: p.serves.brunch, comida: p.serves.lunch, cena: p.serves.dinner },
    // Mismo nombre de campo que GooglePlace para filterByMeal (serves*).
    serves: { breakfast: p.serves.breakfast, brunch: p.serves.brunch, lunch: p.serves.lunch, dinner: p.serves.dinner },
    reservable: p.reservable, website: p.website, telefono: p.phone, telefono_internacional: p.phone_international,
    horario: p.weekday_hours, periodos: p.opening_periods, resumen: p.editorial_summary, photo_ref: p.photo_ref,
    reserva: booking,
    distancia_km: anchor && validPoint({ lat: p.lat ?? undefined, lng: p.lng ?? undefined }) ? kmBetween(anchor, { lat: p.lat!, lng: p.lng! }) : null,
    fuente: "google_places" as const, consultado_at: p.consultado_at,
  };
}
export type RestaurantView = ReturnType<typeof restaurantView>;

/** Consultas "wow" de Viator por ciudad (lo que se busca se dice tal cual en la pantalla). */
export function wowQueries(city: string): string[] {
  const c = normTxt(city);
  if (/venec|venice|venezia/.test(c)) return ["paseo en góndola privada", "clase de cocina"];
  if (/florenc|firenze|florence|toscana|tuscany|siena|pisa/.test(c)) return ["cata de vino Toscana", "clase de cocina"];
  if (/\broma\b|\brome\b/.test(c)) return ["acceso anticipado Vaticano", "clase de cocina"];
  if (/paris/.test(c)) return ["crucero por el Sena con cena", "clase de cocina"];
  return ["experiencia privada", "clase de cocina"];
}

type ViatorBlock = { ok: boolean; results: (ViatorTour & { consulta?: string })[]; consultado_at: string | null; aviso: string; criterio: typeof TOP_VIATOR; motivo?: string; consultas?: string[] };

function viatorTop(results: (ViatorTour & { consulta?: string })[], at: string | null): ViatorBlock {
  const top = topByRating(results, (t) => ({ rating: t.rating, reviews: t.resenas }), { strict: TOP_VIATOR, source: "Viator" });
  return { ok: true, results: top.items, consultado_at: at, aviso: top.aviso, criterio: top.criterio };
}

const viatorFail = (r: ViatorResult): ViatorBlock => ({
  ok: false, results: [], consultado_at: null, criterio: TOP_VIATOR, aviso: "",
  motivo: r.ok ? "Viator no publicó tours para esta búsqueda." : (r as { motivo: string }).motivo,
});

/** Consultas de Viator para "TOP tours" (por relevancia; se unen sin repetir). */
export const TOUR_QUERIES = ["walking tour", "excursión de un día", "visita guiada", "tour"];

export async function runExperiencias(input: ExperienciasInput, d: ExperienciasDeps) {
  const city = clean(input.city, 80);
  if (!city) return { ok: false as const, code: "falta_ciudad", motivo: "Falta la ciudad." };
  const now = d.now ?? Date.now;
  const blocks = new Set<Block>((input.blocks?.length ? input.blocks : BLOCKS).filter((b) => BLOCKS.includes(b)));
  const from = typeof input.date_from === "string" && ISO.test(input.date_from) ? input.date_from : null;
  const to = typeof input.date_to === "string" && ISO.test(input.date_to) ? input.date_to : null;
  const avisos: string[] = [];
  let hotel: LatLng | null = validPoint(input.hotel) ? { lat: input.hotel!.lat!, lng: input.hotel!.lng! } : null;
  const hotelName = clean(input.hotel?.nombre, 120) || null;

  // Hotel sin coordenadas: su ubicación real por nombre (Text Search Pro, 1 resultado).
  if (!hotel && hotelName && d.transport) {
    const r = await searchText(d.transport, { query: `${hotelName}, ${city}`, preset: "basic", maxResults: 1, dropClosed: false });
    const p = r.ok ? r.places[0] : null;
    if (p && validPoint({ lat: p.lat ?? undefined, lng: p.lng ?? undefined })) hotel = { lat: p.lat!, lng: p.lng! };
    else avisos.push(`No encontramos la ubicación de tu hotel (${hotelName}) en Google Maps: las distancias son al centro aproximado.`);
  }

  const google = d.transport;
  const restP = blocks.has("restaurantes") && google
    ? searchText(google, {
      query: restaurantTextQuery(city, input.query), includedType: "restaurant", preset: "atmosphere", maxResults: 20, language: "es",
      ...(hotel ? { near: { ...hotel, radius: 3000 } } : {}),
    })
    : null;
  const tickets = officialTicketsForCity(city);
  const museoP = blocks.has("museos") && google && tickets.length
    ? searchText(google, { query: `museos y monumentos en ${city}`, preset: "rich", maxResults: 20, language: "es", dropClosed: false })
    : null;
  // Búsqueda por relevancia ("tour"): ordenar por TRAVELER_RATING trae 5★ con pocas reseñas que el
  // criterio TOP (≥300 reseñas) descarta; la relevancia de Viator trae los tours populares (prueba real 27-oct).
  // Varias consultas (Viator no cobra por búsqueda; caché de 6 h) y se unen sin repetir: una sola dejaba
  // 1 tour que cumplía el criterio en Florencia.
  const toursP: Promise<ViatorResult> | null = blocks.has("tours")
    ? Promise.all(TOUR_QUERIES.map((q) => d.viator({ city, query: q, date_from: from, date_to: to, currency: "MXN", max: 12 }))).then((rs) => {
      const oks = rs.filter((r) => r.ok) as Extract<ViatorResult, { ok: true }>[];
      if (!oks.length) return rs[0];
      const seenT = new Set<string>();
      const results: ViatorTour[] = [];
      for (const r of oks) for (const t of r.results) if (!seenT.has(t.codigo)) { seenT.add(t.codigo); results.push(t); }
      return { ...oks[0], results } as ViatorResult;
    })
    : null;
  const wq = blocks.has("wow") ? wowQueries(city) : [];
  const wowP = Promise.all(wq.map((q) => d.viator({ city, query: q, date_from: from, date_to: to, currency: "MXN", max: 12 })));
  const evP = blocks.has("eventos") && d.ticketmaster && from
    ? d.ticketmaster({ city, from, to: to ?? from, size: 6 })
    : null;

  const [rest, mus, tours, wows, evs] = await Promise.all([restP, museoP, toursP, wowP, evP]);

  // Museos de la tabla con el lugar de Google (si aparece en la búsqueda).
  const museoPlaces = mus && mus.ok ? mus.places : [];
  const museos = tickets.map((t) => {
    const p = museoPlaces.find((x) => matchOfficialTicket(x.name, city)?.id === t.id) ?? null;
    return { ...ticketSummary(t), nota_fuente: t.nota_fuente, verificacion: t.verificacion.estado, lugar: p ? {
      place_id: p.place_id, nombre_google: p.name, lat: p.lat, lng: p.lng, rating: p.rating, resenas: p.user_rating_count,
      horario: p.weekday_hours, periodos: p.opening_periods, photo_ref: p.photo_ref, maps_url: p.maps_url, consultado_at: p.consultado_at,
    } : null };
  });

  const restPlaces = rest && rest.ok ? rest.places : [];
  // Ancla de distancias: el hotel; si no, el centro aproximado de lo encontrado (se dice).
  let anchor: Anchor | null = hotel ? { tipo: "hotel", nombre: hotelName, ...hotel, nota: `Distancias en línea recta desde tu hotel${hotelName ? ` (${hotelName})` : ""}.` } : null;
  if (!anchor) {
    const c = centroid([...restPlaces, ...museos.map((m) => m.lugar)].map((p) => p ? { lat: p.lat ?? undefined, lng: p.lng ?? undefined } : null));
    if (c) anchor = { tipo: "centro_aprox", nombre: null, ...c, nota: "Sin ubicación de hotel: distancias en línea recta desde el centro aproximado de los lugares encontrados." };
  }
  const at = new Date(now()).toISOString();
  const out: Record<string, unknown> = { ok: true, ciudad: city, consultado_at: at, ancla: anchor, avisos };

  if (blocks.has("restaurantes")) {
    if (!google) out.restaurantes = { ok: false, motivo: googleErrorMessage("error"), items: [] };
    else if (!rest || !rest.ok) out.restaurantes = { ok: false, motivo: googleErrorMessage(callError(rest).kind), items: [] };
    else {
      const views = restPlaces.map((p) => restaurantView(p, city, anchor));
      const top = topByRating(views, (v) => ({ rating: v.rating, reviews: v.resenas }), { strict: TOP_GOOGLE, relaxed: TOP_GOOGLE_RELAXED, source: "Google" });
      const aviso = [top.aviso];
      if (hotel && top.items.length < 3) aviso.push("Cerca de tu hotel (3 km) no hay suficientes que cumplan el criterio.");
      out.restaurantes = {
        ok: true, items: top.items, criterio: top.criterio, relajado: top.relajado, aviso: aviso.join(" "),
        consulta: restaurantTextQuery(city, input.query), consultado_at: rest.consultado_at, atribucion: "Google Maps",
      };
    }
  }
  if (blocks.has("museos")) {
    out.museos = {
      ok: true, items: museos.map((m) => ({
        ...m, distancia_km: anchor && m.lugar && validPoint({ lat: m.lugar.lat ?? undefined, lng: m.lugar.lng ?? undefined }) ? kmBetween(anchor, { lat: m.lugar.lat!, lng: m.lugar.lng! }) : null,
      })),
      aviso: tickets.length ? "Museos de nuestra tabla de taquillas oficiales (verificada el 27-oct-2026)." : "No tenemos museos de esta ciudad en la tabla de taquillas oficiales.",
      horario: mus ? (mus.ok ? "google" : "no_consultado") : "no_consultado",
    };
  }
  if (blocks.has("tours")) {
    out.tours = tours && tours.ok && tours.results.length ? viatorTop(tours.results, tours.consultado_at) : tours ? viatorFail(tours) : null;
  }
  if (blocks.has("wow")) {
    // Lo que ya salió en TOP tours no se repite en "wow".
    const seen = new Set<string>(tours && tours.ok ? tours.results.map((t) => t.codigo) : []);
    const merged: (ViatorTour & { consulta: string })[] = [];
    let wat = null as string | null;
    let firstFail = null as ViatorResult | null;
    wows.forEach((r, i) => {
      if (!r.ok) { firstFail = firstFail ?? r; return; }
      wat = wat ?? r.consultado_at;
      for (const t of r.results) if (!seen.has(t.codigo)) { seen.add(t.codigo); merged.push({ ...t, consulta: wq[i] }); }
    });
    const fail0 = firstFail as ViatorResult | null;
    const b = merged.length ? viatorTop(merged, wat) : viatorFail(fail0 ?? ({ ok: true } as ViatorResult));
    out.wow = { ...b, consultas: wq };
  }
  if (blocks.has("eventos")) {
    out.eventos = !from ? { ok: false, motivo: "El viaje no tiene fechas: sin fechas no buscamos eventos.", results: [] }
      : !evs ? { ok: false, motivo: "Ticketmaster no está disponible por ahora.", results: [] }
      : evs.ok ? { ok: true, results: evs.results, consultado_at: evs.consulted_at, fuente: "Ticketmaster" }
      : { ok: false, motivo: (evs as { motivo: string }).motivo, results: [] };
  }
  return out as { ok: true; ciudad: string; consultado_at: string; ancla: Anchor | null; avisos: string[]; [k: string]: unknown };
}
