// Modo Privé de Iato: THE PRIVÉ KEY (concierge-chat, body.mode = "prive_key"). Lógica sin Deno para
// probarla con Vitest (src/test/priveKeyMode.test.ts); index.ts solo conecta Supabase y el límite.
//
// Es Iato, no otro chatbot: misma función, misma autenticación, el mismo viaje activo
// (_shared/activeTrip.ts), el mismo catálogo y la misma sesión Privé (prive_search con el JWT del usuario:
// prive_require decide). Y NO llama a ningún modelo: el plan sale del Experience Planner determinista, así
// que cuesta lo que una RPC (ver keyCost). Control de costo y abuso:
//  * preguntas: se responden sin tocar la base ni el cupo;
//  * caché por usuario y deseo normalizado (10 min): repetir no cuesta ni gasta cupo;
//  * cupo diario por usuario (planes y sorpresas por separado) además del límite por minuto/hora;
//  * nada en segundo plano.
import { buildTripQuestion, resolveActiveTrip, tripLabel, type TripLike } from "../_shared/activeTrip.ts";
import {
  buildKey, DEFAULT_FX, detectPlace, type FxToMxn, keyCost, type KeyAnswers, type KeyCandidate, type KeyMode, type KeyResult, type Lang, levelCeiling,
  resolveWish, type TripCtx,
} from "../_shared/priveKey.ts";
import { priveCodeOf, type RpcFn, toCandidate, unavailable } from "./prive.ts";

export const KEY_DAILY_LIMIT = 40;
export const SURPRISE_DAILY_LIMIT = 30;
export const KEY_CACHE_TTL_MS = 10 * 60 * 1000;

export interface KeyBody {
  wish?: unknown;
  answers?: unknown;
  key_mode?: unknown;
  trip_id?: unknown;
  exclude?: unknown;
  lang?: unknown;
}

export interface KeyCache { get(k: string): { at: number; value: Record<string, unknown> } | undefined; set(k: string, v: { at: number; value: Record<string, unknown> }): void }

export interface PriveKeyDeps {
  userId: string;
  priveSession: string | null | undefined;
  rpc: RpcFn;
  trips: (TripLike & { num_viajeros?: number | null })[];
  pinnedId: string | null;
  todayISO: string;
  /** Golpe al cupo diario (check_rate_limit con ventana de 24 h). null = no se pudo verificar. */
  hitDaily: (bucket: string, limit: number) => Promise<boolean | null>;
  cache: KeyCache;
  fx?: () => Promise<FxToMxn>;
  now?: () => number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** Respuestas estructuradas del cliente (botones de las preguntas). Nunca texto libre largo. */
export function parseAnswers(raw: unknown): KeyAnswers {
  const a = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out: KeyAnswers = {};
  const dest = str(a.destination, 80);
  if (dest) out.destination = dest;
  const date = str(a.date, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) || ["today", "tomorrow", "weekend"].includes(date)) out.date = date;
  const party = Number(a.party);
  if (Number.isInteger(party) && party >= 1 && party <= 30) out.party = party;
  if (a.budget === "open") out.budget = "open";
  else if (a.budget && typeof a.budget === "object") {
    const b = a.budget as Record<string, unknown>;
    const amount = Number(b.amount);
    const cur = str(b.currency, 3).toUpperCase();
    if (Number.isFinite(amount) && amount > 0 && amount < 10_000_000 && /^[A-Z]{3}$/.test(cur)) out.budget = { amount: Math.round(amount), currency: cur };
  }
  return out;
}

function cacheKey(userId: string, parts: unknown): string {
  const s = `${userId}|${JSON.stringify(parts)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${userId}:${(h >>> 0).toString(36)}:${s.length}`;
}

export type KeyOut = { status: number; body: Record<string, unknown> };

