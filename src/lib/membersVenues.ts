// Lugares de Members Only. Salen de la RPC members_venues (solo con derecho: PRO, prueba, cortesía o
// contraseña temporal vigente), que une la tabla de siempre (nightlife_premium) con la vida nocturna
// curada del catálogo Privé (VERIFICADO o CURADO, con fuente y fecha), sin repetir lugares.
// Antes las dos pantallas leían nightlife_premium directo y lo curado no aparecía.

export type MembersVenue = {
  id: string;
  ciudad: string;
  ciudad_display: string;
  categoria: string;
  emoji: string | null;
  nombre: string;
  por_que: string | null;
  descripcion: string | null;
  dress_code: string | null;
  precio_estimado: string | null;
  reserva_requerida: boolean;
  tags: string[] | null;
  address: string | null;
  website: string | null;
  /** "curaduria" = catálogo Privé con fuente; "members" = lista de siempre. */
  fuente: "curaduria" | "members";
  effective_state: string | null;
  effective_label: string | null;
  source_url: string | null;
  verified_at: string | null;
  /** Barrio o localidad hija (p. ej. "Polanco" al buscar Ciudad de México). */
  neighborhood: string | null;
  season_state: string | null;
  age_policy: string | null;
};

export type MembersCity = { ciudad: string; display: string; pais: string | null; venues: number };

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown; status?: number }> };

// Auditoría 10, ronda 4 (N4-P2-11): una de 8 cargas dio 500 en members_venues y members_cities a la vez
// (sin efecto en pantalla, 2 errores rojos). No se reprodujo en 44 llamadas con SELECT ni el SQL lo explica
// (ambas responden en ~250 ms): es un error pasajero del servidor. Se reintenta UNA vez tras una pausa
// corta; un "sin derecho" (401/403/42501) o un error del cliente no se reintenta.
export const MEMBERS_RETRY_MS = 400;
const transient = (r: { error: unknown; status?: number }) => {
  if (!r.error) return false;
  const code = String((r.error as { code?: unknown })?.code ?? "");
  if (code === "42501" || code.startsWith("PGRST3")) return false;
  const st = typeof r.status === "number" ? r.status : 0;
  return st === 0 || st >= 500;
};
async function rpcWithRetry(client: RpcClient, fn: string, args?: Record<string, unknown>, waitMs = MEMBERS_RETRY_MS) {
  const call = () => (args === undefined ? client.rpc(fn) : client.rpc(fn, args));
  const first = await call();
  if (!transient(first)) return first;
  await new Promise((r) => setTimeout(r, waitMs));
  return call();
}

export const MEMBERS_CATEGORIES: { id: string; emoji: string; label: string }[] = [
  { id: "cabaret", emoji: "🎭", label: "Cabaret" },
  { id: "burlesque", emoji: "💃", label: "Burlesque" },
  { id: "members_club", emoji: "🥃", label: "Members Club" },
  { id: "speakeasy", emoji: "🍸", label: "Speakeasy" },
  { id: "rooftop", emoji: "🌃", label: "Rooftop" },
  { id: "casino_vip", emoji: "🎰", label: "Casino VIP" },
  { id: "jazz_lounge", emoji: "🎷", label: "Jazz Lounge" },
  { id: "evento_vip", emoji: "🥂", label: "Evento VIP" },
];

/** Filtro para lo curado cuya categoría no está en la lista (coctelería, mezcalería, club…). */
export const OTHER_CATEGORY = { id: "otros", emoji: "✨", label: "Otros" };

const KNOWN = new Set(MEMBERS_CATEGORIES.map((c) => c.id));

export const isKnownCategory = (cat: string) => KNOWN.has(cat);

/** El filtro "Otros" junta todas las categorías que la pantalla no conoce. */
export function matchesCategory(v: Pick<MembersVenue, "categoria">, cat: string | null): boolean {
  if (!cat) return true;
  if (cat === OTHER_CATEGORY.id) return !KNOWN.has(v.categoria);
  return v.categoria === cat;
}

