/**
 * Social: perfil de un amigo, viajes juntos, saludos y lo que tienen en común.
 *
 * Todo sale de RPC SECURITY DEFINER que primero comprueban la amistad aceptada (migración
 * 20261024140000_social_friend_profile.sql). Aquí se vuelve a quedar SOLO con una lista cerrada de
 * campos: aunque el servidor algún día mandara de más (correo, teléfono, fecha de nacimiento), la
 * pantalla no lo pinta.
 */

export type GestoSaludo = "saludo" | "brindis" | "maleta" | "devuelta";

export type FriendBasics = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  ciudad_origen: string | null;
  pais_origen: string | null;
  /** Miembro IATOS Privé vigente (solo el booleano; sin código ni fechas). */
  is_prive: boolean;
};

export type SharedTrip = {
  id: string;
  destino: string;
  pais_destino: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  cover_image_url: string | null;
  status: string | null;
};

export type EnComun = {
  comida: string[];
  tardes: string[];
  hospedaje: string[];
  mismo_ritmo: boolean;
  mismo_presupuesto: boolean;
  destinos: string[];
  suenos: string[];
  yo_tengo_dna: boolean;
  amigo_tiene_dna: boolean;
  afinidad: number | null;
};

export type SaludosState = {
  puedo: boolean;
  proximo: string | null;
  ultimo_enviado: string | null;
  ultimo_recibido: string | null;
  gesto_recibido: GestoSaludo | null;
  por_devolver: boolean;
  total: number;
};

export type FriendDna = {
  estilo: string | null;
  ritmo: string | null;
  comida: string[];
  tardes: string[];
  hospedaje: string[];
};

export type FriendProfileData = {
  amigo: FriendBasics;
  /** Yo soy Privé (para mi lado de la postal). */
  yo_prive: boolean;
  amigos_desde: string | null;
  dna: FriendDna;
  en_comun: EnComun;
  viajes_juntos: SharedTrip[];
  viajes_juntos_total: number;
  lugares: { ciudad: string; pais: string | null }[];
  saludos: SaludosState;
};

export type FriendProfileResult =
  | { status: "ok"; data: FriendProfileData }
  | { status: "privado" }
  /** El perfil no existe (enlace roto o id inventado): antes se decía "es privado". */
  | { status: "no_existe" }
  | { status: "eres_tu" }
  | { status: "error" };

export type FriendSummary = {
  amigo_id: string;
  is_prive: boolean;
  viajes_juntos: number;
  afinidad: number | null;
  en_comun: Omit<EnComun, "yo_tengo_dna" | "amigo_tiene_dna" | "afinidad">;
  saludo_por_devolver: boolean;
};

// ───────────── Lectura defensiva ─────────────
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strs = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, max).map((x) => x.trim().slice(0, 60)) : [];
const bool = (v: unknown) => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  try { return new URL(v).protocol === "https:" ? v : null; } catch { return null; }
};
const GESTOS: GestoSaludo[] = ["saludo", "brindis", "maleta", "devuelta"];

function parseEnComun(v: unknown): EnComun {
  const o = isObj(v) ? v : {};
  const af = o.afinidad;
  return {
    comida: strs(o.comida), tardes: strs(o.tardes), hospedaje: strs(o.hospedaje),
    mismo_ritmo: bool(o.mismo_ritmo), mismo_presupuesto: bool(o.mismo_presupuesto),
    destinos: strs(o.destinos), suenos: strs(o.suenos),
    yo_tengo_dna: bool(o.yo_tengo_dna), amigo_tiene_dna: bool(o.amigo_tiene_dna),
    afinidad: typeof af === "number" && Number.isFinite(af) ? Math.max(0, Math.min(100, Math.round(af))) : null,
  };
}

function parseSaludos(v: unknown): SaludosState {
  const o = isObj(v) ? v : {};
  const g = str(o.gesto_recibido);
  return {
    puedo: o.puedo === undefined ? true : bool(o.puedo),
    proximo: str(o.proximo, 40),
    ultimo_enviado: str(o.ultimo_enviado, 40),
    ultimo_recibido: str(o.ultimo_recibido, 40),
    gesto_recibido: g && (GESTOS as string[]).includes(g) ? (g as GestoSaludo) : null,
    por_devolver: bool(o.por_devolver),
    total: num(o.total),
  };
}

