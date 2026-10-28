/**
 * Social · lo que un amigo decidió compartir: su avatar (enlace firmado), sus viajes y su actividad
 * (reservas, recomendaciones, favoritos, lugares visitados y momentos), con reacciones y preguntas.
 *
 * Todo sale de RPC SECURITY DEFINER que primero comprueban la amistad ACEPTADA y lo que la persona
 * prendió en "Qué ven mis amigos" (migración 20261027090000_social_amigos.sql). Aquí se lee de forma
 * defensiva y con una lista cerrada de campos: aunque el servidor mandara de más, la pantalla no lo pinta
 * (nunca precio, código de confirmación, proveedor, horario ni enlace de la reserva).
 */
import { bookingLink, getYourGuideLink, googleMapsSearchLink, openTableLink } from "@/lib/affiliateLinks";

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export type ActivityTipo = "reserva" | "recomendacion" | "favorito" | "visitado" | "momento";
export type Reaccion = "corazon" | "fuego" | "antojo";
export const REACCIONES: { id: Reaccion; emoji: string; label: string }[] = [
  { id: "corazon", emoji: "❤️", label: "Me encanta" },
  { id: "fuego", emoji: "🔥", label: "Increíble" },
  { id: "antojo", emoji: "😋", label: "Se me antojó" },
];

export type MiPregunta = { id: string; pregunta: string; respuesta: string | null; fecha: string | null };

export type ActivityItem = {
  clave: string;
  tipo: ActivityTipo;
  /** Solo el día (YYYY-MM-DD), nunca la hora. */
  fecha: string | null;
  categoria: string | null;
  titulo: string;
  ciudad: string | null;
  pais: string | null;
  estrellas: number | null;
  nota: string | null;
  cocina: string | null;
  placeId: string | null;
  photoRef: string | null;
  imagen: string | null;
  fotoPath: string | null;
  miReaccion: Reaccion | null;
  misPreguntas: MiPregunta[];
  /** En el feed de todos los amigos: de quién es. */
  amigo: { id: string; nombre: string } | null;
};

export type OwnQuestion = { id: string; de: string; pregunta: string; respuesta: string | null; fecha: string | null };
export type OwnActivityItem = ActivityItem & {
  oculto: boolean;
  tipoCompartido: boolean;
  /** Si pasó hace menos de 24 h: desde cuándo la verán tus amigos (ISO). */
  visibleDesde: string | null;
  reacciones: Record<Reaccion, number>;
  preguntas: OwnQuestion[];
};

export type FriendTrip = {
  /** Solo si el viaje es de los dos (los dos ya pueden abrirlo). */
  id: string | null;
  clave: string;
  destino: string;
  paises: string[];
  portada: string | null;
  fase: "pasado" | "en_curso" | "proximo";
  juntos: boolean;
  oculto: boolean;
  mesSalida: string | null;
  mesRegreso: string | null;
  fechaSalida: string | null;
  fechaRegreso: string | null;
};

export type SocialSettings = {
  avatar: boolean; viajes_pasados: boolean; viajes_proximos: boolean; fechas_completas: boolean;
  reservas: boolean; recomendaciones: boolean; favoritos: boolean; visitados: boolean; momentos: boolean;
};
export const DEFAULT_SETTINGS: SocialSettings = {
  avatar: true, viajes_pasados: true, viajes_proximos: false, fechas_completas: false,
  reservas: false, recomendaciones: false, favoritos: false, visitados: false, momentos: false,
};
export const ACTIVITY_KEYS = ["reservas", "recomendaciones", "favoritos", "visitados", "momentos"] as const;

export type OwnMoment = { id: string; fotoPath: string; titulo: string; compartido: boolean };

// ───────────── Lectura defensiva ─────────────
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try { return new URL(v).protocol === "https:" ? v : null; } catch { return null; }
};
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const month = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : null);
const TIPOS: ActivityTipo[] = ["reserva", "recomendacion", "favorito", "visitado", "momento"];
const REAC_IDS = REACCIONES.map((r) => r.id) as string[];
const PHOTO_REF = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const PRIVATE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

