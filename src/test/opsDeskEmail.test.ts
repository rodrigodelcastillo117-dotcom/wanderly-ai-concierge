// Mesa de operaciones: armado de los correos (aviso al dueño y respuesta al usuario) y envío con marca
// (sin duplicados, falla registrada, reintento). _shared/ops-desk.ts con una base y un envío simulados.
import { describe, expect, it, vi } from "vitest";
import {
  myRequestsUrl, opsDeskUrl, ownerAlertEmail, retryOpsEmails, sendOwnerAlert, sendTeamReply, teamReplyEmail, type OpsItem, type OpsMailDeps,
  type ReplyClaim,
} from "../../supabase/functions/_shared/ops-desk";
import { executeAction } from "../../supabase/functions/concierge-chat/actionExec";
import { validateAction } from "../../supabase/functions/concierge-chat/actions";
import { FIXER_RULE } from "../../supabase/functions/concierge-chat/prompt";

const SITE = "https://traveliatos.life";
// Como lo devuelve _ops_request_json (SQL) para la mesa de Iato: fecha + hora + personas + lugar.
const reserva: OpsItem = {
  source: "concierge_request", id: "7e300000-0000-0000-0000-000000000001", type: "reservation", title: "Mesa en Contramar",
  status: "solicitado", stage: "nueva", created_at: "2026-10-28T18:00:00Z", requested_for: "2026-11-02T20:30", party_size: 4, place: "Contramar",
  payload: { tipo: "reservation", titulo: "Mesa en Contramar", fecha: "2026-11-02", hora: "20:30", personas: 4, lugar: "Contramar", detalle: "Aniversario, terraza", origen: "iato" },
  trip: { id: "t1", destino: "Ciudad de México", fecha_salida: "2026-11-01", fecha_regreso: "2026-11-05" },
  user: { id: "u1", name: "Ana Viajera", email: "ana@correo.mx" },
};