function parseTrip(v: unknown): SharedTrip | null {
  if (!isObj(v) || typeof v.id !== "string" || !str(v.destino)) return null;
  return {
    id: v.id, destino: str(v.destino)!, pais_destino: str(v.pais_destino),
    fecha_salida: str(v.fecha_salida, 10), fecha_regreso: str(v.fecha_regreso, 10),
    cover_image_url: httpsUrl(v.cover_image_url), status: str(v.status, 30),
  };
}

/** Respuesta de amigo_perfil → datos de pantalla (solo campos permitidos). */
export function parseFriendProfile(data: unknown): FriendProfileResult {
  if (!isObj(data)) return { status: "error" };
  if (data.ok !== true) {
    if (data.error === "privado" || data.error === "no_son_amigos") return { status: "privado" };
    if (data.error === "eres_tu") return { status: "eres_tu" };
    return { status: "error" };
  }
  const a = isObj(data.amigo) ? data.amigo : null;
  if (!a || typeof a.id !== "string") return { status: "error" };
  const dna = isObj(data.dna) ? data.dna : {};
  return {
    status: "ok",
    data: {
      amigo: {
        id: a.id, full_name: str(a.full_name, 80), username: str(a.username, 40), avatar_url: httpsUrl(a.avatar_url),
        ciudad_origen: str(a.ciudad_origen, 60), pais_origen: str(a.pais_origen, 60), is_prive: bool(a.is_prive),
      },
      yo_prive: bool(data.yo_prive),
      amigos_desde: str(data.amigos_desde, 40),
      dna: { estilo: str(dna.estilo, 60), ritmo: str(dna.ritmo, 30), comida: strs(dna.comida, 8), tardes: strs(dna.tardes, 8), hospedaje: strs(dna.hospedaje, 8) },
      en_comun: parseEnComun(data.en_comun),
      viajes_juntos: Array.isArray(data.viajes_juntos) ? data.viajes_juntos.map(parseTrip).filter((t): t is SharedTrip => !!t) : [],
      viajes_juntos_total: num(data.viajes_juntos_total),
      lugares: Array.isArray(data.lugares)
        ? data.lugares.filter(isObj).map((l) => ({ ciudad: str(l.ciudad, 60) ?? "", pais: str(l.pais, 60) })).filter((l) => !!l.ciudad).slice(0, 40)
        : [],
      saludos: parseSaludos(data.saludos),
    },
  };
}

/** Respuesta de amigos_resumen → mapa por amigo. */
export function parseFriendSummaries(data: unknown): Map<string, FriendSummary> {
  const out = new Map<string, FriendSummary>();
  if (!Array.isArray(data)) return out;
  for (const r of data) {
    if (!isObj(r) || typeof r.amigo_id !== "string") continue;
    const ec = parseEnComun(r.en_comun);
    const af = r.afinidad;
    out.set(r.amigo_id, {
      amigo_id: r.amigo_id,
      is_prive: bool(r.is_prive),
      viajes_juntos: num(r.viajes_juntos),
      afinidad: typeof af === "number" && Number.isFinite(af) ? Math.round(af) : null,
      en_comun: { comida: ec.comida, tardes: ec.tardes, hospedaje: ec.hospedaje, mismo_ritmo: ec.mismo_ritmo, mismo_presupuesto: ec.mismo_presupuesto, destinos: ec.destinos, suenos: ec.suenos },
      saludo_por_devolver: bool(r.saludo_por_devolver),
    });
  }
  return out;
}

// ───────────── Textos ─────────────
type Label = { label: string; emoji: string; comun: string };

