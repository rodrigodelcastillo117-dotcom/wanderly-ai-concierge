// health-check — revisa una vez al día que los servicios externos respondan y que las tareas
// programadas corran, guarda el resultado (lo muestra el panel de administración) y avisa por
// correo solo cuando cambia lo que falla (o una vez por semana si sigue igual). Lo dispara pg_cron
// (docs/ops/programar-tareas.sql). Las decisiones viven en checks.ts y alerts.ts (probadas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { layout, sendEmail } from "../_shared/email.ts";
import { redactSecrets } from "../_shared/redact.ts";
import { allOk, runChecks } from "./checks.ts";
import { probeGoogleApis } from "./googleProbe.ts";
import { probeStripeConfig } from "./stripeProbe.ts";
import { probeTicketmaster } from "../_shared/ticketmaster.ts";
import { probeTripadvisor } from "../_shared/tripadvisor-terra.ts";
import { probeTravelAdvisories } from "../_shared/travelAdvisories.ts";
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { alertEmail, alertRecipients, emailOutcome, jobHealth, shouldEmail, type CronHealth, type PreviousRun } from "./alerts.ts";
import { retryOpsEmails } from "../_shared/ops-desk.ts";
import { teamEmails } from "../_shared/teamEmails.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);

  // Diagnóstico bajo demanda: ¿qué APIs de Google Maps Platform responden con la llave del
  // servidor? (habilitada / deshabilitada / cuota / llave rechazada). No guarda nada ni manda correo.
  //   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=google_apis" -H "x-cron-secret: $CRON_SECRET"
  if (new URL(req.url).searchParams.get("action") === "google_apis") {
    return json(await probeGoogleApis(googleTransportFor("health-check", null)));
  }

  // Diagnóstico bajo demanda de Stripe para vender PRO (AUD-08): precio $99 MXN/mes IVA incluido,
  // eventos y versión del webhook, portal y Stripe Tax. Solo lectura; no guarda ni manda correo.
  //   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=stripe_config" -H "x-cron-secret: $CRON_SECRET"
  if (new URL(req.url).searchParams.get("action") === "stripe_config") {
    return json(await probeStripeConfig({ stripeKey: Deno.env.get("STRIPE_SECRET_KEY"), priceId: Deno.env.get("STRIPE_PRICE_ID") }));
  }

  // Diagnóstico bajo demanda de Ticketmaster Discovery API v2: UNA llamada mínima (Ciudad de México,
  // size=1). Responde si la llave existe, el estado HTTP y cuántos eventos hubo; nunca la llave ni la URL.
  //   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=ticketmaster" -H "x-cron-secret: $CRON_SECRET"
  if (new URL(req.url).searchParams.get("action") === "ticketmaster") {
    return json(await probeTicketmaster({ fetchImpl: fetch, apiKey: Deno.env.get("TICKETMASTER_API_KEY") }));
  }

  // Diagnóstico bajo demanda de Tripadvisor Terra: UNA búsqueda mínima (size=1) con una consulta que
  // no coincide con nada, así que no devuelve location IDs y no cobra entidades; prueba la llave
  // (401) y el permiso del endpoint (403). Con &muestra=1 busca un lugar real (máximo 1 entidad; si la
  // allowlist lo esconde, 1 más en el catálogo). Nunca responde la llave ni la URL.
  //   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=tripadvisor" -H "x-cron-secret: $CRON_SECRET"
  if (new URL(req.url).searchParams.get("action") === "tripadvisor") {
    const muestra = new URL(req.url).searchParams.get("muestra") === "1";
    return json(await probeTripadvisor({ fetchImpl: fetch, apiKey: Deno.env.get("TRIPADVISOR_API_KEY"), muestra }));
  }

  // Diagnóstico bajo demanda de los avisos de viaje oficiales (tarjeta "Antes de viajar"): descarga el
  // índice de GOV.UK y la lista del State Dept y cuenta países/avisos. Sin IA, sin caché, sin llaves.
  //   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=avisos" -H "x-cron-secret: $CRON_SECRET"
  if (new URL(req.url).searchParams.get("action") === "avisos") {
    return json(await probeTravelAdvisories({ fetchImpl: fetch }));
  }

  const env = (k: string) => Deno.env.get(k) ?? undefined;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Mesa de operaciones: reintenta los correos que no salieron (aviso al dueño de una solicitud nueva y
  // respuestas del equipo a usuarios). Corre en la revisión diaria; para reintentar más seguido se puede
  // programar SOLO esta acción (docs/ops/LEEME.md, "Mesa de operaciones"; no está programada):
  //   curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=ops_correos" -H "x-cron-secret: $CRON_SECRET"
  const opsRetry = () => retryOpsEmails({
    rpc: (fn, args) => db.rpc(fn, args),
    send: (m) => sendEmail(m),
    siteUrl: env("SITE_URL") ?? null,
    ownerEmail: teamEmails(),
    ownerFrom: env("FIXER_FROM_ADDRESS") || "IATOS Fixer <hola@traveliatos.life>",
    replyFrom: env("OPS_REPLY_FROM") || "IATOS <hola@traveliatos.life>",
    replyTo: teamEmails()[0],
    supportEmail: env("SUPPORT_EMAIL") ?? null,
  }).catch((e) => ({ error: redactSecrets((e as Error)?.message ?? String(e)) }));
  if (new URL(req.url).searchParams.get("action") === "ops_correos") return json(await opsRetry());
  const ops = await opsRetry();
  // Ritmo real de búsquedas de SerpApi (promedio de 7 días en ai_usage_log). Si la migración no está
  // o no hay historial, el chequeo usa el umbral fijo.
  const { data: burn, error: burnErr } = await db.rpc("serp_burn_rate", { _days: 7 });
  if (burnErr) console.warn("health-check: serp_burn_rate", redactSecrets(burnErr.message));
  const serpPerDay = Number((burn as { avg_per_day?: unknown } | null)?.avg_per_day);

  const results = await runChecks({
    serpPerDay: Number.isFinite(serpPerDay) && serpPerDay > 0 ? serpPerDay : null,
    geminiKey: env("GEMINI_API_KEY"),
    lovableKey: env("LOVABLE_API_KEY"),
    anthropicKey: env("ANTHROPIC_API_KEY"),
    anthropicModel: env("ANTHROPIC_MODEL"),
    serpKey: env("SERPAPI_PRIVATE_KEY"),
    travelpayoutsToken: env("TRAVELPAYOUTS_TOKEN"),
    stripeKey: env("STRIPE_SECRET_KEY"),
  });

  const dbCheck = await (async () => {
    const t0 = Date.now();
    const { error } = await db.from("trips").select("id", { count: "exact", head: true });
    return { name: "Base de datos", ok: !error, detail: redactSecrets(error?.message), ms: Date.now() - t0 };
  })();
  results.push(dbCheck);

  // ¿Las tareas programadas corren y sus llamadas responden bien?
  const t0 = Date.now();
  const { data: cron, error: cronErr } = await db.rpc("cron_health");
  results.push({ ...jobHealth((cron as CronHealth | null) ?? null, cronErr?.message ?? null, new Date()), ms: Date.now() - t0 });

  const ok = allOk(results);
  let { data: row, error: insertErr } = await db.from("health_checks")
    .insert({ ok, results, email_status: "pending" }).select("id, ran_at").single();
  if (insertErr) {
    // Si la función se publica antes que la migración (sin columna email_status), guarda igual.
    ({ data: row, error: insertErr } = await db.from("health_checks").insert({ ok, results }).select("id, ran_at").single());
    if (insertErr) console.error("health-check: no se pudo guardar", redactSecrets(insertErr.message));
  }

  const { data: prevRows } = await db.from("health_checks")
    .select("ran_at, results, email_status")
    .lt("ran_at", row?.ran_at ?? new Date().toISOString())
    .order("ran_at", { ascending: false })
    .limit(30);
  const decision = shouldEmail(results, (prevRows ?? []) as PreviousRun[], new Date());

  let emailStatus: string = decision.send ? "pending" : decision.status;
  let emailError: string | null = null;
  if (decision.send) {
    const adminEmails: string[] = [];
    if (!env("HEALTH_ALERT_EMAIL")) {
      const { data: admins } = await db.from("admins").select("user_id");
      for (const a of admins ?? []) {
        const { data } = await db.auth.admin.getUserById(a.user_id);
        if (data?.user?.email) adminEmails.push(data.user.email);
      }
    }
    const to = alertRecipients(env("HEALTH_ALERT_EMAIL"), adminEmails);
    const { subject, html } = alertEmail(results, decision.reason);
    // Un correo por destinatario: si Resend rechaza a uno (dominio sin verificar), los demás llegan.
    const sends: { ok: boolean; error?: string }[] = [];
    for (const address of to) sends.push(await sendEmail({ to: address, subject, html: layout(subject, html) }));
    const outcome = emailOutcome(sends);
    emailStatus = outcome.status;
    emailError = outcome.error;
    if (outcome.status !== "sent") console.error("health-check: correo de alerta", outcome.status, emailError ?? "");
  }

  if (row?.id != null) {
    const { error: updErr } = await db.from("health_checks").update({ email_status: emailStatus, email_error: emailError }).eq("id", row.id);
    if (updErr) console.error("health-check: no se pudo guardar el resultado del correo", redactSecrets(updErr.message));
  }

  return json({ ok, email_status: emailStatus, email_error: emailError, results, ops });
});