describe("aviso al dueño (FIXER_EMAIL)", () => {
  it("asunto claro: «Nueva solicitud: Reserva … en … para … el …» y enlace directo a /admin/operaciones", () => {
    const m = ownerAlertEmail(reserva, SITE);
    expect(m.subject).toBe("Nueva solicitud: Reserva de mesa en Contramar para 4 personas el 2 de nov., 20:30 h · Ana Viajera · Folio 7E300000");
    expect(m.html).toContain(`href="${SITE}/admin/operaciones?id=7e300000-0000-0000-0000-000000000001"`);
    expect(m.text).toContain(`Atender en la mesa de operaciones: ${SITE}/admin/operaciones?id=7e300000-0000-0000-0000-000000000001`);
    expect(m.text).toContain("Lo que pidió: Aniversario, terraza");
    expect(m.text).toContain("Viaje: Ciudad de México");
    // Nada repetido ni crudo: fecha/hora/personas/lugar ya van en su renglón; nada de JSON ni uuid completo en el cuerpo.
    expect(m.text).not.toMatch(/^Hora: /m);
    expect(m.text).not.toMatch(/\{"|":/);
    expect(opsDeskUrl(null, "x y")).toBe("https://traveliatos.life/admin/operaciones?id=x%20y");
  });

  it("sin lugar (traslado) el asunto lleva el título; Members Only toma lugar y ciudad del payload", () => {
    const t = ownerAlertEmail({ ...reserva, type: "transport", title: "Traslado al aeropuerto", place: null, party_size: null, requested_for: null, payload: {} }, SITE);
    expect(t.subject).toBe("Nueva solicitud: Transporte · Traslado al aeropuerto · Ana Viajera · Folio 7E300000");
    const mo = ownerAlertEmail({ ...reserva, type: "members_nightlife_reservation", place: null, payload: { venue_name: "Licorería Limantour", ciudad: "CDMX", website: "https://limantour.tv" } }, SITE);
    expect(mo.subject).toContain("Reserva Members Only en Licorería Limantour");
    expect(mo.text).toContain("CDMX");
  });
});

describe("respuesta del equipo al usuario", () => {
  const claim = (over: Partial<ReplyClaim["reply"]> = {}, item: Partial<OpsItem> = {}): ReplyClaim => ({
    reply: { id: "r1", kind: "respuesta", body: "Hola Ana: Contramar tiene terraza a las 20:30.\n¿Te la aparto?", source: "concierge_request", source_id: reserva.id, ...over },
    to: "ana@correo.mx", name: "Ana Viajera", item: { ...reserva, stage: "en_proceso", ...item },
  });

  it("dice qué pidió, el mensaje tal cual, el estado honesto y dónde verlo en la app", () => {
    const m = teamReplyEmail(claim(), SITE);
    expect(m.subject).toBe("Te respondió el equipo IATOS: Reserva de mesa · Contramar");
    expect(m.text).toContain("Hola Ana: Contramar tiene terraza a las 20:30.\n¿Te la aparto?");
    expect(m.text).toContain("Estado: En proceso · una persona del equipo IATOS la está atendiendo · aún no es una reserva");
    expect(m.text).toContain(`Ver mis solicitudes: ${myRequestsUrl(SITE)}`);
    expect(m.html).toContain("Lo escribió una persona del equipo IATOS");
    expect(m.html).toMatch(/Recibes este correo/);
    // Sin tiempos inventados.
    expect(`${m.html} ${m.text}`).not.toMatch(/\b\d+\s*(minutos|min|horas)\b|en breve|enseguida/i);
  });

  it("resuelta con comprobante: lo muestra (enlace solo si es https) y ya no dice «aún no es una reserva»", () => {
    const m = teamReplyEmail(claim({ kind: "resuelta", body: "Listo, mesa confirmada.", evidence: "Confirmación Contramar #4471" }, { stage: "resuelta" }), SITE);
    expect(m.subject).toBe("Tu solicitud quedó resuelta: Reserva de mesa · Contramar");
    expect(m.text).toContain("Comprobante: Confirmación Contramar #4471");
    expect(m.text).toContain("Estado: Resuelta por el equipo IATOS\n");
    const link = teamReplyEmail(claim({ kind: "resuelta", evidence: "https://reservas.contramar.com.mx/c/4471" }, { stage: "resuelta" }), SITE);
    expect(link.html).toContain('href="https://reservas.contramar.com.mx/c/4471"');
    const js = teamReplyEmail(claim({ kind: "resuelta", evidence: "javascript:alert(1)" }, { stage: "resuelta" }), SITE);
    expect(js.html).not.toContain('href="javascript');
  });

  it("no se pudo: el motivo es el mensaje; escapa lo que escribe el equipo", () => {
    const m = teamReplyEmail(claim({ kind: "no_se_pudo", body: "<b>No</b> hay mesa ese día" }, { stage: "no_se_pudo" }), SITE);
    expect(m.subject).toBe("No pudimos completar tu solicitud: Reserva de mesa · Contramar");
    expect(m.html).not.toContain("<b>No</b>");
    expect(m.html).toContain("&lt;b&gt;No&lt;/b&gt;");
    expect(m.text).toContain("Estado: No se pudo completar");
  });
});

// Base simulada: guarda las llamadas; cada función responde lo que diga `answers`.
function deps(answers: Record<string, unknown>, sendOk = true) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const sent: { to: string | string[]; subject: string; replyTo?: string }[] = [];
  const d: OpsMailDeps = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const a = answers[fn];
      return Promise.resolve(a instanceof Error ? { data: null, error: { message: a.message } } : { data: a ?? { ok: true }, error: null });
    },
    send: vi.fn(async (m) => { sent.push(m); return sendOk ? { ok: true, id: "re_1" } : { ok: false, error: "resend_500" }; }),
    siteUrl: SITE, ownerEmail: ["hola@traveliatos.life", "carlo@traveliatos.life"],
  };
  return { d, calls, sent };
}