/** Etiquetas del Travel DNA (ids de OnboardingDeep) y cómo se dice "los dos…". */
export const DNA_LABELS: Record<"ritmo" | "comida" | "tardes" | "hospedaje", Record<string, Label>> = {
  ritmo: {
    explorador: { label: "Explorador imparable", emoji: "🔥", comun: "Los dos viajan a todo lo que da" },
    equilibrado: { label: "Equilibrado", emoji: "⚖️", comun: "Mismo ritmo: equilibrado" },
    slow: { label: "Slow travel", emoji: "🌿", comun: "Los dos viajan sin prisas" },
  },
  comida: {
    foodie: { label: "Foodie aventurero", emoji: "🌮", comun: "Los dos aman la comida callejera" },
    michelin: { label: "Coleccionista Michelin", emoji: "⭐", comun: "Los dos coleccionan estrellas Michelin" },
    practico: { label: "Práctico en la mesa", emoji: "🥗", comun: "Los dos comen rápido y rico" },
  },
  tardes: {
    museos: { label: "Museos e historia", emoji: "🏛️", comun: "A los dos los pierdes en un museo" },
    naturaleza: { label: "Naturaleza", emoji: "🥾", comun: "Los dos prefieren un sendero" },
    compras: { label: "Compras", emoji: "🛍️", comun: "Los dos regresan con maleta extra" },
    nocturna: { label: "Vida nocturna", emoji: "🍸", comun: "Los dos cierran la noche" },
    playas: { label: "Playas", emoji: "🌊", comun: "Los dos son de playa" },
    talleres: { label: "Talleres locales", emoji: "🎭", comun: "A los dos les gusta aprender del lugar" },
  },
  hospedaje: {
    resort_ai: { label: "Todo incluido", emoji: "🏖️", comun: "Los dos disfrutan un todo incluido" },
    boutique: { label: "Hoteles boutique", emoji: "🎨", comun: "Los dos eligen hoteles boutique" },
    departamento: { label: "Departamentos céntricos", emoji: "🏙️", comun: "Los dos viven la ciudad como locales" },
    glamping: { label: "Glamping", emoji: "⛺", comun: "Los dos duermen bajo las estrellas" },
  },
};

export function dnaLabel(kind: keyof typeof DNA_LABELS, id: string): Label | null {
  return DNA_LABELS[kind][id] ?? null;
}

/** Nombre corto para textos ("Carlo"). */
export function firstName(p: { full_name?: string | null; username?: string | null } | null | undefined, fallback = "Tu amigo"): string {
  const n = p?.full_name?.trim().split(/\s+/)[0] || p?.username?.trim() || "";
  return n ? n.slice(0, 24) : fallback;
}

/** "cdmx" → "CDMX", "ciudad de méxico" → "Ciudad De México" (solo si llegó todo en minúsculas). */
export function prettyPlace(s: string): string {
  const t = s.trim();
  if (t !== t.toLowerCase()) return t;
  if (t.length <= 4 && !/\s/.test(t)) return t.toUpperCase();
  return t.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());
}

export type CommonItem = { key: string; emoji: string; text: string; tipo: "destino" | "sueno" | "dna"; value?: string };

/** Lo que tienen en común, en frases positivas y en orden de "qué tan especial" es. */
export function commonGround(ec: Pick<EnComun, "comida" | "tardes" | "hospedaje" | "mismo_ritmo" | "destinos" | "suenos">, ritmoId?: string | null): CommonItem[] {
  const items: CommonItem[] = [];
  for (const d of ec.suenos) items.push({ key: `sueno:${d}`, emoji: "✨", text: `Los dos sueñan con ${prettyPlace(d)}`, tipo: "sueno", value: prettyPlace(d) });
  for (const d of ec.destinos) items.push({ key: `dest:${d}`, emoji: "📍", text: `Ambos viajaron a ${prettyPlace(d)}`, tipo: "destino", value: prettyPlace(d) });
  for (const id of ec.comida) { const l = dnaLabel("comida", id); if (l) items.push({ key: `comida:${id}`, emoji: l.emoji, text: l.comun, tipo: "dna" }); }
  for (const id of ec.tardes) { const l = dnaLabel("tardes", id); if (l) items.push({ key: `tardes:${id}`, emoji: l.emoji, text: l.comun, tipo: "dna" }); }
  if (ec.mismo_ritmo) {
    const l = ritmoId ? dnaLabel("ritmo", ritmoId) : null;
    items.push({ key: "ritmo", emoji: l?.emoji ?? "⚖️", text: l?.comun ?? "Viajan al mismo ritmo", tipo: "dna" });
  }
  for (const id of ec.hospedaje) { const l = dnaLabel("hospedaje", id); if (l) items.push({ key: `hosp:${id}`, emoji: l.emoji, text: l.comun, tipo: "dna" }); }
  return items;
}