function parseQuestions(v: unknown): MiPregunta[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).filter((q) => typeof q.id === "string" && str(q.pregunta, 280))
    .map((q) => ({ id: q.id as string, pregunta: str(q.pregunta, 280)!, respuesta: str(q.respuesta, 500), fecha: day(q.fecha) }))
    .slice(0, 20);
}

export function parseActivityItem(v: unknown): ActivityItem | null {
  if (!isObj(v) || typeof v.clave !== "string" || !TIPOS.includes(v.tipo as ActivityTipo)) return null;
  const titulo = str(v.titulo);
  if (!titulo) return null;
  const est = Number(v.estrellas);
  const r = str(v.mi_reaccion, 20);
  const a = isObj(v.amigo) && typeof v.amigo.id === "string" ? { id: v.amigo.id, nombre: str(v.amigo.nombre, 30) ?? "Tu amigo" } : null;
  const photoRef = str(v.photo_ref, 400);
  const fotoPath = str(v.foto_path, 120);
  return {
    clave: v.clave.slice(0, 60),
    tipo: v.tipo as ActivityTipo,
    fecha: day(v.fecha),
    categoria: str(v.categoria, 20),
    titulo,
    ciudad: str(v.ciudad, 60),
    pais: str(v.pais, 60),
    estrellas: Number.isInteger(est) && est >= 1 && est <= 5 ? est : null,
    nota: str(v.nota, 280),
    cocina: str(v.cocina, 40),
    placeId: str(v.place_id, 300),
    photoRef: photoRef && PHOTO_REF.test(photoRef) ? photoRef : null,
    imagen: httpsUrl(v.imagen),
    fotoPath: fotoPath && PRIVATE_PATH.test(fotoPath) ? fotoPath : null,
    miReaccion: r && REAC_IDS.includes(r) ? (r as Reaccion) : null,
    misPreguntas: parseQuestions(v.mis_preguntas),
    amigo: a,
  };
}

export function parseActivity(data: unknown): { status: "ok" | "privado" | "error"; items: ActivityItem[]; comparte: Partial<SocialSettings> } {
  if (Array.isArray(data)) return { status: "ok", items: data.map(parseActivityItem).filter((x): x is ActivityItem => !!x), comparte: {} };
  if (!isObj(data)) return { status: "error", items: [], comparte: {} };
  if (data.ok !== true) return { status: data.error === "privado" ? "privado" : "error", items: [], comparte: {} };
  const c = isObj(data.comparte) ? data.comparte : {};
  const comparte: Partial<SocialSettings> = {};
  for (const k of ACTIVITY_KEYS) if (typeof c[k] === "boolean") comparte[k] = c[k] as boolean;
  const items = Array.isArray(data.items) ? data.items.map(parseActivityItem).filter((x): x is ActivityItem => !!x) : [];
  return { status: "ok", items, comparte };
}

export function parseTrips(data: unknown): { status: "ok" | "privado" | "error"; viajes: FriendTrip[]; comparte: { pasados: boolean; proximos: boolean; fechas_completas: boolean } } {
  const empty = { pasados: true, proximos: false, fechas_completas: false };
  if (!isObj(data)) return { status: "error", viajes: [], comparte: empty };
  if (data.ok !== true) return { status: data.error === "privado" ? "privado" : "error", viajes: [], comparte: empty };
  const c = isObj(data.comparte) ? data.comparte : {};
  return {
    status: "ok",
    comparte: { pasados: c.pasados !== false, proximos: c.proximos === true, fechas_completas: c.fechas_completas === true },
    viajes: parseTripList(data.viajes),
  };
}

export function parseTripList(v: unknown): FriendTrip[] {
  if (!Array.isArray(v)) return [];
  const out: FriendTrip[] = [];
  for (const t of v) {
    if (!isObj(t) || typeof t.clave !== "string" || !str(t.destino)) continue;
    const fase = t.fase === "pasado" || t.fase === "en_curso" || t.fase === "proximo" ? t.fase : null;
    if (!fase) continue;
    out.push({
      id: typeof t.id === "string" ? t.id : null,
      clave: t.clave.slice(0, 60),
      destino: str(t.destino, 80)!,
      paises: Array.isArray(t.paises) ? t.paises.map((p) => str(p, 60)).filter((p): p is string => !!p).slice(0, 6) : [],
      portada: httpsUrl(t.portada),
      fase,
      juntos: t.juntos === true,
      oculto: t.oculto === true,
      mesSalida: month(t.mes_salida),
      mesRegreso: month(t.mes_regreso),
      fechaSalida: day(t.fecha_salida),
      fechaRegreso: day(t.fecha_regreso),
    });
  }
  return out.slice(0, 60);
}

