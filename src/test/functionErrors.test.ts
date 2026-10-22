import { describe, it, expect, vi, beforeEach } from "vitest";
import { FunctionsHttpError, FunctionsFetchError } from "@supabase/supabase-js";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { readFunctionError, toastFunctionError } from "@/lib/functionErrors";

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

beforeEach(() => toastError.mockReset());

describe("errores de edge functions para el usuario", () => {
  it("402 de cuota: mensaje del servidor y enlace a PRO", async () => {
    const info = await readFunctionError(httpError(402, {
      error: "upgrade_required", kind: "trip_analysis",
      message: "Ya usaste tu análisis de viaje gratuito. Activa IATOS PRO para acceso ilimitado.", upgrade_url: "/dashboard/pro",
    }), "fallback");
    expect(info).toMatchObject({ status: 402, needsUpgrade: true, upgradeUrl: "/dashboard/pro" });
    expect(info.message).toMatch(/análisis de viaje gratuito/);
    expect(info.message).not.toMatch(/non-2xx/);
  });

  it("402 sin cuerpo útil: mensaje genérico amable y /dashboard/pro; nunca un enlace externo", async () => {
    const info = await readFunctionError(httpError(402, { upgrade_url: "https://evil.example" }), "fallback");
    expect(info.upgradeUrl).toBe("/dashboard/pro");
    expect(info.message).toMatch(/IATOS PRO/);
  });

  it("503 / 409 / 400 muestran el mensaje del servidor", async () => {
    expect((await readFunctionError(httpError(503, { error: "quota_check_failed", message: "No pudimos verificar tu plan en este momento." }), "x")).message)
      .toBe("No pudimos verificar tu plan en este momento.");
    expect((await readFunctionError(httpError(409, { error: "already_subscribed", message: "Ya tienes IATOS PRO activo." }), "x")).message)
      .toBe("Ya tienes IATOS PRO activo.");
    expect((await readFunctionError(httpError(400, { error: "Faltan datos requeridos" }), "x")).message).toBe("Faltan datos requeridos");
  });

  it("códigos sin texto, cuerpos no JSON y el mensaje genérico de supabase caen al fallback", async () => {
    expect((await readFunctionError(httpError(500, { error: "checkout_failed" }), "Intenta de nuevo")).message).toBe("Intenta de nuevo");
    expect((await readFunctionError(httpError(500, "<html>"), "Intenta de nuevo")).message).toBe("Intenta de nuevo");
    expect((await readFunctionError(new Error("Edge Function returned a non-2xx status code"), "Intenta de nuevo")).message).toBe("Intenta de nuevo");
    expect((await readFunctionError(new FunctionsFetchError({}), "x")).message).toMatch(/internet/);
    expect((await readFunctionError(new Error("Sin resultado"), "x")).message).toBe("Sin resultado");
  });

  it("toastFunctionError agrega el botón 'Ver IATOS PRO' que navega a PRO", async () => {
    const navigate = vi.fn();
    await toastFunctionError(httpError(402, { error: "upgrade_required", message: "Agotaste tus 3 mensajes gratis de este mes con el Concierge." }), "x", navigate);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [msg, opts] = toastError.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(msg).toMatch(/3 mensajes gratis/);
    expect(opts.action.label).toBe("Ver IATOS PRO");
    opts.action.onClick();
    expect(navigate).toHaveBeenCalledWith("/dashboard/pro");
  });

  it("otros errores: toast simple sin botón", async () => {
    await toastFunctionError(httpError(429, { error: "rate_limited" }), "x");
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Demasiadas solicitudes/));
  });
});