/** Afinidad solo cuando hay datos y no desanima (≥ 40 %). */
export const AFINIDAD_MINIMA = 40;
export const showAfinidad = (af: number | null | undefined): af is number => typeof af === "number" && af >= AFINIDAD_MINIMA;

/** Línea corta para la tarjeta de un amigo en la lista de Social. Nunca "0 %". */
export function summaryLine(s: FriendSummary | undefined, nombre: string): string {
  if (!s) return "Toca para ver su perfil";
  if (s.saludo_por_devolver) return `${nombre} te mandó un saludo ✈️`;
  if (s.viajes_juntos > 0) return s.viajes_juntos === 1 ? "1 viaje juntos" : `${s.viajes_juntos} viajes juntos`;
  const first = commonGround(s.en_comun)[0];
  if (first) return `${first.emoji} ${first.text}`;
  return "Su primer viaje juntos está por escribirse";
}

export const GESTO_COPY: Record<Exclude<GestoSaludo, "devuelta">, { emoji: string; label: string; enviado: string }> = {
  saludo: { emoji: "✈️", label: "Saludo", enviado: "¡Saludo enviado!" },
  brindis: { emoji: "🥂", label: "Brindis", enviado: "¡Brindis enviado!" },
  maleta: { emoji: "🧳", label: "¿Nos vamos?", enviado: "¡Ya sabe que quieres viajar!" },
};

/** "en 5 h", "en 40 min", "mañana" para el próximo saludo. */
export function untilText(iso: string | null, now = Date.now()): string {
  if (!iso) return "pronto";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "ya";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `en ${min} min`;
  const h = Math.ceil(min / 60);
  return `en ${h} h`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "octubre 2026" (de un timestamp o fecha). */
export function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

/** "mar 2026" para tarjetas de viaje. */
export function shortMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${MESES_CORTOS[Number(m[2]) - 1]} ${m[1]}`;
}

export const yearOf = (iso: string | null): string | null => (iso && /^\d{4}/.test(iso) ? iso.slice(0, 4) : null);

/** Viaje vivido (ya regresaron), en curso o por venir, con la fecha local de hoy (YYYY-MM-DD). */
export function tripPhase(t: Pick<SharedTrip, "fecha_salida" | "fecha_regreso">, today: string): "vivido" | "en_curso" | "proximo" | "sin_fecha" {
  if (!t.fecha_salida) return "sin_fecha";
  if (t.fecha_regreso && t.fecha_regreso < today) return "vivido";
  if (t.fecha_salida <= today) return "en_curso";
  return "proximo";
}

/** El viaje que mejor queda en la postal: el último vivido; si no, el próximo; si no, el primero. */
export function pickPostcardTrip(trips: SharedTrip[], today: string): SharedTrip | null {
  if (!trips.length) return null;
  const vividos = trips.filter((t) => tripPhase(t, today) === "vivido");
  if (vividos.length) return vividos[0];
  const conFecha = trips.filter((t) => t.fecha_salida).sort((a, b) => (a.fecha_salida! < b.fecha_salida! ? -1 : 1));
  return conFecha[0] ?? trips[0];
}

/** Mensajes de error de saludar_amigo / invitar_amigo_viaje en español. */
export const SOCIAL_ERRORS: Record<string, string> = {
  no_autenticado: "Inicia sesión otra vez para continuar.",
  no_son_amigos: "Ya no están conectados en Social.",
  gesto_invalido: "Ese saludo no existe.",
  viaje_no_existe: "Ese viaje ya no existe.",
  no_eres_dueno: "Solo quien creó el viaje puede invitar.",
};

/** Liga para planear un viaje nuevo con el amigo (PlanTrip lo invita al guardar con ?con=). */
export function planWithFriendHref(friendId: string, destino?: string | null): string {
  const q = new URLSearchParams({ con: friendId });
  if (destino) q.set("destino", destino);
  return `/dashboard/planear?${q.toString()}`;
}
