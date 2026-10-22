// Reglas de curaduría de privevalor (Privé Drops e Insider's Notebook). Espejo en JS de lo que la base
// impone (supabase/migrations/20261024100000_privevalor_drops.sql y 20261024100200_privevalor_insider.sql)
// para dar el reporte ANTES de tocar una base. La base sigue siendo la autoridad.

export const DROP_TYPES = ["promocion_publica", "tarifa_publicada", "beneficio_lealtad", "beneficio_tarjeta", "oferta_temporal", "beneficio_iatos", "editorial"];
export const TIP_CATEGORIES = ["cuando_viajar", "donde_alojarse", "reservar_antes", "restaurantes", "vestimenta", "transporte", "costumbres",
  "seguridad", "errores", "temporada", "itinerario", "ocasiones", "llegada", "documentos"];

const https = (u) => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);
const isoDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const text = (v, min, max) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

export const norm = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
export const hasPercent = (t) => /[0-9]\s*(%|por ciento|percent)/i.test(String(t ?? ""));
export const hasFakeUrgency = (t) => /(solo|unicamente) quedan|quedan pocos|ultim[oa]s? (lugares|habitaciones|boletos|asientos|oportunidad|horas)|se (agota|acaba)|agotandose|date prisa|apresurate|no te lo pierdas|only [0-9]+ left|last chance|hurry|selling fast|almost gone|ends tonight/.test(norm(t));
export const hasCardNumber = (t) => /[0-9]{13,19}/.test(String(t ?? "").replace(/[\s.-]/g, ""));

const dropText = (r) => [r.title_es, r.title_en, r.benefit_es, r.benefit_en, r.conditions_es, r.conditions_en, r.eligibility_es,
  r.eligibility_en, r.restrictions_es, r.restrictions_en].filter(Boolean).join(" ");

/** Motivos por los que un Drop no se puede publicar ([] = válido). */
export function dropProblems(r, { today } = {}) {
  const p = [];
  if (!r || typeof r !== "object") return ["la fila no es un objeto"];
  if (!/^[a-z0-9-]{3,80}$/.test(r.slug ?? "")) p.push("slug inválido");
  if (!DROP_TYPES.includes(r.type)) p.push(`tipo desconocido: ${r.type}`);
  if (r.type === "beneficio_iatos" || r.commercial_relationship === "convenio") p.push("el cargador no crea beneficios IATOS (registro de alianzas)");
  if (!text(r.title_es, 3, 120)) p.push("title_es (3–120)");
  if (!text(r.provider_name, 2, 120)) p.push("provider_name");
  if (!text(r.benefit_es, 3, 400)) p.push("benefit_es (3–400)");
  if (r.type !== "editorial" && (!text(r.conditions_es, 1, 900) || !text(r.eligibility_es, 1, 400))) p.push("condiciones y elegibilidad son obligatorias");
  if (!https(r.source_url)) p.push("source_url https");
  if (!https(r.link_url)) p.push("link_url https");
  if (r.provider_url && !https(r.provider_url)) p.push("provider_url https");
  if (!r.last_verified_at || Number.isNaN(Date.parse(r.last_verified_at))) p.push("last_verified_at");
  if (!text(r.verified_by, 2, 80)) p.push("verified_by");
  for (const k of ["valid_from", "valid_until"]) if (r[k] != null && !isoDate(r[k])) p.push(`${k} no es AAAA-MM-DD`);
  if (r.valid_from && r.valid_until && r.valid_until < r.valid_from) p.push("valid_until antes de valid_from");
  if (today && r.valid_until && r.valid_until < today) p.push(`vencido el ${r.valid_until}`);
  const hasPrice = r.offer_price != null || r.reference_price != null;
  if (hasPrice && (!/^[A-Z]{3}$/.test(r.price_currency ?? "") || !https(r.price_source_url))) p.push("un precio necesita moneda y fuente");
  if (r.reference_price != null && r.offer_price == null) p.push("precio de referencia sin precio actual");
  if (r.discount_pct != null) {
    const ok = r.reference_price > 0 && r.offer_price != null && r.offer_price < r.reference_price
      && Math.abs(Math.round((10000 * (r.reference_price - r.offer_price)) / r.reference_price) / 100 - r.discount_pct) <= 0.5;
    if (!ok) p.push("el porcentaje no tiene comparación verificable o no cuadra");
  } else if (hasPercent(dropText(r))) p.push("porcentaje en el texto sin comparación verificable");
  if (hasFakeUrgency(dropText(r))) p.push("escasez o urgencia falsa");
  if (hasCardNumber(dropText(r))) p.push("número de tarjeta en el texto");
  if (r.type === "beneficio_tarjeta" && !(Array.isArray(r.program_match) && r.program_match.length)) p.push("beneficio de tarjeta sin tarjeta(s)");
  return p;
}

/** Motivos por los que un consejo del Insider's Notebook no se puede publicar. */
export function tipProblems(r, { today } = {}) {
  const p = [];
  if (!r || typeof r !== "object") return ["la fila no es un objeto"];
  if (!/^[a-z0-9-]{3,80}$/.test(r.slug ?? "")) p.push("slug inválido");
  if (!r.destination_slug) p.push("destination_slug");
  if (!TIP_CATEGORIES.includes(r.category)) p.push(`categoría desconocida: ${r.category}`);
  if (!text(r.title_es, 3, 120)) p.push("title_es (3–120)");
  if (!text(r.body_es, 10, 700)) p.push("body_es (10–700)");
  if (r.body_en != null && !text(r.body_en, 10, 700)) p.push("body_en (10–700)");
  if (!https(r.source_url)) p.push("source_url https");
  if (!text(r.source_name, 2, 160)) p.push("source_name");
  if (!isoDate(r.source_checked_at)) p.push("source_checked_at AAAA-MM-DD");
  if (today && r.source_checked_at > today) p.push("source_checked_at en el futuro");
  if (!text(r.verified_by, 2, 80)) p.push("verified_by");
  if (r.valid_until != null && !isoDate(r.valid_until)) p.push("valid_until AAAA-MM-DD");
  if (today && r.valid_until && r.valid_until < today) p.push(`vencido el ${r.valid_until}`);
  if (r.months != null && !(Array.isArray(r.months) && r.months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12))) p.push("months 1–12");
  return p;
}

export function validateBatch(rows, check, opts) {
  const accepted = [], rejected = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const problems = check(r, opts);
    if (r?.slug && seen.has(r.slug)) problems.push("slug duplicado en el lote");
    if (r?.slug) seen.add(r.slug);
    (problems.length ? rejected : accepted).push(problems.length ? { slug: r?.slug ?? null, problems } : r);
  }
  return { accepted, rejected };
}

const sqlLiteral = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** Sentencia SQL que llama al importador con dollar-quoting seguro. */
export function importSql(fn, rows, batch, dryRun) {
  const json = JSON.stringify(rows, null, 1);
  let tag = "pv";
  while (json.includes(`$${tag}$`)) tag += "x";
  return `SELECT public.${fn}($${tag}$${json}$${tag}$::jsonb, ${sqlLiteral(batch)}, ${dryRun ? "true" : "false"});\n`;
}
