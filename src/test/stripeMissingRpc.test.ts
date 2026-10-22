// D-P3-5 (segunda auditoría, ronda r2): el "fallback si la migración no está" del webhook solo se
// activa con el error EXACTO de función inexistente. Antes cualquier error con el nombre de la función
// o con "does not exist" se tomaba como migration_pending (200) o reactivaba la ruta no atómica.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissingFunctionError, missingRpcAsSkip } from "../../supabase/functions/_shared/prive-tenure";

describe("D-P3-5 · casos del auditor: errores reales siguen siendo error (500), no 'migration_pending'", () => {
  it.each([
    ["error propio de la función (su nombre va en el mensaje)", "prive_mark_paid_period: evento inválido refund_x", "P0001"],
    ["tabla interna inexistente", 'relation "public.pro_paid_periods" does not exist', "42P01"],
    ["función interna inexistente (con código P0001)", "function public.prive_revoke_sessions(uuid, unknown) does not exist", "P0001"],
    ["función interna inexistente (42883, otra función)", "function public.prive_revoke_sessions(uuid, unknown) does not exist", "42883"],
    ["PGRST202 de OTRA función", "Could not find the function public.otra_funcion(_x) in the schema cache", "PGRST202"],
    ["mensaje con el nombre pero sin código", "Could not find the function public.prive_mark_paid_period(_event) in the schema cache", undefined],
  ])("%s", (_l, message, code) => {
    const r = missingRpcAsSkip({ data: null, error: { message, code } } as never, "prive_mark_paid_period");
    expect(r.error).not.toBeNull();
  });
});

describe("D-P3-5 · la función de verdad no existe (migración sin aplicar): se omite y se sigue", () => {
  it.each([
    ["PostgREST PGRST202", "Could not find the function public.prive_mark_paid_period(_amount_refunded, _event, _invoice_id) in the schema cache", "PGRST202"],
    ["PostgREST PGRST202 (forma corta)", "Could not find the function public.prive_mark_paid_period", "PGRST202"],
    ["Postgres 42883 de la función llamada", "function public.prive_mark_paid_period(text, text, integer) does not exist", "42883"],
  ])("%s", (_l, message, code) => {
    expect(missingRpcAsSkip({ data: null, error: { message, code } }, "prive_mark_paid_period"))
      .toEqual({ data: { recorded: false, applied: false, reason: "migration_pending" }, error: null });
  });

  it("isMissingFunctionError no confunde prefijos (fn vs fn_v2) ni acepta caracteres especiales como regex", () => {
    expect(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.stripe_commit_payment_event_v2(_row)" }, "stripe_commit_payment_event")).toBe(false);
    expect(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.is_deleted_stripe_customer(_customer_id) in the schema cache" }, "is_deleted_stripe_customer")).toBe(true);
    expect(isMissingFunctionError({ code: "42883", message: "function public.abc(x) does not exist" }, "a.c")).toBe(false);
    expect(isMissingFunctionError(null, "x")).toBe(false);
  });

  it("stripe-webhook/index.ts ya no usa las regex amplias (nombre | PGRST202 | does not exist)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "supabase/functions/stripe-webhook/index.ts"), "utf8");
    expect(src).not.toMatch(/does not exist\|/);
    expect(src).not.toMatch(/\|PGRST202\|/);
    expect(src.match(/isMissingFunctionError\(/g)?.length).toBe(2);
  });
});
