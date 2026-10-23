// Aviso de créditos de IA: la persona sigue viendo el mensaje amable; el equipo recibe una campana al
// día (y un correo si está configurado), sin repetirse en cada intento fallido.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CREDITS_EMAIL_SUBJECT, alertAiCredits, resetAiCreditsAlertMemo, type AiCreditsAlertDeps } from "../../supabase/functions/_shared/ai-credits-alert";

const deps = (n: unknown, extra: Partial<AiCreditsAlertDeps> = {}) => {
  const rpc = vi.fn(async () => ({ data: n, error: null }));
  const sendEmail = vi.fn(async () => true);
  return { rpc, sendEmail, d: { rpc, sendEmail, emailTo: ["ops@example.test"], ...extra } as AiCreditsAlertDeps };
};

beforeEach(() => resetAiCreditsAlertMemo());

describe("alertAiCredits", () => {
  it("primera vez del día: campana + correo al de alertas", async () => {
    const { d, rpc, sendEmail } = deps(1);
    expect(await alertAiCredits("sin_saldo", d)).toBe("campana_y_correo");
    expect(rpc).toHaveBeenCalledWith("imagenes", "sin_saldo");
    expect(sendEmail).toHaveBeenCalledWith(["ops@example.test"], AI_CREDITS_EMAIL_SUBJECT, expect.stringMatching(/HTTP 402[\s\S]*recargar/));
  });

  it("la base ya avisó hoy (0): ni campana nueva ni correo", async () => {
    const { d, sendEmail } = deps(0);
    expect(await alertAiCredits("sin_saldo", d)).toBe("ya_avisado");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("límite en la instancia: 30 min sin volver a llamar a la base", async () => {
    let now = 1_000_000;
    const { d, rpc } = deps(1, { now: () => now });
    await alertAiCredits("sin_saldo", d);
    now += 10 * 60_000;
    expect(await alertAiCredits("sin_saldo", d)).toBe("omitido_reciente");
    expect(rpc).toHaveBeenCalledTimes(1);
    // Otro motivo (falta la llave) es otro aviso.
    expect(await alertAiCredits("sin_llave", d)).toBe("campana_y_correo");
    now += 25 * 60_000;
    await alertAiCredits("sin_saldo", d);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("sin administradores (-1): solo correo, y no se repite en 6 h", async () => {
    let now = 0;
    const { d, sendEmail } = deps(-1, { now: () => now });
    expect(await alertAiCredits("sin_saldo", d)).toBe("solo_correo");
    now += 3 * 3600_000;
    expect(await alertAiCredits("sin_saldo", d)).toBe("omitido_reciente");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    resetAiCreditsAlertMemo();
    expect(await alertAiCredits("sin_saldo", { ...d, emailTo: [] })).toBe("sin_destinatarios");
  });

  it("si la base falla, no lanza (la persona recibe su respuesta igual)", async () => {
    const log = vi.fn();
    const d = { rpc: async () => ({ data: null, error: { message: "boom" } }), emailTo: [], log } as AiCreditsAlertDeps;
    expect(await alertAiCredits("sin_saldo", d)).toBe("fallido");
    expect(log).toHaveBeenCalled();
  });
});

describe("generate-avatar", () => {
  const src = readFileSync("supabase/functions/generate-avatar/index.ts", "utf8");
  it("conserva el mensaje amable para la persona", () => {
    expect(src).toContain('sin_creditos: "El servicio de imágenes no está disponible en este momento. Intenta más tarde."');
  });
  it("avisa al equipo cuando el gateway responde sin créditos y cuando falta la llave", () => {
    expect(src).toMatch(/if \(res\.code === "sin_creditos"\) alertNoCredits\(db, "sin_saldo"\);\s*return fail\(res\.code/);
    expect(src).toMatch(/alertNoCredits\(db, "sin_llave"\);\s*return fail\("sin_creditos", 503\)/);
    expect(src).toContain('db.rpc("alert_admins_ai_credits", { p_service: service, p_reason: r })');
    // En segundo plano: no retrasa la respuesta.
    expect(src).toMatch(/runInBackground\(alertAiCredits\(/);
  });
  it("la migración deduplica por día y solo la llave de servicio la puede llamar", () => {
    const sql = readFileSync("supabase/migrations/20261027100100_alerta_creditos_ia.sql", "utf8");
    expect(sql).toContain("'ia_sin_creditos:' || p_service || ':' || p_reason || ':' || v_day");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.alert_admins_ai_credits(text, text) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.alert_admins_ai_credits(text, text) TO service_role;");
  });
});
