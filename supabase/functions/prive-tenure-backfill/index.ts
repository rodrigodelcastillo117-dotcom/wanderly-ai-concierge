// prive-tenure-backfill — respaldo único de la antigüedad PAGADA de cuentas que pagaron antes de que
// existiera pro_paid_periods. Protegida con el secreto de cron (verify_jwt = false + isAuthorizedCron).
// dry_run=true por defecto: para escribir hay que mandar {"dry_run": false} (requiere GO del dueño
// en producción). Solo LEE de Stripe. La lógica vive en backfill.ts (probada).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import type { StripePaidInvoiceLike } from "../_shared/prive-tenure.ts";
import { type BackfillCustomer, parseBackfillBody, runBackfill } from "./backfill.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!stripeKey) return json({ error: "stripe_not_configured" }, 503);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const opts = parseBackfillBody(await req.json().catch(() => ({})));
  try {
    const summary = await runBackfill(opts, {
      listCustomers: (offset, limit) =>
        db.from("subscriptions").select("user_id, stripe_customer_id").not("stripe_customer_id", "is", null)
          .order("user_id").range(offset, offset + limit - 1) as unknown as PromiseLike<{ data: BackfillCustomer[] | null; error: { message: string } | null }>,
      listPaidInvoices: async (customer, after) => {
        const qs = new URLSearchParams({ customer, status: "paid", limit: "100" });
        if (after) qs.set("starting_after", after);
        const res = await fetch(`https://api.stripe.com/v1/invoices?${qs}`, { headers: { Authorization: `Bearer ${stripeKey}` } });
        if (!res.ok) throw new Error(`stripe_${res.status}`);
        const j = await res.json() as { data?: StripePaidInvoiceLike[]; has_more?: boolean };
        return { data: j.data ?? [], has_more: j.has_more === true };
      },
      record: (args) => db.rpc("prive_record_paid_period", args),
    });
    // Solo conteos: sin correos ni ids de usuarios.
    console.log("prive-tenure-backfill:", JSON.stringify(summary));
    return json(summary);
  } catch (e) {
    console.error("prive-tenure-backfill:", safeErrorMessage(e));
    return json({ error: "backfill_failed" }, 500);
  }
});