/**
 * Nombre legible de un viaje (auditoría de cuenta #17): un viaje guardado desde Planear podía llamarse
 * con el texto crudo de la petición ("Quiero conocer España 15 días, no sé qué ciudades. Del 4 al…").
 * Si el destino parece una frase, se usa el país (o países) del viaje; si no hay, se recorta.
 */
export function displayTripName(t: Pick<FriendTrip, "destino" | "paises">): string {
  const d = (t.destino ?? "").replace(/\s+/g, " ").trim();
  const sentence = d.length > 40 || /[.,;:¿?¡!]\s|[.,;:]$/.test(d) || /^(quiero|quisiera|me gustar[ií]a|planea|planear|necesito|busco|ay[uú]dame)\b/i.test(d);
  if (!sentence) return d || "Viaje";
  const countries = (t.paises ?? []).map((p) => p.trim()).filter(Boolean);
  if (countries.length) return countries.slice(0, 3).join(", ");
  const short = d.split(/[.,;:¿?¡!]/)[0].trim();
  return short.length > 40 ? `${short.slice(0, 39).trimEnd()}…` : short || "Viaje";
}

/**
 * Viajes iguales (mismo nombre visible, fechas y fase) que no se pueden esconder uno por uno (sin id)
 * se muestran una sola vez con cuántos son; antes "Madrid" salía 4 veces seguidas.
 */
export function groupOwnTrips(trips: FriendTrip[]): Array<FriendTrip & { nombre: string; repetidos: number }> {
  const out: Array<FriendTrip & { nombre: string; repetidos: number }> = [];
  const seen = new Map<string, number>();
  for (const t of trips) {
    const nombre = displayTripName(t);
    if (t.id) { out.push({ ...t, nombre, repetidos: 1 }); continue; }
    const key = [nombre.toLowerCase(), t.fechaSalida ?? t.mesSalida ?? "", t.fechaRegreso ?? t.mesRegreso ?? "", t.fase, t.oculto ? 1 : 0].join("|");
    const at = seen.get(key);
    if (at !== undefined) { out[at].repetidos += 1; continue; }
    seen.set(key, out.length);
    out.push({ ...t, nombre, repetidos: 1 });
  }
  return out;
}

export function parseSettings(v: unknown): SocialSettings {
  const o = isObj(v) ? v : {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof SocialSettings)[]) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  return out;
}

export function parseOwnActivity(data: unknown): { ok: boolean; ajustes: SocialSettings; items: OwnActivityItem[]; viajes: FriendTrip[]; momentos: OwnMoment[] } {
  if (!isObj(data) || data.ok !== true) return { ok: false, ajustes: DEFAULT_SETTINGS, items: [], viajes: [], momentos: [] };
  const items: OwnActivityItem[] = [];
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    const base = parseActivityItem(raw);
    if (!base || !isObj(raw)) continue;
    const r = isObj(raw.reacciones) ? raw.reacciones : {};
    const n = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
    items.push({
      ...base,
      oculto: raw.oculto === true,
      tipoCompartido: raw.tipo_compartido === true,
      visibleDesde: str(raw.visible_desde, 40),
      reacciones: { corazon: n(r.corazon), fuego: n(r.fuego), antojo: n(r.antojo) },
      preguntas: Array.isArray(raw.preguntas)
        ? raw.preguntas.filter(isObj).filter((q) => typeof q.id === "string" && str(q.pregunta, 280))
            .map((q) => ({ id: q.id as string, de: str(q.de, 30) ?? "Tu amigo", pregunta: str(q.pregunta, 280)!, respuesta: str(q.respuesta, 500), fecha: day(q.fecha) }))
        : [],
    });
  }
  const momentos: OwnMoment[] = (Array.isArray(data.momentos) ? data.momentos : []).filter(isObj)
    .filter((m) => typeof m.id === "string" && typeof m.foto_path === "string" && PRIVATE_PATH.test(m.foto_path))
    .map((m) => ({ id: m.id as string, fotoPath: m.foto_path as string, titulo: str(m.titulo, 80) ?? "Momento", compartido: m.compartido === true }));
  return { ok: true, ajustes: parseSettings(data.ajustes), items, viajes: parseTripList(data.viajes), momentos };
}