export async function runPriveKey(body: KeyBody, deps: PriveKeyDeps): Promise<KeyOut> {
  const t0 = deps.now?.() ?? Date.now();
  const lang: Lang = body.lang === "en" ? "en" : "es";
  const ps = typeof deps.priveSession === "string" && deps.priveSession.trim() ? deps.priveSession.trim().slice(0, 200) : null;
  if (!ps) return { status: 200, body: { ok: false, code: "PRIVE_NO_SESSION", ...unavailable("PRIVE_NO_SESSION") } };
  const text = str(body.wish, 600);
  if (text.length < 2) return { status: 400, body: { ok: false, code: "INVALID_REQUEST" } };
  const answers = parseAnswers(body.answers);
  if (body.key_mode === "surprise" || body.key_mode === "h48" || body.key_mode === "key") answers.mode = body.key_mode as KeyMode;
  const exclude = (Array.isArray(body.exclude) ? body.exclude : []).map(String).filter((x) => UUID.test(x)).slice(0, 30);

  // Viaje activo: la misma regla que el chat. Con empate NO se usa ninguno (se ofrece elegir al guardar).
  const explicitId = typeof body.trip_id === "string" && UUID.test(body.trip_id) ? body.trip_id : null;
  // "CDMX" también nombra al viaje a "Ciudad de México": se agregan los nombres del lugar detectado.
  const place = detectPlace(text) ?? (answers.destination ? detectPlace(answers.destination) : null);
  const mentionedText = place ? `${text} ${place.name_es} ${place.name_en}` : text;
  const resolution = resolveActiveTrip(deps.trips, { explicitId, pinnedId: deps.pinnedId, todayLocal: deps.todayISO, mentionedText });
  const tr = resolution.trip as (TripLike & { num_viajeros?: number | null }) | null;
  const tripCtx: TripCtx | null = tr ? { id: tr.id, destino: tr.destino ?? null, fecha_salida: tr.fecha_salida ?? null, fecha_regreso: tr.fecha_regreso ?? null,
    num_viajeros: tr.num_viajeros ?? null, reason: resolution.reason } : null;
  const tripCandidates = resolution.reason === "ambiguous" ? resolution.candidates : [];
  const wish = resolveWish(text, answers, { todayISO: deps.todayISO, trip: tripCtx, lang });
  const tripOut = wish.trip ? { id: wish.trip.id, label: tripLabel(wish.trip as TripLike), reason: resolution.reason } : null;
  const tripChoice = tripCandidates.map((c) => ({ id: c.id, label: tripLabel(c) }));
  const meta = {
    trip: tripOut, trip_note: wish.tripNote,
    trip_choice: tripChoice, trip_question: tripChoice.length > 1 ? buildTripQuestion(tripCandidates) : null,
  };

  // 1) Solo lo que falta: sin base, sin cupo, sin costo.
  const pre = buildKey([], wish, { lang, todayISO: deps.todayISO }, { tripCandidates: tripCandidates.map((c) => ({ id: c.id, destino: c.destino ?? null })) });
  if (pre.status === "questions") {
    return { status: 200, body: { ok: true, ...pre, ...meta, cost: keyCost(0, "miss", (deps.now?.() ?? Date.now()) - t0) } };
  }

  // 2) Caché (repetir el mismo deseo no gasta cupo ni consulta).
  const ck = cacheKey(deps.userId, [wish.destinationQuery, wish.date, wish.nights, wish.party, wish.budget, wish.budgetOpen, wish.mode, wish.intents, wish.occasion,
    wish.restrictions, wish.minors, wish.timeOfDay, wish.layoverHours, exclude, tripOut?.id ?? null, lang, deps.todayISO]);
  const hit = deps.cache.get(ck);
  if (hit && (deps.now?.() ?? Date.now()) - hit.at < KEY_CACHE_TTL_MS) {
    return { status: 200, body: { ...hit.value, cost: keyCost(0, "hit", (deps.now?.() ?? Date.now()) - t0) } };
  }

  // 3) Cupo diario por usuario. Si no se puede verificar, se sigue (no hay API de pago detrás).
  const surprise = wish.mode === "surprise";
  const allowed = await deps.hitDaily(surprise ? "prive-key-surprise-day" : "prive-key-day", surprise ? SURPRISE_DAILY_LIMIT : KEY_DAILY_LIMIT);
  if (allowed === false) {
    return { status: 429, body: { ok: false, code: "KEY_DAILY_LIMIT", retry_after: 3600,
      message: lang === "en" ? "You've reached today's limit for new Privé Key plans. Your saved plans are still here; try again tomorrow."
        : "Llegaste al límite de planes nuevos de The Privé Key por hoy. Tus planes guardados siguen aquí; vuelve a intentarlo mañana." } };
  }

  // 4) Catálogo verificado del destino (una sola RPC, con la sesión Privé del usuario).
  const party = wish.party ?? 2;
  const casino = wish.intents.includes("casino");
  const { data, error } = await deps.rpc("prive_search", {
    _ps: ps, _cities: [wish.destinationQuery], _universes: casino ? ["the_table", "after_dark", "casino_grand_nights", "yacht_sea", "iconic_events", "culture_access",
      "wellness_escape", "adventure_elite", "sport_leisure", "celebrations", "signature_mexico"] : null, _keywords: null,
    _date_from: wish.date, _date_to: wish.date && wish.nights > 1 ? addDays(wish.date, wish.nights - 1) : wish.date,
    _party: party, _budget: wish.budget ? levelCeiling(wish.budget, party, 3) : null, _per_universe: 6,
  });
  if (error) {
    const code = priveCodeOf(error.message);
    return { status: 200, body: { ok: false, code: code ?? "PRIVE_ERROR", ...unavailable(code ?? "PRIVE_ERROR") } };
  }
  const res = data as { available?: boolean; cities?: { resolved?: boolean; city?: Record<string, unknown> | null; coverage?: string; items?: unknown[]; age_locked?: boolean }[] } | null;
  const city = res?.cities?.[0];
  if (!res || res.available !== true || !city) return { status: 200, body: { ok: false, code: "PRIVE_ERROR", ...unavailable("PRIVE_ERROR") } };
  const items = (city.resolved ? city.items ?? [] : []) as Record<string, unknown>[];
  const cands: KeyCandidate[] = items.map((x) => ({
    ...toCandidate(x, city.city), why: (x.why as string) ?? null, neighborhood: (x.neighborhood as string) ?? null, verified_at: (x.verified_at as string) ?? null,
    price_note: (x.price_note as string) ?? null, accolades: (x.accolades as KeyCandidate["accolades"]) ?? null, image: (x.image as Record<string, unknown>) ?? null,
    reasons: Array.isArray(x.reasons) ? x.reasons as string[] : null, availability: (x.availability as KeyCandidate["availability"]) ?? null,
    members_only_venue: x.members_only_venue === true, event_start: (x.event_start as string) ?? null, event_end: (x.event_end as string) ?? null,
  }));
  const cityCur = String(city.city?.currency ?? "");
  const fx = wish.budget && cityCur && wish.budget.currency !== cityCur && deps.fx ? await deps.fx().catch(() => DEFAULT_FX) : DEFAULT_FX;
  const result: KeyResult = buildKey(cands, wish, { lang, todayISO: deps.todayISO, fx, exclude, seed: `${deps.userId}|${deps.todayISO}` });
  const ms = (deps.now?.() ?? Date.now()) - t0;
  const out = {
    ok: true, ...result, ...meta,
    destination: city.city ? { slug: city.city.slug, name: city.city.name, timezone: city.city.timezone, currency: city.city.currency } : null,
    coverage: city.coverage ?? null, age_locked: !!city.age_locked,
    fx_note: fx !== DEFAULT_FX || (wish.budget && cityCur && wish.budget.currency !== cityCur)
      ? (lang === "en" ? "Amounts in another currency are converted at an approximate rate." : "Los montos en otra moneda se convierten con un tipo de cambio aproximado.") : null,
  };
  deps.cache.set(ck, { at: deps.now?.() ?? Date.now(), value: out });
  deps.log?.("prive_key_plan", { user_id: deps.userId, mode: wish.mode, status: result.status, tiers: result.proposals.map((p) => p.tier),
    candidates: result.candidates_considered, trip_reason: resolution.reason, ms, ai_calls: 0 });
  return { status: 200, body: { ...out, cost: keyCost(1, "miss", ms) } };
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Caché en memoria por instancia (LRU simple, 500 entradas). */
export function memoryCache(max = 500): KeyCache {
  const m = new Map<string, { at: number; value: Record<string, unknown> }>();
  return {
    get: (k) => { const v = m.get(k); if (v) { m.delete(k); m.set(k, v); } return v; },
    set: (k, v) => { m.set(k, v); while (m.size > max) m.delete(m.keys().next().value as string); },
  };
}
