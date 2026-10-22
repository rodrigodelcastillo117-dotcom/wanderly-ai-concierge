// Reservas IA: token de respuesta, remitente verificado, firma de Resend/Svix, cron (recordatorio y
// vencimiento), estados del Booking Bridge y que el grafo de estados de TypeScript sea el de la base.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_RESERVATION_STATUSES, cronDecision, FREEMAIL, extractReplyToken, fallbackOptions, redactExcerpt, replyAddress, senderVerified,
  statusLabel, toBridgeState, TRANSITIONS,
} from "../../supabase/functions/_shared/ai-reservations/core";
import { signLink, signSvix, verifyLink, verifySvixSignature } from "../../supabase/functions/_shared/ai-reservations/signature";

const TOKEN = "0123456789abcdef01234567";

describe("token de respuesta por reserva", () => {
  it("reservas+<token>@reply.traveliatos.life y se recupera de to/received_for", () => {
    expect(replyAddress(TOKEN)).toBe(`reservas+${TOKEN}@reply.traveliatos.life`);
    expect(extractReplyToken([["Ana <reservas+0123456789ABCDEF01234567@reply.traveliatos.life>"]])).toBe(TOKEN);
    expect(extractReplyToken([[], [`reservas+${TOKEN}@reply.traveliatos.life`]])).toBe(TOKEN);
  });
  it("no acepta otro dominio, tokens cortos ni dominios que solo empiezan igual", () => {
    expect(extractReplyToken([`reservas+${TOKEN}@evil.test`])).toBeNull();
    expect(extractReplyToken([`reservas+${TOKEN}@reply.traveliatos.life.evil.test`])).toBeNull();
    expect(extractReplyToken(["reservas+abc@reply.traveliatos.life"])).toBeNull();
    expect(() => replyAddress("../../etc")).toThrow();
  });
});

