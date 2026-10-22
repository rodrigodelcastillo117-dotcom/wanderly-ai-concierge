/**
 * privevalor — tipos y reglas puras de PRIVÉ DROPS, THE PRIVILEGE RADAR, THE VALUE OF YOUR PRIVÉ,
 * THE INSIDER'S NOTEBOOK (+ BEFORE YOU GO) y THE PRIVÉ PASSPORT.
 *
 * La base de datos es la autoridad (supabase/migrations/202610241*_privevalor_*.sql). Estas funciones son
 * la segunda línea de defensa en la pantalla: si algún día llega una respuesta vieja de caché, un Drop
 * vencido no se pinta como activo, y un porcentaje sin comparación verificable no se pinta nunca.
 */

export type DropType =
  | "promocion_publica" | "tarifa_publicada" | "beneficio_lealtad" | "beneficio_tarjeta"
  | "oferta_temporal" | "beneficio_iatos" | "editorial";
export type DropStatus = "activo" | "por_verificar" | "vencido" | "programado" | "retirado";
export type DropReason = "viaje" | "guardado" | "boveda";
export type Bilingual = { es?: string | null; en?: string | null };

export interface PriveDrop {
  id: string;
  slug: string;
  type: DropType;
  status: DropStatus;
  title: Bilingual;
  provider: { name: string; url?: string | null };
  destination?: { slug: string; es?: string | null; en?: string | null } | null;
  benefit: Bilingual;
  conditions?: Bilingual;
  eligibility?: Bilingual;
  restrictions?: Bilingual;
  valid_from?: string | null;
  valid_until?: string | null;
  price?: { offer?: number | string | null; reference?: number | string | null; currency?: string | null; source?: string | null; discount_pct?: number | string | null } | null;
  source: { url: string; name?: string | null };
  link: string;
  last_verified_at: string;
  relationship?: "ninguna" | "afiliado" | "publicidad" | "convenio";
  universes?: string[];
  interests?: string[];
  reasons?: DropReason[];
  matched_program?: string;
  suggested_state?: RadarState;
}

export interface DropsResponse { items: PriveDrop[]; expired_recent: number; destination_found: boolean; generated_at?: string }

