// booking-links-cron — tareas periódicas del Booking Bridge (verify_jwt = false; CRON_SECRET):
//  1) vence intenciones viejas (booking_intents_expire);
//  2) registra los enlaces oficiales del catálogo Privé en booking_link_checks y revisa los vencidos
//     con control de tasa (linkcheck.ts). Los hallazgos del sitio oficial (botón de reservas,
//     WhatsApp, correo, teléfono) quedan con fecha y procedencia para el resolver.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { sha256Hex } from "../_shared/serpCache.ts";
import { checkOne, type DueLink, pickBatch } from "./linkcheck.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return new Response(JSON.stringify({ ok: false }), { status: 401 });
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const out: Record<string, unknown> = {};
  const { data: expired, error: expErr } = await db.rpc("booking_intents_expire");
  out.expired = expErr ? `error: ${expErr.message}` : expired;

  // Alta de enlaces del catálogo (idempotente por url_hash).
  const { data: rows } = await db.from("prive_experiences").select("slug, name, website, booking_url").eq("active", true).limit(2000);
  const seed: Record<string, unknown>[] = [];
  for (const r of (rows as any[]) ?? []) {
    for (const [url, kind] of [[r.booking_url, "reservation_page"], [r.website, "official_site"]] as const) {
      if (typeof url !== "string" || !url.startsWith("https://")) continue;
      seed.push({ url_hash: await sha256Hex(url), url, host: new URL(url).hostname, kind, subject: r.slug, source: "prive_catalog" });
    }
  }
  for (let i = 0; i < seed.length; i += 500) {
    await db.from("booking_link_checks").upsert(seed.slice(i, i + 500), { onConflict: "url_hash", ignoreDuplicates: true });
  }

  const { data: due } = await db.from("booking_link_checks").select("id, url, host, kind")
    .or(`expires_at.is.null,expires_at.lt.${new Date().toISOString()}`).order("expires_at", { ascending: true, nullsFirst: true }).limit(200);
  const batch = pickBatch((due as DueLink[]) ?? [], Number(Deno.env.get("BOOKING_LINKS_PER_RUN") ?? 20));
  const results: Record<string, number> = {};
  for (const link of batch) {
    const v = await checkOne(link, fetch);
    results[v.status] = (results[v.status] ?? 0) + 1;
    const { data: cur } = await db.from("booking_link_checks").select("check_count").eq("id", v.id).maybeSingle();
    await db.from("booking_link_checks").update({
      status: v.status, http_status: v.http_status, final_host: v.final_host, findings: v.findings, checked_at: v.checked_at,
      expires_at: v.expires_at, last_error: v.error, check_count: ((cur as any)?.check_count ?? 0) + 1,
    }).eq("id", v.id);
  }
  out.checked = results;
  out.seeded = seed.length;
  return new Response(JSON.stringify({ ok: true, ...out }), { headers: { "Content-Type": "application/json" } });
});