describe("envío con marca de enviado", () => {
  it("reclama, envía al dueño con responder-a del cliente y marca enviado", async () => {
    const { d, calls, sent } = deps({ ops_owner_alert_claim: { ok: true, alert: reserva } });
    const r = await sendOwnerAlert(d, reserva.id, { replyTo: "ana@correo.mx" });
    expect(r.notified).toBe(true);
    expect(sent).toHaveLength(1);
    // FIXER_EMAIL con varios correos (teamEmails): el aviso llega a todo el equipo.
    expect(sent[0]).toMatchObject({ to: ["hola@traveliatos.life", "carlo@traveliatos.life"], replyTo: "ana@correo.mx" });
    expect(sent[0].subject).toMatch(/^Nueva solicitud: /);
    expect(calls.map((c) => c.fn)).toEqual(["ops_owner_alert_claim", "ops_owner_alert_finish"]);
    expect(calls[1].args).toMatchObject({ _id: reserva.id, _ok: true, _email_id: "re_1", _error: null });
  });

  it("si ya se envió (o se está enviando) no manda otro: sin duplicados", async () => {
    for (const code of ["ALREADY_SENT", "IN_FLIGHT"]) {
      const { d, sent, calls } = deps({ ops_owner_alert_claim: { ok: false, code } });
      const r = await sendOwnerAlert(d, reserva.id);
      expect(sent).toHaveLength(0);
      expect(calls.map((c) => c.fn)).toEqual(["ops_owner_alert_claim"]);
      expect(r.notified).toBe(code === "ALREADY_SENT");
    }
  });

  it("si el envío falla queda registrado (fallido + error) para el reintento", async () => {
    const { d, calls } = deps({ ops_owner_alert_claim: { ok: true, alert: reserva } }, false);
    const r = await sendOwnerAlert(d, reserva.id);
    expect(r).toEqual({ notified: false, code: "SEND_FAILED" });
    expect(calls[1]).toEqual({ fn: "ops_owner_alert_finish", args: { _id: reserva.id, _ok: false, _email_id: null, _error: "resend_500" } });
  });

  it("sin la migración aplicada el aviso sale igual con lo que tiene concierge-action (no se pierde)", async () => {
    const { d, sent, calls } = deps({ ops_owner_alert_claim: new Error("function public.ops_owner_alert_claim(uuid) does not exist") });
    const r = await sendOwnerAlert(d, reserva.id, { fallback: reserva });
    expect(r.notified).toBe(true);
    expect(sent).toHaveLength(1);
    expect(calls.map((c) => c.fn)).toEqual(["ops_owner_alert_claim"]);
  });

  it("respuesta al usuario: reclama, envía al correo que da la base y marca", async () => {
    const c: ReplyClaim = { reply: { id: "r1", kind: "respuesta", body: "Hola", source: "concierge_request", source_id: reserva.id }, to: "ana@correo.mx", item: reserva };
    const { d, sent, calls } = deps({ team_reply_email_claim: { ok: true, ...c } });
    expect(await sendTeamReply(d, "r1")).toEqual({ email_status: "enviado", code: undefined });
    expect(sent[0].to).toBe("ana@correo.mx");
    expect(calls[1]).toMatchObject({ fn: "team_reply_email_finish", args: { _reply_id: "r1", _ok: true } });
    const none = deps({ team_reply_email_claim: { ok: false, code: "NO_EMAIL", email_status: "sin_correo" } });
    expect(await sendTeamReply(none.d, "r1")).toEqual({ email_status: "sin_correo", code: "NO_EMAIL" });
    expect(none.sent).toHaveLength(0);
  });

  it("reintento: manda lo pendiente de los dos tipos y cuenta lo que falló", async () => {
    const c: ReplyClaim = { reply: { id: "r2", kind: "resuelta", body: "Listo", source: "concierge_request", source_id: reserva.id }, to: "ana@correo.mx", item: reserva };
    const { d, sent } = deps({ ops_owner_alerts_due: [reserva], team_reply_emails_due: [c] });
    const out = await retryOpsEmails(d);
    expect(out).toEqual({ owner: { sent: 1, failed: 0 }, replies: { sent: 1, failed: 0 }, errors: [] });
    expect(sent.map((s) => s.to)).toEqual([["hola@traveliatos.life", "carlo@traveliatos.life"], "ana@correo.mx"]);
  });
});

describe("honestidad de Iato al crear una solicitud humana", () => {
  const ctx = { todayISO: "2026-10-28", trips: [], activeTripId: null };
  const run = (human_notified: boolean) => executeAction("fixer_request", { tipo: "reservation", titulo: "Mesa en Contramar", personas: 4 }, ctx, {
    userId: "u1", db: {},
    callFunction: async () => ({ status: 200, json: { ok: true, request: { id: "abcdef12-3456-4000-8000-000000000000", status: "solicitado" }, human_notified } }),
  });

  it("dice que la atiende una persona del equipo IATOS, que verá la respuesta en la app y por correo, sin tiempos", async () => {
    for (const notified of [true, false]) {
      const r = await run(notified);
      expect(r.message).toMatch(/una persona del equipo IATOS/);
      expect(r.message).toMatch(/en la app/);
      expect(r.message).toMatch(/por correo/);
      expect(r.message).toMatch(/Aún no está reservado/);
      expect(r.message).not.toMatch(/\b\d+\s*(minutos|min|horas)\b|en breve|pronto|enseguida/i);
      expect(r.link).toBe("/dashboard/concierge?tab=solicitudes");
    }
  });

  it("la tarjeta de confirmación y la regla del prompt dicen lo mismo y prohíben prometer tiempos", () => {
    const v = validateAction("fixer_request", { tipo: "reservation", titulo: "Mesa en Contramar" }, ctx);
    expect(v.ok && v.action.note).toMatch(/persona del equipo IATOS.*en la app y por correo/);
    expect(FIXER_RULE).toMatch(/en la app .*y por correo/);
    expect(FIXER_RULE).toMatch(/no prometas tiempos/);
    expect(FIXER_RULE).toMatch(/en 5 minutos/);
  });
});
