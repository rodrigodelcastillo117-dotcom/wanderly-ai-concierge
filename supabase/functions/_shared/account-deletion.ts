// Borrado de cuenta por pasos, idempotente y reanudable (ronda sec2-b). Sin Deno ni red: los pasos
// se inyectan (delete-account/index.ts y account-deletion-retry/index.ts) y todo se prueba con
// Vitest (src/test/accountDeletion.test.ts).
//
// Orden y regla de la identidad (decisión documentada en docs/ops/LEEME.md):
//   1. stripe_cancel  (bloqueante): cancelar suscripciones vivas y quitar métodos de pago.
//   2. storage        (bloqueante): archivos del usuario en todos los buckets.
//   3. db_purge       (bloqueante): purge_account_data.
//   → Solo con los tres en 'done' se borra auth.users. Si uno falla, la solicitud queda pendiente
//     (la persona puede volver a intentarlo y el cron lo reintenta): nunca se borra la identidad
//     mientras Stripe pueda seguir cobrando o queden datos sin borrar.
//   4. stripe_customer_redact y 5. posthog_delete (no bloqueantes): si fallan o falta la llave
//     quedan 'failed' / 'pending_key' y los reintenta account-deletion-retry; no detienen el borrado
//     de la identidad (la persona ya no puede entrar y sus datos en la base ya no existen).
// Un paso en 'done' o 'skipped' nunca se repite.

export type StepName = "stripe_cancel" | "storage" | "db_purge" | "stripe_customer_redact" | "posthog_delete";
export type StepStatus = "pending" | "running" | "done" | "failed" | "pending_key" | "skipped";
export type StepState = { step: StepName; status: StepStatus; attempts: number; last_error?: string | null };
export type StepResult = "done" | "skipped" | "pending_key";

export const BLOCKING_STEPS: StepName[] = ["stripe_cancel", "storage", "db_purge"];
export const NON_BLOCKING_STEPS: StepName[] = ["stripe_customer_redact", "posthog_delete"];
const FINISHED = new Set<StepStatus>(["done", "skipped"]);

export interface DeletionDeps {
  loadSteps(): Promise<StepState[]>;
  saveStep(step: StepName, patch: { status: StepStatus; attempts: number; last_error: string | null; started?: boolean; finished?: boolean }): Promise<void>;
  steps: Record<StepName, () => Promise<StepResult>>;
  identityDeleted(): Promise<boolean>;
  /** Borra auth.users; "no existe" cuenta como hecho. */
  deleteIdentity(): Promise<void>;
  markRequest(status: "pending" | "identity_deleted" | "completed"): Promise<void>;
  /** Mensaje de error sin datos personales ni secretos. */
  redact(e: unknown): string;
}

export type DeletionOutcome = {
  identityDeleted: boolean;
  completed: boolean;
  /** Primer paso bloqueante que falló (la identidad sigue). */
  blockedAt: StepName | "identity" | null;
  pending: StepName[];
};

export async function runDeletion(deps: DeletionDeps, opts: { maxAttempts?: number } = {}): Promise<DeletionOutcome> {
  const max = opts.maxAttempts ?? Infinity;
  const state = new Map((await deps.loadSteps()).map((s) => [s.step, s]));

  const attempt = async (step: StepName): Promise<boolean> => {
    const cur = state.get(step) ?? { step, status: "pending" as StepStatus, attempts: 0 };
    if (FINISHED.has(cur.status)) return true;
    if (cur.attempts >= max && cur.status === "failed") return false;
    const attempts = cur.attempts + 1;
    await deps.saveStep(step, { status: "running", attempts, last_error: cur.last_error ?? null, started: true });
    try {
      const result = await deps.steps[step]();
      await deps.saveStep(step, { status: result, attempts, last_error: null, finished: result !== "pending_key" });
      state.set(step, { step, status: result, attempts });
      return FINISHED.has(result);
    } catch (e) {
      const last_error = deps.redact(e);
      await deps.saveStep(step, { status: "failed", attempts, last_error });
      state.set(step, { step, status: "failed", attempts, last_error });
      return false;
    }
  };

  let blockedAt: DeletionOutcome["blockedAt"] = null;
  for (const step of BLOCKING_STEPS) {
    if (!(await attempt(step))) { blockedAt = step; break; }
  }

  let identityDeleted = await deps.identityDeleted();
  if (!blockedAt) {
    if (!identityDeleted) {
      try {
        await deps.deleteIdentity();
        await deps.markRequest("identity_deleted");
        identityDeleted = true;
      } catch {
        blockedAt = "identity";
      }
    }
    for (const step of NON_BLOCKING_STEPS) await attempt(step);
  }

  const pending = [...BLOCKING_STEPS, ...NON_BLOCKING_STEPS].filter((s) => !FINISHED.has(state.get(s)?.status ?? "pending"));
  const completed = identityDeleted && pending.length === 0;
  if (completed) await deps.markRequest("completed");
  return { identityDeleted, completed, blockedAt, pending };
}