describe("remitente verificado", () => {
  const pass = { spf: "pass", dkim: "pass", dmarc: "pass" };
  it("mismo dominio (o subdominio) + DMARC pass = verificado si el dominio es el del sitio oficial; SPF y DKIM sin DMARC no bastan (AUD-02, A2-RES-01/06)", () => {
    const site = "https://casaoaxaca.com.mx/";
    expect(senderVerified("maria@casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", pass, site)).toBe(true);
    expect(senderVerified("x@mail.casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "pass", dmarc: "pass" }, site)).toBe(true);
    // A2-RES-01: sin sitio oficial en ese dominio, otra dirección no cuenta (se exige la exacta).
    expect(senderVerified("maria@casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", pass)).toBe(false);
    // AUD-02: antes esto era true (SPF+DKIM sin DMARC para cualquier dirección del dominio). Ver aiReservationsSenderAuth.test.ts.
    expect(senderVerified("x@mail.casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "pass" }, site)).toBe(false);
    // A2-RES-06: sin resultado DMARC (campo ausente) ya no se verifica ni con la dirección exacta: falla cerrada
    // (antes true). Con DMARC 'gray' explícito y DKIM pass, sí.
    expect(senderVerified("reservas@casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "pass" })).toBe(false);
    expect(senderVerified("reservas@casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "pass", dmarc: "gray" })).toBe(true);
  });
  it("sin autenticación, con DMARC fallido u otro dominio → no verificado", () => {
    expect(senderVerified("reservas@casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", null)).toBe(false);
    expect(senderVerified("reservas@casaoaxaca.com.mx", "reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "fail", dmarc: "fail" })).toBe(false);
    expect(senderVerified("reservas@otro.mx", "reservas@casaoaxaca.com.mx", pass)).toBe(false);
  });
  it("correo gratuito: el dominio lo comparte cualquiera, se exige la misma dirección", () => {
    expect(senderVerified("casaoaxaca@gmail.com", "casaoaxaca@gmail.com", pass)).toBe(true);
    expect(senderVerified("atacante@gmail.com", "casaoaxaca@gmail.com", pass)).toBe(false);
  });
});

describe("firma Svix del webhook de Resend", () => {
  const secret = "whsec_" + btoa("clave-de-prueba-de-32-bytes!!!!!");
  const body = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });
  const now = new Date("2026-11-02T18:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const headers = async (over: Record<string, string> = {}) =>
    new Headers({ "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": `v1,${await signSvix(secret, "msg_1", ts, body)}`, ...over });

  it("acepta una firma válida (también entre varias firmas separadas por espacios)", async () => {
    expect(await verifySvixSignature(await headers(), body, secret, now)).toEqual({ ok: true, id: "msg_1", timestamp: ts });
    const good = (await headers()).get("svix-signature")!;
    expect((await verifySvixSignature(await headers({ "svix-signature": `v1,AAAA ${good}` }), body, secret, now)).ok).toBe(true);
  });
  it("rechaza sin firma, cuerpo alterado, otro secreto, timestamp viejo o sin secreto configurado", async () => {
    expect(await verifySvixSignature(new Headers(), body, secret, now)).toEqual({ ok: false, reason: "missing_signature_headers" });
    expect((await verifySvixSignature(await headers(), body.replace("em_1", "em_2"), secret, now)).ok).toBe(false);
    expect((await verifySvixSignature(await headers(), body, "whsec_" + btoa("otra-clave-distinta-de-32-bytes!"), now)).ok).toBe(false);
    expect(await verifySvixSignature(await headers(), body, secret, new Date(now.getTime() + 6 * 60_000))).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
    expect(await verifySvixSignature(await headers(), body, undefined, now)).toEqual({ ok: false, reason: "secret_not_configured" });
    expect((await verifySvixSignature(await headers({ "svix-signature": "v2,abc" }), body, secret, now)).ok).toBe(false);
  });
  it("enlace firmado del .ics: no se puede cambiar el id", async () => {
    const sig = await signLink("s3cr3t", "ics:a:b");
    expect(await verifyLink("s3cr3t", "ics:a:b", sig)).toBe(true);
    expect(await verifyLink("s3cr3t", "ics:a:c", sig)).toBe(false);
    expect(await verifyLink(undefined, "ics:a:b", sig)).toBe(false);
  });
});

describe("cron: un recordatorio y luego vence", () => {
  const sentAt = "2026-11-01T10:00:00Z";
  const base = {
    status: "sent" as const, sent_at: sentAt, reminder_sent_at: null, expires_at: "2026-11-03T10:00:00Z",
    requested_for: "2026-11-10T02:30:00Z", created_at: sentAt, status_changed_at: sentAt,
  };
  it("antes de 24 h nada; a las 24 h recordatorio; ya recordado nada; al vencer → expire", () => {
    expect(cronDecision(base, new Date("2026-11-01T20:00:00Z")).kind).toBe("none");
    expect(cronDecision(base, new Date("2026-11-02T10:00:00Z")).kind).toBe("remind");
    expect(cronDecision({ ...base, reminder_sent_at: "2026-11-02T10:00:00Z" }, new Date("2026-11-02T12:00:00Z")).kind).toBe("none");
    expect(cronDecision({ ...base, reminder_sent_at: "2026-11-02T10:00:00Z" }, new Date("2026-11-03T10:00:01Z")).kind).toBe("expire");
  });
  it("si la reserva es pronto, el recordatorio llega a la mitad del plazo", () => {
    const soon = { ...base, expires_at: "2026-11-01T16:00:00Z", requested_for: "2026-11-01T16:30:00Z" };
    expect(cronDecision(soon, new Date("2026-11-01T12:59:00Z")).kind).toBe("none");
    expect(cronDecision(soon, new Date("2026-11-01T13:00:00Z")).kind).toBe("remind");
    expect(cronDecision(soon, new Date("2026-11-01T16:00:00Z")).kind).toBe("expire");
  });
  it("intención sin confirmar 72 h vence; needs_user vence al pasar la hora", () => {
    const intent = { ...base, status: "awaiting_user_ok" as const, sent_at: null };
    expect(cronDecision(intent, new Date("2026-11-03T09:00:00Z")).kind).toBe("none");
    expect(cronDecision(intent, new Date("2026-11-04T10:00:00Z")).kind).toBe("expire");
    expect(cronDecision({ ...base, status: "needs_user" as const }, new Date("2026-11-09T00:00:00Z")).kind).toBe("none");
    expect(cronDecision({ ...base, status: "needs_user" as const }, new Date("2026-11-10T03:00:00Z")).kind).toBe("expire");
    expect(cronDecision({ ...base, status: "confirmed" as const }, new Date("2027-01-01T00:00:00Z")).kind).toBe("none");
  });
});

describe("estados", () => {
  it("el grafo de TypeScript es exactamente el de ai_reservation_transition_ok (SQL)", () => {
    const sql = readFileSync("supabase/migrations/20261023170000_ai_reservations.sql", "utf8");
    const body = sql.slice(sql.indexOf("FUNCTION public.ai_reservation_transition_ok"), sql.indexOf("FUNCTION public.ai_reservation_limits"));
    const pairs = [...body.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    const ts = AI_RESERVATION_STATUSES.flatMap((f) => TRANSITIONS[f].map((t) => `${f}>${t}`)).sort();
    expect(pairs).toEqual(ts);
  });
  it("mapa al Booking Bridge: nada es CONFIRMED salvo confirmed; nunca REDIRECTED ni PRICE_RECHECK", () => {
    const states = AI_RESERVATION_STATUSES.map((s) => toBridgeState(s));
    expect(states.filter((s) => s === "CONFIRMED")).toHaveLength(1);
    expect(toBridgeState("confirmed")).toBe("CONFIRMED");
    expect(states).not.toContain("REDIRECTED_TO_PROVIDER");
    expect(states).not.toContain("PRICE_RECHECK_REQUIRED");
    expect(toBridgeState("awaiting_user_ok")).toBe("READY_TO_BOOK");
    expect(toBridgeState("sent")).toBe("REQUESTED");
    expect(toBridgeState("needs_user", "no_contact")).toBe("FAILED");
    expect(toBridgeState("needs_user", "alternative_offered")).toBe("PENDING_CONFIRMATION");
    expect(toBridgeState("expired")).toBe("EXPIRED");
  });
  it("solo confirmed dice 'Confirmada'; nunca 'mesa confirmada'", () => {
    for (const s of AI_RESERVATION_STATUSES) {
      const l = statusLabel(s, null);
      if (s !== "confirmed") expect(l).not.toMatch(/^confirmada/i);
      expect(l.toLowerCase()).not.toContain("mesa confirmada");
    }
  });
});

describe("AUD-06 · reglas de TypeScript = reglas de la base", () => {
  it("la lista de buzones compartidos de core.ts es la misma que ai_res_freemail_domains() (SQL, última definición: r2)", () => {
    const sql = readFileSync("supabase/migrations/20261026010000_r2_reservas_remitente.sql", "utf8");
    const body = sql.slice(sql.indexOf("FUNCTION public.ai_res_freemail_domains"), sql.indexOf("FUNCTION public.ai_res_sender_strong"));
    const domains = [...body.matchAll(/'([a-z0-9.-]+\.[a-z]+)'/g)].map((m) => m[1]).sort();
    expect(domains).toEqual([...FREEMAIL].sort());
  });
  it("A2-RES-02: la versión de reglas de evidence.ts es una de las que acepta la base (ai_res_rules_versions)", async () => {
    const { RULES_VERSION } = await import("../../supabase/functions/_shared/ai-reservations/evidence");
    const sql = readFileSync("supabase/migrations/20261026020000_r2_reservas_vetos.sql", "utf8");
    const body = sql.slice(sql.indexOf("FUNCTION public.ai_res_rules_versions"), sql.indexOf("$$;", sql.indexOf("FUNCTION public.ai_res_rules_versions")));
    expect([...body.matchAll(/'([a-z0-9.-]+)'/g)].map((m) => m[1])).toContain(RULES_VERSION);
  });
});

describe("utilidades", () => {
  it("el extracto tapa correos, teléfonos y tarjetas pero conserva fechas", () => {
    const t = redactExcerpt("Escríbanos a reservas@x.mx o al +52 55 1234 5678. Tarjeta 4111 1111 1111 1111. Fecha 2026-11-03 20:30");
    expect(t).not.toContain("reservas@x.mx");
    expect(t).not.toContain("5678");
    expect(t).not.toContain("4111");
    expect(t).toContain("2026-11-03");
  });
  it("opciones sin correo: tel, WhatsApp solo con número internacional, Fixer siempre", () => {
    expect(fallbackOptions({ phone: "+52 55 1234 5678", booking_url: "https://x.mx/reservar" })).toMatchObject({
      phone_url: "tel:+525512345678", whatsapp_url: "https://wa.me/525512345678", booking_url: "https://x.mx/reservar", fixer: true,
    });
    expect(fallbackOptions({ phone: "55 1234 5678", booking_url: "javascript:alert(1)" })).toMatchObject({ whatsapp_url: null, booking_url: null });
  });
});
