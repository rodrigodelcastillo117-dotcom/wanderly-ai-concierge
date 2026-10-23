// Tarjeta de rango de IATOS. El rango lo calcula SOLO el servidor (my_member_card, por auth.uid());
// aquí solo se valida la respuesta y se traduce. Orden: founder_black > platinum_2 > platinum_1 > gold > blue.
// La negra (founder_black) es de los fundadores: nunca se ofrece como algo alcanzable.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const MEMBER_TIERS = ["blue", "gold", "platinum_1", "platinum_2", "founder_black"] as const;
export type MemberTier = (typeof MEMBER_TIERS)[number];
export type CardLang = "es" | "en";

export type MemberCardData = {
  tier: MemberTier;
  since: string | null;
  number: string | null;
  tenure_days: number | null;
  prive_days: number | null;
  granted: boolean;
  name: string | null;
};

export const tierRank = (t: MemberTier) => MEMBER_TIERS.indexOf(t);

const NUMBER_RE = /^(IP|IA)-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const intOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Acepta solo una respuesta bien formada del servidor; cualquier otra cosa = sin tarjeta (no se inventa un rango). */
export function parseMemberCard(raw: unknown): MemberCardData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tier !== "string" || !(MEMBER_TIERS as readonly string[]).includes(r.tier)) return null;
  const since = typeof r.since === "string" && !Number.isNaN(Date.parse(r.since)) ? r.since : null;
  const number = typeof r.number === "string" && NUMBER_RE.test(r.number) ? r.number : null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : null;
  return {
    tier: r.tier as MemberTier, since, number, name,
    tenure_days: intOrNull(r.tenure_days), prive_days: intOrNull(r.prive_days), granted: r.granted === true,
  };
}