// ───────────── Llamadas ─────────────
type Result = { ok?: boolean; error?: string; mi_reaccion?: string | null; id?: string; ajustes?: unknown } | null;
async function call(c: RpcClient, fn: string, args?: Record<string, unknown>): Promise<Result> {
  try {
    const { data, error } = await c.rpc(fn, args);
    if (error) return { ok: false, error: "error" };
    return (data as Result) ?? { ok: false, error: "error" };
  } catch {
    return { ok: false, error: "error" };
  }
}
async function data(c: RpcClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    const { data: d, error } = await c.rpc(fn, args);
    return error ? null : d;
  } catch { return null; }
}

export const loadFriendTrips = async (c: RpcClient, amigo: string) => parseTrips(await data(c, "amigo_viajes", { p_amigo: amigo }));
export const loadFriendActivity = async (c: RpcClient, amigo: string) => parseActivity(await data(c, "amigo_actividad", { p_amigo: amigo }));
export const loadFriendsFeed = async (c: RpcClient) => parseActivity(await data(c, "amigos_actividad", { p_limite: 40 }));
export const loadOwnActivity = async (c: RpcClient) => parseOwnActivity(await data(c, "mi_actividad_social"));
export const saveSettings = (c: RpcClient, patch: Partial<SocialSettings>) => call(c, "guardar_privacidad_social", { p_ajustes: patch });
export const react = (c: RpcClient, amigo: string, clave: string, emoji: Reaccion | null) =>
  call(c, "reaccionar_actividad", { p_amigo: amigo, p_clave: clave, p_emoji: emoji });
export const ask = (c: RpcClient, amigo: string, clave: string, texto: string) =>
  call(c, "preguntar_actividad", { p_amigo: amigo, p_clave: clave, p_texto: texto });
export const answer = (c: RpcClient, pregunta: string, texto: string) => call(c, "responder_pregunta_social", { p_pregunta: pregunta, p_texto: texto });
export const hideItem = (c: RpcClient, clave: string, ocultar: boolean) => call(c, "ocultar_social", { p_clave: clave, p_ocultar: ocultar });
export const shareMoment = (c: RpcClient, id: string, compartir: boolean) => call(c, "compartir_momento_social", { p_moment: id, p_compartir: compartir });
export const recommendPlace = (c: RpcClient, r: { nombre: string; estrellas: number; categoria: string; ciudad?: string | null; nota?: string | null }) =>
  call(c, "recomendar_lugar", { p_nombre: r.nombre, p_estrellas: r.estrellas, p_categoria: r.categoria, p_ciudad: r.ciudad ?? null, p_nota: r.nota ?? null });
export const deleteRecommendation = (c: RpcClient, id: string) => call(c, "borrar_recomendacion", { p_id: id });

export const SOCIAL_ACTIVITY_ERRORS: Record<string, string> = {
  no_disponible: "Esto ya no está disponible: tu amigo dejó de compartirlo.",
  demasiados_intentos: "Vas muy rápido. Intenta en un rato.",
  texto_invalido: "Escribe un poco más.",
  datos_invalidos: "Revisa el nombre y las estrellas.",
  no_autenticado: "Inicia sesión otra vez para continuar.",
};
export const activityError = (r: Result) => SOCIAL_ACTIVITY_ERRORS[r?.error ?? ""] ?? "No se pudo. Intenta de nuevo.";