/** Conteo por categoría con las desconocidas sumadas en "otros". */
export function countByCategory(venues: Pick<MembersVenue, "categoria">[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const v of venues) {
    const k = KNOWN.has(v.categoria) ? v.categoria : OTHER_CATEGORY.id;
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

/** Etiqueta legible de una categoría: la de la lista o la subcategoría con espacios ("Cocktail bar"). */
export function categoryLabel(cat: string): string {
  const known = MEMBERS_CATEGORIES.find((c) => c.id === cat);
  if (known) return known.label;
  const t = cat.replace(/_+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : OTHER_CATEGORY.label;
}

export function venueEmoji(v: Pick<MembersVenue, "emoji" | "categoria">): string {
  return v.emoji ?? MEMBERS_CATEGORIES.find((c) => c.id === v.categoria)?.emoji ?? "✨";
}

const domainOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
};

/** "Fuente: dominio · verificado el 1 de octubre de 2026" (solo lo que exista). Lo viejo no tiene fuente. */
export function sourceLine(v: Pick<MembersVenue, "fuente" | "source_url" | "verified_at">): string | null {
  if (v.fuente !== "curaduria") return null;
  const parts: string[] = [];
  const d = domainOf(v.source_url);
  if (d) parts.push(`Fuente: ${d}`);
  if (v.verified_at) {
    const t = new Date(v.verified_at);
    if (!Number.isNaN(t.getTime())) {
      parts.push(`verificado el ${t.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);

function toVenue(r: Record<string, unknown>): MembersVenue | null {
  const id = str(r.id);
  const nombre = str(r.nombre);
  if (!id || !nombre) return null;
  return {
    id, nombre,
    ciudad: String(r.ciudad ?? ""),
    ciudad_display: String(r.ciudad_display ?? r.ciudad ?? ""),
    categoria: String(r.categoria ?? ""),
    emoji: str(r.emoji),
    por_que: str(r.por_que),
    descripcion: str(r.descripcion),
    dress_code: str(r.dress_code),
    precio_estimado: str(r.precio_estimado),
    reserva_requerida: r.reserva_requerida === true,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : null,
    address: str(r.address),
    website: str(r.website),
    fuente: r.fuente === "curaduria" ? "curaduria" : "members",
    effective_state: str(r.effective_state),
    effective_label: str(r.effective_label),
    source_url: str(r.source_url),
    verified_at: str(r.verified_at),
    neighborhood: str(r.neighborhood),
    season_state: str(r.season_state),
    age_policy: str(r.age_policy),
  };
}

/**
 * ¿Se puede mostrar? Solo lo que tiene fuente: lo curado de Privé (VERIFICADO o CURADO, con fuente y
 * fecha) o una fila con su fuente. Las filas viejas de nightlife_premium las escribió la IA sin fuente
 * (auditoría de lugares reales: 35 % de Members Only, 38 % de sus enlaces rotos o equivocados, lugares
 * que ya cerraron): no se muestran. Sin migración: el filtro va aquí y en concierge-chat.
 */
export function isSourcedVenue(v: Pick<MembersVenue, "fuente" | "source_url">): boolean {
  return v.fuente === "curaduria" || !!v.source_url;
}

/** Lugares de una ciudad (cualquier nombre o sobrenombre: "CDMX", "Mexico City", "Polanco"). */
export async function fetchMembersVenues(client: RpcClient, city: string): Promise<{ venues: MembersVenue[]; error: boolean }> {
  const { data, error } = await rpcWithRetry(client, "members_venues", { p_ciudad: city });
  if (error || !Array.isArray(data)) return { venues: [], error: true };
  const venues = data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map(toVenue)
    .filter((v): v is MembersVenue => !!v && isSourcedVenue(v));
  return { venues, error: false };
}

/** Ciudades con lugares, de más a menos. null si la RPC falla (la pantalla usa su lista fija). */
export async function fetchMembersCities(client: RpcClient): Promise<MembersCity[] | null> {
  const { data, error } = await rpcWithRetry(client, "members_cities");
  if (error || !Array.isArray(data)) return null;
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      ciudad: String(r.ciudad ?? ""),
      display: String(r.ciudad_display ?? r.ciudad ?? ""),
      pais: typeof r.pais === "string" ? r.pais : null,
      venues: Number(r.venues) || 0,
    }))
    .filter((c) => c.display && c.venues > 0);
}

/** Nombres para la lista de sugerencias y las tarjetas: los del servidor o, si falló, la lista fija. */
export function cityNames(cities: MembersCity[] | null, fallback: string[]): string[] {
  return cities && cities.length > 0 ? cities.map((c) => c.display) : fallback;
}