export async function fetchMemberCard(): Promise<MemberCardData | null> {
  try {
    const res = await (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("my_member_card");
    if (!res || res.error) return null;
    return parseMemberCard(res.data);
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<MemberCardData | null>>();
/** Para pruebas y al cerrar sesión. */
export function clearMemberCardCache() { cache.clear(); }

/**
 * Tu tarjeta. Con `uid` se comparte una sola petición entre el menú y el Travel Avatar; sin `uid`
 * (THE PRIVÉ PASSPORT, que no conoce la cuenta) se pide cada vez. Un error deja `card` en null.
 */
export function useMemberCard(uid?: string | null): { card: MemberCardData | null; loading: boolean } {
  const [state, setState] = useState<{ card: MemberCardData | null; loading: boolean }>({ card: null, loading: true });
  useEffect(() => {
    if (uid === null) { setState({ card: null, loading: false }); return; }
    let alive = true;
    let p: Promise<MemberCardData | null>;
    if (uid) {
      p = cache.get(uid) ?? fetchMemberCard();
      cache.set(uid, p);
      p.then((c) => { if (!c) cache.delete(uid); });
    } else {
      p = fetchMemberCard();
    }
    setState((s) => ({ ...s, loading: true }));
    p.then((card) => { if (alive) setState({ card, loading: false }); });
    return () => { alive = false; };
  }, [uid]);
  return state;
}

// ───────────── Textos ─────────────
type TierText = { name: string; face: string; reason: string };
const TIERS: Record<CardLang, Record<MemberTier, TierText>> = {
  es: {
    blue: { name: "Azul", face: "AZUL", reason: "Tu cuenta IATOS." },
    gold: { name: "Dorada", face: "DORADA", reason: "Tienes IATOS PRO activo." },
    platinum_1: { name: "Platinum I", face: "PLATINUM", reason: "Tienes IATOS Privé activo." },
    platinum_2: { name: "Platinum II", face: "PLATINUM", reason: "Cumpliste un año en IATOS Privé." },
    founder_black: { name: "Fundador", face: "FUNDADOR", reason: "Creador y fundador de IATOS. Esta tarjeta existe solo para los fundadores." },
  },
  en: {
    blue: { name: "Blue", face: "BLUE", reason: "Your IATOS account." },
    gold: { name: "Gold", face: "GOLD", reason: "You have IATOS PRO." },
    platinum_1: { name: "Platinum I", face: "PLATINUM", reason: "You have IATOS Privé." },
    platinum_2: { name: "Platinum II", face: "PLATINUM", reason: "One year in IATOS Privé." },
    founder_black: { name: "Founder", face: "FOUNDER", reason: "Creator and founder of IATOS. This card exists only for the founders." },
  },
};

export const CARD_TEXT = {
  es: {
    card: "Tarjeta IATOS", memberSince: "Miembro desde", number: "Número de miembro", tenure: "Antigüedad", rank: "Tu rango",
    granted: "Rango otorgado por IATOS.", open: (t: string) => `Ver mi tarjeta ${t}`, close: "Cerrar",
    howTo: "Cómo subir de nivel", current: "Tu nivel", reached: "Alcanzado",
    ladder: [
      { tier: "gold" as MemberTier, step: "IATOS PRO", to: "Dorada" },
      { tier: "platinum_1" as MemberTier, step: "IATOS Privé", to: "Platinum I" },
      { tier: "platinum_2" as MemberTier, step: "1 año en Privé", to: "Platinum II" },
    ],
    daysLeft: (n: number) => (n === 1 ? "Te falta 1 día para Platinum II." : `Te faltan ${n} días para Platinum II.`),
    seePro: "Conoce IATOS PRO", seePrive: "Conoce IATOS Privé",
    days: (n: number) => (n === 1 ? "1 día" : `${n} días`),
    years: (y: number, d: number) => `${y} ${y === 1 ? "año" : "años"}${d ? ` y ${d} ${d === 1 ? "día" : "días"}` : ""}`,
    numberNote: "Tu número de miembro no es sensible: no sirve para entrar ni para pagar.",
  },
  en: {
    card: "IATOS card", memberSince: "Member since", number: "Member number", tenure: "Tenure", rank: "Your rank",
    granted: "Rank granted by IATOS.", open: (t: string) => `View my ${t} card`, close: "Close",
    howTo: "How to level up", current: "Your level", reached: "Reached",
    ladder: [
      { tier: "gold" as MemberTier, step: "IATOS PRO", to: "Gold" },
      { tier: "platinum_1" as MemberTier, step: "IATOS Privé", to: "Platinum I" },
      { tier: "platinum_2" as MemberTier, step: "1 year in Privé", to: "Platinum II" },
    ],
    daysLeft: (n: number) => (n === 1 ? "1 day to Platinum II." : `${n} days to Platinum II.`),
    seePro: "Discover IATOS PRO", seePrive: "Discover IATOS Privé",
    days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
    years: (y: number, d: number) => `${y} ${y === 1 ? "year" : "years"}${d ? ` and ${d} ${d === 1 ? "day" : "days"}` : ""}`,
    numberNote: "Your member number is not sensitive: it can't be used to sign in or pay.",
  },
};

export const tierText = (t: MemberTier, lang: CardLang = "es") => TIERS[lang][t];

/** "10/26" (mes/año, como en una tarjeta bancaria), en hora de Ciudad de México. */
export function cardSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("es-MX", { month: "2-digit", year: "2-digit", timeZone: "America/Mexico_City" }).formatToParts(d);
  const m = p.find((x) => x.type === "month")?.value;
  const y = p.find((x) => x.type === "year")?.value;
  return m && y ? `${m}/${y}` : null;
}

export function longSince(iso: string | null, lang: CardLang = "es"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" }).format(d);
}

export function tenureLabel(days: number | null, lang: CardLang = "es"): string | null {
  if (days == null) return null;
  const T = CARD_TEXT[lang];
  if (days < 365) return T.days(days);
  return T.years(Math.floor(days / 365), days % 365);
}

/** Días que faltan para Platinum II (solo con Privé vigente y aún en Platinum I). */
export function daysToPlatinum2(card: Pick<MemberCardData, "tier" | "prive_days">): number | null {
  if (card.tier !== "platinum_1" || card.prive_days == null) return null;
  return Math.max(1, 365 - card.prive_days);
}
