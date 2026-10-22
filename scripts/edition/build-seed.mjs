#!/usr/bin/env node
// THE PRIVATE EDITION · genera la migración de siembra de un número a partir de su JSON editorial
// (data/prive/edition/issue-NN.json): fuentes, imágenes, número, artículos y enlaces artículo↔fuente.
//
// Reglas que el generador hace cumplir antes de escribir SQL (si algo falla, no escribe nada):
//  · todo artículo no-carta cita al menos una fuente registrada; lo sensible, dos;
//  · toda imagen usada existe en el registro, con licencia, enlace de licencia, autor y página;
//  · todo breve tiene fecha del hecho; toda fuente tiene URL https y fecha de consulta;
//  · los enlaces oficiales de "From Page to Experience" van a un dominio de una fuente del artículo;
//  · los intereses pertenecen a la lista cerrada del dueño.
// TODO nace en pending_review (artículos y número) y las imágenes con licencia "pending": nada se publica
// hasta que el responsable editorial lo apruebe en el panel. La siembra es idempotente (ON CONFLICT DO
// NOTHING): re-aplicarla nunca pisa el trabajo del editor.
//
// Uso: node scripts/edition/build-seed.mjs data/prive/edition/issue-01.json supabase/migrations/20261025100200_edition_seed_n01.sql
import { readFileSync, writeFileSync } from "node:fs";

export const INTEREST_KEYS = ["viajes_internacionales", "hoteles_y_villas", "yates_y_embarcaciones", "aviacion_privada", "superautos", "relojes",
  "moda", "belleza", "joyeria", "arquitectura_y_diseno", "gastronomia", "deportes", "formula_1", "golf", "finanzas_y_mercados",
  "negocios", "inteligencia_artificial", "tecnologia", "arte", "cultura", "bienestar", "eventos_internacionales",
  "noticias_mundiales", "mexico", "experiencias_extraordinarias"];

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

export function validateIssue(doc) {
  const errors = [];
  const sources = new Map(doc.sources.map((s) => [s.key, s]));
  const images = new Map(doc.images.map((i) => [i.key, i]));
  for (const s of doc.sources) {
    if (!/^https:\/\/\S+$/.test(s.url)) errors.push(`fuente ${s.key}: URL no https`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.consulted_at)) errors.push(`fuente ${s.key}: sin fecha de consulta`);
    for (const f of ["entity", "title", "data_used", "reuse_rights", "attribution", "verification", "kind"]) if (!s[f]) errors.push(`fuente ${s.key}: falta ${f}`);
  }
  for (const i of doc.images) {
    for (const f of ["license", "license_url", "photographer", "page_url", "url"]) if (!i[f]) errors.push(`imagen ${i.key}: falta ${f}`);
    if (!i.depicts?.es || !i.alt?.es) errors.push(`imagen ${i.key}: falta qué representa o texto alternativo`);
    if (typeof i.illustrative !== "boolean") errors.push(`imagen ${i.key}: ¿ilustrativa?`);
  }
  if (!images.has(doc.issue.cover_image)) errors.push("portada: imagen inexistente");
  const slugs = new Set();
  for (const a of doc.articles) {
    if (slugs.has(a.slug)) errors.push(`artículo ${a.slug}: duplicado`);
    slugs.add(a.slug);
    for (const t of a.topics) if (!INTEREST_KEYS.includes(t)) errors.push(`artículo ${a.slug}: interés desconocido ${t}`);
    if (a.format !== "letter" && a.sources.length === 0) errors.push(`artículo ${a.slug}: sin fuentes`);
    if (a.sensitive && a.sources.length < 2) errors.push(`artículo ${a.slug}: sensible con menos de 2 fuentes`);
    for (const s of a.sources) if (!sources.has(s.key)) errors.push(`artículo ${a.slug}: fuente no registrada ${s.key}`);
    if (a.format === "brief" && !a.fact_date) errors.push(`artículo ${a.slug}: breve sin fecha`);
    const used = [a.hero_image, ...a.body.filter((b) => b.t === "img").map((b) => b.image)].filter(Boolean);
    for (const k of used) if (!images.has(k)) errors.push(`artículo ${a.slug}: imagen no registrada ${k}`);
    const hosts = new Set(a.sources.map((s) => host(sources.get(s.key)?.url)).filter(Boolean));
    for (const act of a.actions) {
      if (act.kind === "official_link" && !hosts.has(host(act.url))) errors.push(`artículo ${a.slug}: enlace oficial sin fuente (${act.url})`);
    }
    for (const b of a.body) if (b.t === "agenda") for (const it of b.items) if (!sources.has(it.source)) errors.push(`agenda ${a.slug}: fuente ${it.source}`);
  }
  if (!slugs.has(doc.issue.cover_article)) errors.push("portada: artículo de portada inexistente");
  return errors;
}

