// health-check — revisa una vez al día que los servicios externos respondan, guarda el
// resultado (lo muestra el panel de administración) y avisa por correo a los administradores
// si algo falla o necesita atención. Lo dispara pg_cron (docs/ops/programar-tareas.sql).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { layout, sendEmail } from "../_shared/email.ts";
import { allOk, needsAttention, runChecks } from "./checks.ts";

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
    return { name: "Base de datos", ok: !error, detail: error?.message, ms: Date.now() - t0 };
  })();
  results.push(dbCheck);

  const ok = allOk(results);
  const { error: insertErr } = await db.from("health_checks").insert({ ok, results });
  if (insertErr) console.error("health-check: no se pudo guardar", insertErr.message);

  let emailed = false;
  if (needsAttention(results)) {
    const { data: admins } = await db.from("admins").select("user_id");
    const emails: string[] = [];
    for (const a of admins ?? []) {
      const { data } = await db.auth.admin.getUserById(a.user_id);
      if (data?.user?.email) emails.push(data.user.email);
    }
    if (emails.length) {
      const rows = results
        .filter((r) => !r.ok || r.warn)
        .map((r) => `<li><strong>${r.name}:</strong> ${r.ok ? r.warn : `falla — ${r.detail ?? "sin detalle"}`}</li>`)
        .join("");
      const subject = ok ? "IATOS: hay algo que atender" : "IATOS: un servicio está fallando";
      const res = await sendEmail({
        to: emails,
        subject,
        html: layout(subject, `<p>El chequeo diario encontró lo siguiente:</p><ul>${rows}</ul><p>El detalle está en Perfil → Panel de métricas.</p>`),
      });
      emailed = res.ok;
    }
  }

  return json({ ok, emailed, results });
});