/** Días sin revisión tras los cuales un Drop pasa a "por verificar" (igual que la base). */
export const DROP_REVIEW_DAYS = 45;

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "AAAA-MM-DD" de hoy en una zona horaria (por omisión, Ciudad de México). */
export function localToday(now: Date = new Date(), timeZone = "America/Mexico_City"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Estado efectivo calculado también en el cliente (respaldo de la base). */
export function effectiveDropStatus(d: Pick<PriveDrop, "status" | "valid_from" | "valid_until" | "last_verified_at" | "type" | "relationship">,
  today: string, now: Date = new Date()): DropStatus {
  if (d.status === "retirado") return "retirado";
  if (d.type === "beneficio_iatos" && d.relationship !== "convenio") return "retirado";
  if (d.valid_until && d.valid_until < today) return "vencido";
  if (d.valid_from && d.valid_from > today) return "programado";
  if (d.status === "vencido" || d.status === "programado") return d.status;
  const verified = Date.parse(d.last_verified_at);
  if (d.status === "por_verificar" || !Number.isFinite(verified) || now.getTime() - verified > DROP_REVIEW_DAYS * 86400e3) return "por_verificar";
  return "activo";
}

/** Un porcentaje solo con comparación verificable: referencia > oferta ≥ 0, moneda, fuente y aritmética que cuadra. */
export function verifiableDiscount(price: PriveDrop["price"]): number | null {
  if (!price) return null;
  const pct = asNum(price.discount_pct), ref = asNum(price.reference), offer = asNum(price.offer);
  if (pct === null || ref === null || offer === null || !price.currency || !/^https:\/\//.test(price.source ?? "")) return null;
  if (!(ref > 0 && offer >= 0 && offer < ref)) return null;
  const calc = Math.round((10000 * (ref - offer)) / ref) / 100;
  return Math.abs(calc - pct) <= 0.5 ? Math.round(pct) : null;
}

const PERCENT = /[0-9]\s*(%|por ciento|percent)/i;
/** ¿El Drop dice un porcentaje que no podemos comprobar? Entonces no se pinta (nunca "40 %" sin comparación). */
export function hasUnverifiablePercent(d: PriveDrop): boolean {
  const txt = [d.title?.es, d.title?.en, d.benefit?.es, d.benefit?.en, d.conditions?.es, d.conditions?.en, d.eligibility?.es, d.restrictions?.es]
    .filter(Boolean).join(" ");
  return PERCENT.test(txt) && verifiableDiscount(d.price) === null;
}

/** Lo que se puede mostrar hoy: activo o por verificar, sin porcentajes dudosos, beneficio IATOS solo con convenio. */
export function visibleDrops(items: PriveDrop[] | null | undefined, today: string, now: Date = new Date()): PriveDrop[] {
  return (items ?? []).filter((d) => {
    const s = effectiveDropStatus(d, today, now);
    return (s === "activo" || s === "por_verificar") && !hasUnverifiablePercent(d) && /^https:\/\//.test(d.source?.url ?? "") && /^https:\/\//.test(d.link ?? "");
  });
}

/** Precio mostrable: solo con su fuente. La comparación "antes" solo junto al porcentaje verificable. */
export function displayPrice(price: PriveDrop["price"]): { offer: number; currency: string; reference: number | null; pct: number | null; source: string } | null {
  if (!price) return null;
  const offer = asNum(price.offer);
  if (offer === null || !price.currency || !/^https:\/\//.test(price.source ?? "")) return null;
  const pct = verifiableDiscount(price);
  return { offer, currency: price.currency, reference: pct === null ? null : asNum(price.reference), pct, source: price.source as string };
}

export function pick(b: Bilingual | null | undefined, lang: "es" | "en"): string {
  if (!b) return "";
  return (lang === "en" ? b.en || b.es : b.es || b.en) ?? "";
}

// ───────────────────────────── THE PRIVILEGE RADAR ─────────────────────────────
export type RadarState = "posible" | "por_comprobar" | "verificado" | "utilizado";
export const RADAR_STATES: RadarState[] = ["posible", "por_comprobar", "verificado", "utilizado"];

export interface RadarItem {
  id: string;
  drop_id?: string | null;
  drop_slug?: string | null;
  drop_status?: DropStatus | null;
  program: string;
  benefit: string;
  state: RadarState;
  source_url?: string | null;
  conditions?: string | null;
  verification_note?: string | null;
  verified_at?: string | null;
  used_at?: string | null;
  trip_id?: string | null;
  updated_at?: string;
}
export interface RadarProgram { kind: string; label: string; tier?: string | null }
export interface RadarResponse { programs: RadarProgram[]; items: RadarItem[]; suggestions: PriveDrop[] }

/** Transiciones permitidas (las mismas reglas que prive_radar_save). */
export function nextRadarStates(s: RadarState): RadarState[] {
  switch (s) {
    case "posible": return ["por_comprobar", "verificado"];
    case "por_comprobar": return ["verificado", "posible"];
    case "verificado": return ["utilizado", "por_comprobar"];
    case "utilizado": return ["verificado"];
  }
}
/** ¿Se puede guardar este cambio? Verificado exige decir cómo; utilizado exige estar verificado. */
export function radarTransitionError(item: Pick<RadarItem, "state" | "verified_at" | "verification_note">, to: RadarState, note?: string | null): "VERIFICATION_REQUIRED" | "VERIFY_FIRST" | "NOT_ALLOWED" | null {
  if (to === item.state) return null;
  if (!nextRadarStates(item.state).includes(to)) return to === "utilizado" ? "VERIFY_FIRST" : "NOT_ALLOWED";
  const n = (note ?? item.verification_note ?? "").trim();
  if (to === "verificado" && n.length < 3) return "VERIFICATION_REQUIRED";
  if (to === "utilizado" && !(item.state === "verificado" && item.verified_at)) return "VERIFY_FIRST";
  return null;
}

// ───────────────────────────── THE VALUE OF YOUR PRIVÉ ─────────────────────────────
export type ValueKind = "comprobado" | "estimado" | "potencial" | "sin_ahorro";
export interface ValueEntry {
  id: string; kind: ValueKind; title: string; currency?: string | null;
  reference_amount?: number | string | null; paid_amount?: number | string | null; savings_amount?: number | string | null;
  reference_source?: string | null; evidence_note?: string | null; non_monetary_note?: string | null;
  radar_item_id?: string | null; drop_id?: string | null; trip_id?: string | null; occurred_on?: string | null; created_at?: string;
}
export interface ValueSummary {
  totals: Partial<Record<"comprobado" | "estimado" | "potencial", { currency: string; amount: number | string; count: number }[]>>;
  entries: ValueEntry[];
  organized_plans: number;
  radar: Record<RadarState, number>;
}
export interface ValueSplit {
  proven: { currency: string; amount: number; count: number }[];
  estimated: { currency: string; amount: number; count: number }[];
  potential: { currency: string; amount: number; count: number }[];
  potentialWithoutAmount: number;
  nonMonetary: ValueEntry[];
  organizedPlans: number;
  isEmpty: boolean;
}

/**
 * Separa el valor en cuatro cajas que NUNCA se suman entre sí ni entre monedas. Recalcula cada ahorro
 * como referencia − pagado (no confía en un "ahorro" escrito) y descarta lo que no cumple la regla de su tipo.
 */
export function splitValue(entries: ValueEntry[] | null | undefined, organizedPlans = 0): ValueSplit {
  const boxes: Record<"comprobado" | "estimado" | "potencial", Map<string, { amount: number; count: number }>> = {
    comprobado: new Map(), estimado: new Map(), potencial: new Map(),
  };
  const nonMonetary: ValueEntry[] = [];
  let potentialWithoutAmount = 0;
  for (const e of entries ?? []) {
    if (e.kind === "sin_ahorro") {
      if (asNum(e.reference_amount) === null && (e.non_monetary_note ?? "").trim().length >= 3) nonMonetary.push(e);
      continue;
    }
    if (!(e.kind in boxes)) continue;
    const ref = asNum(e.reference_amount), paid = asNum(e.paid_amount);
    const okSource = (e.reference_source ?? "").trim().length >= 3;
    if (ref === null || paid === null) {
      if (e.kind === "potencial" && (e.drop_id || e.radar_item_id)) potentialWithoutAmount += 1;
      continue;
    }
    if (!(ref > paid) || !e.currency || !okSource) continue;
    if (e.kind === "comprobado" && (e.evidence_note ?? "").trim().length < 3) continue;
    const m = boxes[e.kind];
    const cur = m.get(e.currency) ?? { amount: 0, count: 0 };
    m.set(e.currency, { amount: Math.round((cur.amount + (ref - paid)) * 100) / 100, count: cur.count + 1 });
  }
  const list = (m: Map<string, { amount: number; count: number }>) =>
    [...m.entries()].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => a.currency.localeCompare(b.currency));
  const split = {
    proven: list(boxes.comprobado), estimated: list(boxes.estimado), potential: list(boxes.potencial),
    potentialWithoutAmount, nonMonetary, organizedPlans: Math.max(0, organizedPlans | 0),
  };
  return { ...split, isEmpty: !split.proven.length && !split.estimated.length && !split.potential.length && !potentialWithoutAmount && !nonMonetary.length && !split.organizedPlans };
}

/** Validación del formulario (las mismas reglas que la base); null = se puede enviar. */
export function valueEntryError(e: Partial<ValueEntry>): string | null {
  if (!e.kind) return "kind";
  if (!e.title || e.title.trim().length < 2) return "title";
  const ref = asNum(e.reference_amount), paid = asNum(e.paid_amount);
  if (e.kind === "sin_ahorro") {
    if (ref !== null || paid !== null) return "no_amounts";
    return (e.non_monetary_note ?? "").trim().length >= 3 ? null : "non_monetary_note";
  }
  if ((ref === null) !== (paid === null)) return "amounts_pair";
  if (ref !== null && paid !== null) {
    if (!(ref > paid) || paid < 0) return "ref_gt_paid";
    if (!/^[A-Z]{3}$/.test(e.currency ?? "")) return "currency";
  }
  if (e.kind === "comprobado" || e.kind === "estimado") {
    if (ref === null) return "amounts_pair";
    if ((e.reference_source ?? "").trim().length < 3) return "reference_source";
  }
  if (e.kind === "comprobado" && (e.evidence_note ?? "").trim().length < 3) return "evidence_note";
  if (e.kind === "potencial") {
    if (!e.drop_id && !e.radar_item_id) return "link_required";
    if (ref !== null && (e.reference_source ?? "").trim().length < 3) return "reference_source";
  }
  return null;
}

// ───────────────────────────── THE INSIDER'S NOTEBOOK ─────────────────────────────
export type TipCategory = "cuando_viajar" | "donde_alojarse" | "reservar_antes" | "restaurantes" | "vestimenta" | "transporte"
  | "costumbres" | "seguridad" | "errores" | "temporada" | "itinerario" | "ocasiones" | "llegada" | "documentos";
export interface InsiderTip {
  id: string; slug: string; category: TipCategory;
  destination: { slug: string; es?: string | null; en?: string | null };
  title: Bilingual; body: Bilingual; before_you_go?: boolean; rank?: number;
  valid_until?: string | null; months?: number[] | null;
  source: { url: string; name: string; checked_at: string };
  stale?: boolean; saved?: boolean; added_to_trip?: string | null;
}
export interface MemberTrip { id: string; destino: string; fecha_salida?: string | null; fecha_regreso?: string | null; destination_slug?: string | null }
export interface InsiderIndex { destinations: { slug: string; es: string; en: string; tips: number; before_you_go: number; last_checked: string }[]; saved: number; trips: MemberTrip[] }
export interface InsiderPage { found: boolean; destination?: { slug: string; es: string; en: string }; tips?: InsiderTip[]; trips?: MemberTrip[] }
export interface BeforeYouGoData {
  trip: { id: string; destino: string; fecha_salida?: string | null; fecha_regreso?: string | null; days_until?: number | null } | null;
  destination?: { slug: string; es: string; en: string } | null;
  tips?: InsiderTip[];
}

/** Antes de llegar: se muestra destacado desde 30 días antes y mientras dura el viaje. */
export const BEFORE_YOU_GO_WINDOW_DAYS = 30;
export function beforeYouGoIsNear(b: BeforeYouGoData | null | undefined): boolean {
  const d = b?.trip?.days_until;
  return typeof d === "number" && d <= BEFORE_YOU_GO_WINDOW_DAYS && (d >= 0 || (b?.trip?.fecha_regreso ?? "") >= localToday());
}
/** Las cinco cosas: primero las marcadas, por rango; nunca más de cinco; nunca vencidas ni sin fuente. */
export function topFive(tips: InsiderTip[] | null | undefined, today: string = localToday()): InsiderTip[] {
  return (tips ?? [])
    .filter((t) => /^https:\/\//.test(t.source?.url ?? "") && t.source?.checked_at && (!t.valid_until || t.valid_until >= today) && !t.stale)
    .sort((a, b) => Number(!!b.before_you_go) - Number(!!a.before_you_go) || (a.rank ?? 50) - (b.rank ?? 50) || a.slug.localeCompare(b.slug))
    .slice(0, 5);
}
export function groupByCategory(tips: InsiderTip[]): [TipCategory, InsiderTip[]][] {
  const m = new Map<TipCategory, InsiderTip[]>();
  for (const t of [...tips].sort((a, b) => (a.rank ?? 50) - (b.rank ?? 50))) m.set(t.category, [...(m.get(t.category) ?? []), t]);
  return [...m.entries()];
}

// ───────────────────────────── THE PRIVÉ PASSPORT ─────────────────────────────
export type PassportKind = "visitado" | "experiencia" | "favorito" | "deseo" | "recuerdo";
export interface PassportEntry {
  id: string; kind: PassportKind; title: string; note?: string | null; place?: string | null; happened_on?: string | null;
  destination?: { slug: string; es: string; en: string; country?: string } | null; experience?: { slug: string; name: string } | null;
  trip_id?: string | null; created_at?: string;
}
export interface PassportMember {
  first_name?: string | null; member_code?: string | null; member_since?: string | null; tenure_days?: number | null;
  status?: string | null; founding_member?: boolean; founding_cutoff?: string | null;
}
export interface PassportData { member: PassportMember; stats: Record<PassportKind, number> & { countries: number }; entries: PassportEntry[] }

/** Antigüedad legible sin redondeos engañosos ("4 meses", no "medio año"). */
export function tenureParts(days: number | null | undefined): { years: number; months: number; days: number } | null {
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) return null;
  const years = Math.floor(days / 365);
  const rest = days - years * 365;
  const months = Math.floor(rest / 30);
  return { years, months, days: rest - months * 30 };
}
/** Founding Member solo si el servidor lo afirma con una fecha de corte explícita. */
export const isFoundingMember = (m: PassportMember | null | undefined): boolean => m?.founding_member === true && !!m?.founding_cutoff;

export function passportEntryError(e: Partial<PassportEntry> & { destination_text?: string }, today: string = localToday()): string | null {
  if (!e.kind) return "kind";
  if (!e.title || e.title.trim().length < 2) return "title";
  if (!(e.place?.trim() || e.destination_text?.trim() || e.destination)) return "place";
  if (e.happened_on && e.kind !== "deseo" && e.happened_on > today) return "future";
  if (/[0-9]{13,19}/.test(`${e.title} ${e.note ?? ""} ${e.place ?? ""}`.replace(/[\s.-]/g, ""))) return "card_number";
  return null;
}

/** Pocos destinos de regiones distintas (no una lista interminable). */
export function pickVaried<T extends { region_group?: string }>(list: T[], n: number): T[] {
  const byRegion = new Map<string, T[]>();
  for (const d of list) byRegion.set(d.region_group ?? "otras", [...(byRegion.get(d.region_group ?? "otras") ?? []), d]);
  const out: T[] = [];
  for (let i = 0; out.length < n && i < 20; i++) {
    for (const arr of byRegion.values()) { if (arr[i] && out.length < n) out.push(arr[i]); }
  }
  return out;
}