// Texto SQL con dollar-quoting (nunca concatenación de comillas).
const TAG = "$edi$";
const q = (v) => {
  if (v === null || v === undefined) return "NULL";
  const s = String(v);
  if (s.includes(TAG)) throw new Error("el texto contiene el delimitador $edi$");
  return `${TAG}${s}${TAG}`;
};
const qj = (v) => `${q(JSON.stringify(v ?? null))}::jsonb`;
const qd = (v) => (v ? `${q(v)}::date` : "NULL");
const qa = (arr) => `ARRAY[${(arr ?? []).map(q).join(", ")}]::text[]`;

export function buildSeedSql(doc, file = "data/prive/edition/issue-01.json") {
  const errors = validateIssue(doc);
  if (errors.length) throw new Error("El número no cumple las reglas:\n  " + errors.join("\n  "));
  const L = [];
  L.push(`-- IATOS Privé · THE PRIVATE EDITION (equipo edition) · 3/3 · siembra del número ${doc.issue.number} (${doc.issue.period_label.es}).`);
  L.push(`-- GENERADO por scripts/edition/build-seed.mjs desde ${file}. No editar a mano: editar el JSON y regenerar.`);
  L.push(`-- Textos originales redactados con asistencia de IA (Claude) a partir de las fuentes registradas, con investigación cerrada el`);
  L.push(`-- ${doc.issue.research_closed_at}. TODO nace en pending_review / licencia pending: nada se ve hasta que el editor lo apruebe.`);
  L.push(`-- Idempotente: ON CONFLICT DO NOTHING (re-aplicarla no pisa el trabajo del editor).`);
  L.push("");
  L.push("-- Fuentes");
  for (const s of doc.sources) {
    L.push(`INSERT INTO public.edition_sources (key, kind, entity, author, title, url, published_at, consulted_at, data_used, reuse_rights, attribution, distribution_restrictions, verification)`);
    L.push(`VALUES (${q(s.key)}, ${q(s.kind)}, ${q(s.entity)}, ${q(s.author)}, ${q(s.title)}, ${q(s.url)}, ${qd(s.published_at)}, ${qd(s.consulted_at)}, ${q(s.data_used)}, ${q(s.reuse_rights)}, ${q(s.attribution)}, ${q(s.distribution_restrictions)}, ${q(s.verification)})`);
    L.push(`ON CONFLICT (key) DO NOTHING;`);
  }
  L.push("");
  L.push("-- Imágenes (licencia pendiente de aprobación editorial)");
  for (const i of doc.images) {
    L.push(`INSERT INTO public.edition_images (key, provider, provider_id, url, page_url, photographer, photographer_url, license, license_url, illustrative, depicts_es, depicts_en, alt_es, alt_en, focal, allow_pdf, allow_offline, verification, license_status)`);
    L.push(`VALUES (${q(i.key)}, ${q(i.provider)}, ${q(i.provider_id)}, ${q(i.url)}, ${q(i.page_url)}, ${q(i.photographer)}, ${q(i.photographer_url)}, ${q(i.license)}, ${q(i.license_url)}, ${i.illustrative}, ${q(i.depicts.es)}, ${q(i.depicts.en)}, ${q(i.alt.es)}, ${q(i.alt.en)}, ${q(i.focal)}, ${!!i.allow_pdf}, ${!!i.allow_offline}, ${q(i.verification)}, 'pending')`);
    L.push(`ON CONFLICT (key) DO NOTHING;`);
  }
  L.push("");
  const is = doc.issue;
  L.push("-- Número");
  L.push(`INSERT INTO public.edition_issues (slug, number, period_start, period_label, title, cover_line, cover_image_id, cover_article_slug, research_closed_at, plan, status)`);
  L.push(`VALUES (${q(is.slug)}, ${is.number}, ${qd(is.period_start)}, ${qj(is.period_label)}, ${qj(is.title)}, ${qj(is.cover_line)}, (SELECT id FROM public.edition_images WHERE key = ${q(is.cover_image)}), ${q(is.cover_article)}, ${qd(is.research_closed_at)}, ${qj(is.plan)}, 'pending_review')`);
  L.push(`ON CONFLICT (slug) DO NOTHING;`);
  L.push("");
  L.push("-- Artículos (borradores asistidos por IA, pendientes de revisión)");
  doc.articles.forEach((a, idx) => {
    L.push(`INSERT INTO public.edition_articles (issue_id, slug, section, format, topics, kicker, title, dek, byline, hero_image_id, fact_status, sensitive, fact_date, valid_until, destinations, body, actions, sort_order, drafted_by, status)`);
    L.push(`VALUES ((SELECT id FROM public.edition_issues WHERE slug = ${q(is.slug)}), ${q(a.slug)}, ${q(a.section)}, ${q(a.format)}, ${qa(a.topics)}, ${qj(a.kicker)}, ${qj(a.title)}, ${qj(a.dek)}, ${qj(a.byline)}, ${a.hero_image ? `(SELECT id FROM public.edition_images WHERE key = ${q(a.hero_image)})` : "NULL"}, ${q(a.fact_status)}, ${!!a.sensitive}, ${qd(a.fact_date)}, ${qd(a.valid_until)}, ${qa(a.destinations)}, ${qj(a.body)}, ${qj(a.actions)}, ${(idx + 1) * 10}, 'claude', 'pending_review')`);
    L.push(`ON CONFLICT (slug) DO NOTHING;`);
    for (const s of a.sources) {
      L.push(`INSERT INTO public.edition_article_sources (article_id, source_id, used_for) SELECT a.id, s.id, ${q(s.used_for)} FROM public.edition_articles a, public.edition_sources s WHERE a.slug = ${q(a.slug)} AND s.key = ${q(s.key)} ON CONFLICT DO NOTHING;`);
    }
  });
  L.push("");
  L.push("-- Tiempo de lectura (mismo cálculo que el panel: 220 palabras por minuto)");
  L.push(`UPDATE public.edition_articles SET word_count = public.edition_body_words(body), reading_minutes = greatest(1, ceil(public.edition_body_words(body) / 220.0)::int)`);
  L.push(`WHERE issue_id = (SELECT id FROM public.edition_issues WHERE slug = ${q(is.slug)}) AND word_count = 0;`);
  L.push("");
  L.push("-- Bitácora: una fila 'seed' por pieza (solo la primera vez)");
  L.push(`INSERT INTO public.edition_reviews (entity, entity_key, action, note)`);
  L.push(`SELECT 'article', a.slug, 'seed', 'Borrador asistido por IA (Claude) a partir de fuentes registradas; pendiente de revisión editorial.'`);
  L.push(`  FROM public.edition_articles a WHERE a.issue_id = (SELECT id FROM public.edition_issues WHERE slug = ${q(is.slug)})`);
  L.push(`   AND NOT EXISTS (SELECT 1 FROM public.edition_reviews r WHERE r.entity = 'article' AND r.entity_key = a.slug AND r.action = 'seed');`);
  L.push(`INSERT INTO public.edition_reviews (entity, entity_key, action, note)`);
  L.push(`SELECT 'issue', ${q(is.slug)}, 'seed', 'Número sembrado en pending_review.' WHERE NOT EXISTS (SELECT 1 FROM public.edition_reviews r WHERE r.entity = 'issue' AND r.entity_key = ${q(is.slug)} AND r.action = 'seed');`);
  L.push("");
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , input = "data/prive/edition/issue-01.json", output = "supabase/migrations/20261025100200_edition_seed_n01.sql"] = process.argv;
  const doc = JSON.parse(readFileSync(input, "utf8"));
  const sql = buildSeedSql(doc, input);
  writeFileSync(output, sql);
  console.log(`OK ${output}: ${doc.sources.length} fuentes, ${doc.images.length} imágenes, ${doc.articles.length} artículos`);
}
