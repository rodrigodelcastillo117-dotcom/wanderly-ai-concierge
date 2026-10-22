// health-check — revisa una vez al día que los servicios externos respondan y que las tareas
// programadas corran, guarda el resultado (lo muestra el panel de administración) y avisa por
// correo solo cuando cambia lo que falla (o una vez por semana si sigue igual). Lo dispara pg_cron
// (docs/ops/programar-tareas.sql). Las decisiones viven en checks.ts y alerts.ts (probadas).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { layout, sendEmail } from "../_shared/email.ts";
import { redactSecrets } from "../_shared/redact.ts";
import { allOk, runChecks } from "./checks.ts";
import { alertEmail, alertRecipients, emailOutcome, jobHealth, shouldEmail, type CronHealth, type PreviousRun } from "./alerts.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);

  const env = (k: string) => Deno.env.get(k) ?? undefined;
  const results = await runChecks({
    geminiKey: env("GEMINI_API_KEY"),
    lovableKey: env("LOVABLE_API_KEY"),
    anthropicKey: env("ANTHROPIC_API_KEY"),
    anthropicModel: env("ANTHROPIC_MODEL"),
    serpKey: env("SERPAPI_PRIVATE_KEY"),
    travelpayoutsToken: env("TRAVELPAYOUTS_TOKEN"),
    stripeKey: env("STRIPE_SECRET_KEY"),
  });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
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

  return json({ ok, email_status: emailStatus, email_error: emailError, results });
});