// ───────────── Textos ─────────────
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Encabezado de la tarjeta: "Reservó en Suntory (Polanco)", "Recomienda: …", "Estuvo en: …". */
export function activityHeadline(i: Pick<ActivityItem, "tipo" | "categoria" | "titulo">): string {
  switch (i.tipo) {
    case "reserva": return i.categoria === "activity" ? `Reservó: ${i.titulo}` : `Reservó en ${i.titulo}`;
    case "recomendacion": return `Recomienda: ${i.titulo}`;
    case "favorito": return `Guardó en favoritos: ${i.titulo}`;
    case "visitado": return `Estuvo en: ${i.titulo}`;
    default: return i.titulo && i.titulo !== "Momento del viaje" ? `Momento del viaje: ${i.titulo}` : "Momento del viaje";
  }
}

export const TIPO_LABEL: Record<ActivityTipo, string> = {
  reserva: "Reserva", recomendacion: "Recomendación", favorito: "Favorito", visitado: "Lugar visitado", momento: "Momento",
};

export const stars = (n: number | null) => (n ? "⭐".repeat(n) : "");

/** "hoy", "ayer", "hace 3 días", "hace 2 semanas", "mar 2026" (con la fecha local de hoy, YYYY-MM-DD). */
export function relativeDay(iso: string | null, today: string): string | null {
  if (!iso) return null;
  const a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const d = Math.round((b - a) / 86400000);
  if (!Number.isFinite(d)) return null;
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  if (d < 35) { const w = Math.round(d / 7); return w === 1 ? "hace 1 semana" : `hace ${w} semanas`; }
  return `${MESES_CORTOS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
}

/** Fechas de un viaje según lo que la persona comparte: "mar 2026" o "10 – 17 mar 2026". */
export function tripDates(t: Pick<FriendTrip, "mesSalida" | "mesRegreso" | "fechaSalida" | "fechaRegreso">): string | null {
  const m = (ym: string) => `${MESES_CORTOS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
  if (t.fechaSalida) {
    const s = t.fechaSalida, e = t.fechaRegreso;
    const ds = +s.slice(8, 10);
    if (!e) return `${ds} ${m(s.slice(0, 7))}`;
    const de = +e.slice(8, 10);
    if (s.slice(0, 7) === e.slice(0, 7)) return `${ds} – ${de} ${m(e.slice(0, 7))}`;
    return `${ds} ${MESES_CORTOS[+s.slice(5, 7) - 1]} – ${de} ${m(e.slice(0, 7))}`;
  }
  if (t.mesSalida) return t.mesRegreso && t.mesRegreso !== t.mesSalida ? `${m(t.mesSalida)} – ${m(t.mesRegreso)}` : m(t.mesSalida);
  return null;
}

/** Enlace "Reservar" con los buscadores que ya usa la app (sin el enlace ni los datos de la reserva del amigo). */
export function reserveLink(i: Pick<ActivityItem, "tipo" | "categoria" | "titulo" | "ciudad" | "pais">): { url: string; provider: string; category: "restaurant" | "hotel" | "activity" } | null {
  const city = i.ciudad ?? i.pais ?? "";
  if (i.tipo === "momento" || i.categoria === "destino") return null;
  if (i.categoria === "restaurant" || (i.tipo === "visitado" && i.categoria === "restaurant")) {
    return { url: openTableLink(city, i.titulo), provider: "OpenTable", category: "restaurant" };
  }
  if (i.categoria === "hotel") return { url: bookingLink(city ? `${i.titulo}, ${city}` : i.titulo, "", ""), provider: "Booking.com", category: "hotel" };
  if (i.categoria === "activity" || i.tipo === "visitado" || i.categoria === "lugar") {
    return city
      ? { url: getYourGuideLink(city, i.titulo), provider: "GetYourGuide", category: "activity" }
      : { url: googleMapsSearchLink(i.titulo), provider: "Google Maps", category: "activity" };
  }
  return null;
}

/** Tipo de favorito que se guarda al copiar algo de un amigo. */
export function favoriteTipo(i: Pick<ActivityItem, "categoria">): string {
  if (i.categoria === "destino") return "destination_ai";
  if (i.categoria === "restaurant") return "restaurante";
  if (i.categoria === "hotel") return "hotel";
  if (i.categoria === "activity") return "experiencia";
  return "lugar";
}
