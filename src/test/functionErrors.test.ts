import { describe, it, expect, vi, beforeEach } from "vitest";
import { FunctionsHttpError, FunctionsFetchError } from "@supabase/supabase-js";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { readFunctionError, toastFunctionError, freeLimitCopy } from "@/lib/functionErrors";
import { getFreeLimitDialog, closeFreeLimitDialog } from "@/lib/freeLimitStore";

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

const FREE_CONCIERGE = {
  code: "FREE_LIMIT_REACHED", quota: "concierge_monthly", limit: 3, used: 3,
  renews_at: "2026-11-01T00:00:00+00:00", upgrade_available: true, message: "x",
};

beforeEach(() => { toastError.mockReset(); closeFreeLimitDialog(); });

describe("IATOS-P1-FREE-01: el frontend reconoce el código, no el texto", () => {
  it("FREE_LIMIT_REACHED de concierge: copia con la fecha de renovación y enlace a PRO", async () => {
    const info = await readFunctionError(httpError(402, FREE_CONCIERGE), "fallback");
    expect(info).toMatchObject({ code: "FREE_LIMIT_REACHED", needsUpgrade: true, upgradeUrl: "/dashboard/pro" });
    expect(info.freeLimit).toEqual({ quota: "concierge_monthly", limit: 3, used: 3, renewsAt: "2026-11-01T00:00:00+00:00", upgradeAvailable: true });
    expect(info.message).toBe("Has utilizado tus mensajes gratuitos de Iato de este mes. Se renuevan el 1 de noviembre de 2026. " +
      "Puedes seguir usando las funciones gratuitas o activar IATOS PRO por $99 MXN al mes, sujeto a las condiciones vigentes.");
    expect(info.message).not.toMatch(/non-2xx|tropiezo/);
  });

  it("análisis de una sola vez: nunca promete renovación aunque el servidor mande fecha", async () => {
    const info = await readFunctionError(httpError(402, { ...FREE_CONCIERGE, quota: "trip_analysis_once", limit: 1, used: 1 }), "x");
    expect(info.freeLimit?.renewsAt).toBeNull();
    expect(info.message).toMatch(/^Ya usaste tu análisis gratuito de viaje \(es de una sola vez\)/);
    expect(info.message).not.toMatch(/renuev/i);
  });

  it("límite de un plan de pago: sin oferta de PRO", () => {
    expect(freeLimitCopy({ quota: "trip_analysis_monthly", limit: 10, used: 10, renewsAt: "2026-11-01T00:00:00Z", upgradeAvailable: false }))
      .toBe("Llegaste al límite mensual de tu plan; se renueva el 1 de noviembre de 2026.");
  });

  it("toastFunctionError abre el diálogo (no un toast) con FREE_LIMIT_REACHED", async () => {
    await toastFunctionError(httpError(402, FREE_CONCIERGE), "x");
    expect(toastError).not.toHaveBeenCalled();
    expect(getFreeLimitDialog()).toMatchObject({ quota: "concierge_monthly" });
  });

  it("(9) error real del proveedor (SERVICE_UNAVAILABLE): toast de reintento, sin diálogo ni venta de PRO", async () => {
    const info = await toastFunctionError(httpError(503, { code: "SERVICE_UNAVAILABLE", message: "No pudimos completar esto en este momento y no se descontó de tu plan. Intenta de nuevo en unos minutos." }), "x");
    expect(info.freeLimit).toBeNull();
    expect(info.needsUpgrade).toBe(false);
    expect(getFreeLimitDialog()).toBeNull();
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/no se descontó/));
    expect(toastError.mock.calls[0][0]).not.toMatch(/PRO/);
  });

  it("los mensajes internos nunca llegan al usuario", async () => {
    for (const body of [
      { error: "duplicate key value violates unique constraint \"trips_pkey\"" },
      { error: "AI gateway 500", detail: "upstream connect error or disconnect/reset before headers" },
      { error: "ANTHROPIC_API_KEY no configurada" },
      { message: "TypeError: cannot read properties of undefined" },
    ]) {
      const info = await readFunctionError(httpError(500, body), "No pudimos generar el análisis. Intenta de nuevo.");
      expect(info.message).toBe("No pudimos generar el análisis. Intenta de nuevo.");
    }
    expect((await readFunctionError(httpError(502, "<html>"), "Intenta de nuevo")).message).toBe("Intenta de nuevo");
  });

  it("sesión inválida, análisis en curso, ritmo y red tienen su propio mensaje", async () => {
    expect((await readFunctionError(httpError(401, { code: "UNAUTHENTICATED" }), "x")).message).toMatch(/sesión expiró/);
    expect((await readFunctionError(httpError(401, { error: "Sesión inválida" }), "x")).status).toBe(401);
    expect((await readFunctionError(httpError(409, { code: "ANALYSIS_IN_PROGRESS", message: "Tu análisis ya está en proceso." }), "x")).message)
      .toBe("Tu análisis ya está en proceso.");
    expect((await readFunctionError(httpError(409, { error: "already_subscribed", message: "Ya tienes IATOS PRO activo." }), "x")).message)
      .toBe("Ya tienes IATOS PRO activo.");
    expect((await readFunctionError(httpError(429, { error: "rate_limited" }), "x")).message).toMatch(/Demasiadas solicitudes/);
    expect((await readFunctionError(new FunctionsFetchError({}), "x")).message).toMatch(/internet/);
  });

  it("errores propios de la pantalla se muestran; el genérico de supabase no", async () => {
    expect((await readFunctionError(new Error("Sin resultado"), "x")).message).toBe("Sin resultado");
    expect((await readFunctionError(new Error("Edge Function returned a non-2xx status code"), "Intenta de nuevo")).message).toBe("Intenta de nuevo");
  });

  it("402 de un servidor anterior (upgrade_required) también abre el diálogo", async () => {
    const info = await readFunctionError(httpError(402, { error: "upgrade_required", kind: "concierge" }), "x");
    expect(info.freeLimit?.quota).toBe("concierge_monthly");
  });
});
