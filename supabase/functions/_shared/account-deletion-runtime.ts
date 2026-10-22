// Conecta el flujo de borrado (account-deletion.ts) con Supabase, Stripe y PostHog. Lo usan
// delete-account (la persona) y account-deletion-retry (cron). Solo service role.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { runDeletion, type DeletionDeps, type DeletionOutcome, type StepName, type StepStatus } from "./account-deletion.ts";
import { cancelAllSubscriptions, detachAllPaymentMethods, stripeFetchDeps } from "./stripe-billing.ts";
import { deletePosthogPerson } from "./posthog-delete.ts";
import { redactPii } from "./redact.ts";

export type DeletionRequest = {
  id: string;
  account_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  identity_deleted_at: string | null;
};

const env = (k: string) => Deno.env.get(k) ?? "";

export function deletionDeps(admin: SupabaseClient, req: DeletionRequest): DeletionDeps {
  const stripeKey = env("STRIPE_SECRET_KEY");
  const billing = stripeKey ? stripeFetchDeps(stripeKey) : null;
  const now = () => new Date().toISOString();
  const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

  return {
    async loadSteps() {
      const { data, error } = await admin.from("deletion_request_steps")
        .select("step,status,attempts,last_error").eq("request_id", req.id);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ step: StepName; status: StepStatus; attempts: number; last_error: string | null }>;
    },
    async saveStep(step, p) {
      check(await admin.from("deletion_request_steps").update({
        status: p.status, attempts: p.attempts, last_error: p.last_error, updated_at: now(),
        ...(p.started ? { started_at: now() } : {}), ...(p.finished ? { finished_at: now() } : {}),
      }).eq("request_id", req.id).eq("step", step));
    },
    steps: {
      async stripe_cancel() {
        if (!req.stripe_customer_id && !req.stripe_subscription_id) return "skipped";
        if (!billing) throw new Error("stripe_key_missing");
        const out = await cancelAllSubscriptions(billing, { customerId: req.stripe_customer_id, subscriptionId: req.stripe_subscription_id });
        if (!out.ok) throw new Error(`stripe_cancel_failed:${out.failed}`);
        if (req.stripe_customer_id) {
          const pm = await detachAllPaymentMethods(billing, req.stripe_customer_id);
          if (!pm.ok) throw new Error(`stripe_detach_failed:${pm.failed}`);
        }
        return "done";
      },
      async storage() {
        // Se vuelve a consultar después de cada lote: la RPC tiene tope de filas.
        for (let round = 0; round < 50; round++) {
          const { data: files, error } = await admin.rpc("account_deletion_files", { p_user_id: req.account_id });
          if (error) throw new Error(error.message);
          if (!files?.length) return "done";
          const grouped = new Map<string, string[]>();
          for (const f of files as Array<{ bucket_id: string; name: string }>) grouped.set(f.bucket_id, [...(grouped.get(f.bucket_id) ?? []), f.name]);
          for (const [bucket, paths] of grouped) {
            for (let i = 0; i < paths.length; i += 100) {
              const { error: removeError } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
              if (removeError) throw new Error(removeError.message);
            }
          }
        }
        throw new Error("storage_not_empty");
      },
      async db_purge() {
        const { error } = await admin.rpc("purge_account_data", { p_user_id: req.account_id });
        if (error) throw new Error(error.message);
        return "done";
      },
      async stripe_customer_redact() {
        if (!req.stripe_customer_id) return "skipped";
        if (!billing?.redactCustomer) return "pending_key";
        const r = await billing.redactCustomer(req.stripe_customer_id);
        if (!r.ok) throw new Error(`stripe_redact_${(r as { httpStatus?: number }).httpStatus ?? "error"}`);
        return "done";
      },
      posthog_delete() {
        return deletePosthogPerson({
          personalApiKey: env("POSTHOG_PERSONAL_API_KEY"), projectId: env("POSTHOG_PROJECT_ID"), host: env("POSTHOG_API_HOST"),
        }, req.account_id);
      },
    },
    async identityDeleted() {
      const { data } = await admin.from("deletion_requests").select("identity_deleted_at").eq("id", req.id).maybeSingle();
      return Boolean((data as { identity_deleted_at?: string | null } | null)?.identity_deleted_at);
    },
    async deleteIdentity() {
      const { error } = await admin.auth.admin.deleteUser(req.account_id);
      if (error && !/not.?found/i.test(error.message)) throw new Error(error.message);
    },
    async markRequest(status) {
      check(await admin.from("deletion_requests").update({
        status, updated_at: now(),
        ...(status === "identity_deleted" ? { identity_deleted_at: now() } : {}),
        ...(status === "completed" ? { completed_at: now() } : {}),
      }).eq("id", req.id));
    },
    redact: (e) => redactPii(e instanceof Error ? e.message : e, 300) ?? "error",
  };
}

export async function loadRequest(admin: SupabaseClient, id: string): Promise<DeletionRequest> {
  const { data, error } = await admin.from("deletion_requests")
    .select("id,account_id,stripe_customer_id,stripe_subscription_id,status,identity_deleted_at").eq("id", id).single();
  if (error || !data) throw new Error(error?.message ?? "deletion_request_missing");
  return data as DeletionRequest;
}

export async function processRequest(admin: SupabaseClient, id: string, maxAttempts?: number): Promise<DeletionOutcome> {
  return runDeletion(deletionDeps(admin, await loadRequest(admin, id)), { maxAttempts });
}
