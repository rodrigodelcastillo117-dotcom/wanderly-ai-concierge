// Reservas IA de punta a punta con dobles (sin red ni Claude real): crear → confirmar envío →
// respuesta del restaurante (webhook firmado) → confirmación al usuario; idempotencia del webhook;
// cron; alternos; cancelación; Booking Bridge; y que con la bandera apagada NO sale nada.
// La base de datos falsa imita las reglas de las funciones SQL (las reales se prueban en
// supabase/tests/ai_reservations/ai_reservations.sql).
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/ai-reservations/replies.json";
import {
  cancelReservation, chooseAlternative, confirmSend, createIntent, handleInbound, icsForLink, icsUrl, reservationStatus, runCron,
  type ServiceDeps,
} from "../../supabase/functions/_shared/ai-reservations/service";
import { createIntentFromBridgeOffer } from "../../supabase/functions/_shared/ai-reservations/bridge";
import { canTransition, type AiReservationRow } from "../../supabase/functions/_shared/ai-reservations/core";
import { signSvix } from "../../supabase/functions/_shared/ai-reservations/signature";

const SECRET = "whsec_" + btoa("clave-de-prueba-de-32-bytes!!!!!");
const USER = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-11-01T18:00:00Z");

function fakeDb(flag: boolean) {
  const rows = new Map<string, AiReservationRow & Record<string, any>>();
  const inbound = new Map<string, { id: string; status: string; attempts: number; reservation_id: string | null; email_id: string }>();
  let n = 0;
  const state = { flag, rows, inbound, calls: [] as string[], attached: [] as Array<Record<string, any>>, applied: [] as Array<Record<string, any>> };
  const pub = (r: any) => { const { reply_token: _t, send_lock_at: _l, evidence: _e, ...p } = r; return p; };
  const move = (r: any, to: string) => {
    if (r.status !== to && !canTransition(r.status, to as never)) throw new Error(`ilegal ${r.status}→${to}`);
    r.status = to;
  };
  const handlers: Record<string, (a: any) => any> = {
    app_flag: () => state.flag,
    ai_reservation_limits: () => ({ reminder_after_hours: 24, expire_after_hours: 48, intent_ttl_hours: 72 }),
    ai_reservation_create_intent: ({ _user_id, _p }) => {
      if (!state.flag) return { ok: false, code: "FEATURE_DISABLED" };
      for (const r of rows.values()) if (_p.idempotency_key && r.idempotency_key === _p.idempotency_key) return { ok: true, replay: true, id: r.id, status: r.status, reservation: pub(r) };
      const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
      const v = _p.venue;
      const row: any = {
        id, user_id: _user_id, trip_id: _p.trip_id, ref_code: `R-ABC23${n}`, reply_token: `${String(n).padStart(2, "0")}${"ab".repeat(11)}`,
        venue_name: v.name, venue_place_id: v.place_id, venue_experience_id: v.experience_id, venue_address: v.address, venue_city: v.city,
        venue_country: v.country, venue_timezone: v.timezone, venue_email: v.email, venue_phone: v.phone, venue_website: v.website,
        venue_booking_url: v.booking_url, venue_maps_url: v.maps_url, venue_language: v.language, requested_local: _p.requested_local,
        requested_for: "2026-11-04T02:30:00Z", party_size: _p.party_size, customer_name: _p.customer.name, customer_email: _p.customer.email,
        customer_phone: _p.customer.phone, consent: null, notes: _p.notes, status: v.email ? "awaiting_user_ok" : "needs_user",
        reason: v.email ? null : "no_contact", user_options: _p.user_options, alternatives: null, chosen_alternative: null,
        confirmation_code: null, confirmation: null, venue_reply_excerpt: null, attempts: 0, sent_at: null, reminder_sent_at: null,
        venue_replied_at: null, confirmed_at: null, expires_at: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
        status_changed_at: NOW.toISOString(), idempotency_key: _p.idempotency_key, source: _p.source, bridge_offer_id: _p.bridge_offer_id, evidence: {},
      };
      rows.set(id, row);
      return { ok: true, id, status: row.status, reservation: pub(row) };
    },
    ai_reservation_claim_send: ({ _id, _user_id, _consent }) => {
      if (!state.flag) return { ok: false, code: "FEATURE_DISABLED" };
      const r = rows.get(_id);
      if (!r || r.user_id !== _user_id) return { ok: false, code: "NOT_FOUND" };
      if (r.status === "sent") return { ok: false, code: "ALREADY_SENT" };
      if (r.status !== "awaiting_user_ok") return { ok: false, code: "NOT_SENDABLE" };
      if (r.send_lock_at) return { ok: false, code: "IN_PROGRESS" };
      r.send_lock_at = NOW.toISOString();
      r.consent = { share_contact: _consent.share_contact, cc_user: _consent.cc_user, at: NOW.toISOString() };
      return { ok: true, reservation: { ...r } };
    },
    ai_reservation_claim_alternative: ({ _id, _user_id, _index }) => {
      const r = rows.get(_id);
      if (!r || r.user_id !== _user_id) return { ok: false, code: "NOT_FOUND" };
      if (r.status !== "needs_user" || r.reason !== "alternative_offered") return { ok: false, code: "NO_ALTERNATIVES" };
      const alt = r.alternatives?.[_index];
      if (!alt) return { ok: false, code: "BAD_INDEX" };
      r.requested_local = alt.local;
      r.chosen_alternative = { ...alt, index: _index };
      r.send_lock_at = NOW.toISOString();
      return { ok: true, held: alt.held === true && alt.verified_sender === true, reservation: { ...r } };
    },
    ai_reservation_mark_sent: ({ _id, _kind, _ok }) => {
      const r = rows.get(_id)!;
      state.calls.push(`mark:${_kind}:${_ok}`);
      if (_kind === "request" || _kind === "alternative") {
        r.send_lock_at = null;
        if (_ok) {
          const alt = r.chosen_alternative;
          if (_kind === "alternative" && alt?.held && alt.verified_sender) {
            move(r, "confirmed");
            r.confirmation = { channel: "venue_email", quote: alt.quote, inbound_email_id: alt.inbound_email_id, verified_sender: true };
          } else {
            move(r, "sent");
            r.sent_at = r.sent_at ?? NOW.toISOString();
            r.expires_at = "2026-11-03T18:00:00Z";
            r.reason = null;
          }
          r.attempts++;
        }
      }
      return { ok: true, status: r.status, reservation: pub(r) };
    },
    ai_reservation_inbound_claim: ({ _event_id, _email_id, _token }) => {
      const prev = [...inbound.values()].find((x) => x.id === _event_id || x.email_id === _email_id);
      if (prev) {
        if (prev.status === "failed") { prev.status = "processing"; prev.attempts++; return { ok: true, state: "retry", inbound_id: prev.id, reservation: { ...rows.get(prev.reservation_id!) } }; }
        return { ok: true, state: "duplicate" };
      }
      const r = [...rows.values()].find((x) => x.reply_token === _token);
      inbound.set(_event_id, { id: _event_id, email_id: _email_id, status: r ? "processing" : "unmatched", attempts: 1, reservation_id: r?.id ?? null });
      return r ? { ok: true, state: "new", inbound_id: _event_id, reservation: { ...r } } : { ok: true, state: "unmatched", inbound_id: _event_id };
    },
    ai_reservation_inbound_finish: ({ _inbound_id, _status }) => { inbound.get(_inbound_id)!.status = _status; return null; },
    // Evidencia del correo (AUD-06): el mismo Message-ID no se procesa dos veces aunque cambien el
    // id del evento de Svix y el email_id de Resend.
    ai_reservation_inbound_attach: ({ _inbound_id, _e }) => {
      const me = inbound.get(_inbound_id)! as any;
      state.attached.push({ inbound_id: _inbound_id, ..._e });
      const mid = String(_e.message_id ?? "").trim().toLowerCase();
      const dup = mid && [...inbound.values()].find((x: any) => x.id !== _inbound_id && x.message_id === mid);
      if (dup) { me.status = "duplicate"; return { ok: true, duplicate: true, duplicate_of: dup.id }; }
      me.message_id = mid || null;
      return { ok: true, duplicate: false };
    },
    ai_reservation_apply_reply: ({ _id, _inbound_id, _d }) => {
      const r = rows.get(_id)!;
      state.calls.push(`apply:${_d.outcome}`);
      state.applied.push(_d);
      if (!["sent", "venue_replied", "needs_user"].includes(r.status)) return { ok: false, code: "LATE", status: r.status };
      const to = ({ confirmed: "confirmed", alternative_offered: "needs_user", declined: "declined", needs_info: "needs_user", payment_required: "needs_user", unverified: "venue_replied", ambiguous: "venue_replied" } as Record<string, string>)[_d.outcome] ?? r.status;
      if (to === "confirmed" && !(_d.confirmation?.verified_sender && _d.confirmation?.quote)) throw new Error("CHECK ai_res_confirmed_has_evidence");
      move(r, to);
      if (_d.outcome === "alternative_offered") { r.reason = "alternative_offered"; r.alternatives = _d.alternatives; }
      if (_d.outcome === "confirmed") { r.confirmation = _d.confirmation; r.confirmation_code = _d.confirmation.code; r.confirmed_at = NOW.toISOString(); }
      if (_d.outcome !== "ignored") { r.venue_reply_excerpt = _d.excerpt; r.venue_replied_at = NOW.toISOString(); }
      inbound.get(_inbound_id)!.status = "done";
      return { ok: true, status: r.status, reservation: { ...r } };
    },
    ai_reservation_transition: ({ _id, _to, _actor, _user_id }) => {
      const r = rows.get(_id);
      if (!r || (_actor === "usuario" && r.user_id !== _user_id)) return { ok: false, code: "NOT_FOUND" };
      if (r.status === _to) return { ok: true, noop: true, status: r.status, prev_status: r.status };
      if (!canTransition(r.status, _to)) return { ok: false, code: "ILLEGAL_TRANSITION" };
      const prev = r.status;
      move(r, _to);
      return { ok: true, status: _to, prev_status: prev, notify_venue: _to === "cancelled" && !!r.sent_at, reservation: { ...r } };
    },
    ai_reservation_due: () => [...rows.values()].filter((r) => ["draft", "awaiting_user_ok", "sent", "venue_replied", "needs_user"].includes(r.status)).map((r) => ({ ...r })),
    ai_reservation_claim_reminder: ({ _id }) => {
      if (!state.flag) return null;
      const r = rows.get(_id)!;
      if (r.status !== "sent" || r.reminder_sent_at) return null;
      r.reminder_sent_at = NOW.toISOString();
      return { ...r };
    },
    ai_reservation_list_for_user: ({ _user_id, _id }) => [...rows.values()].filter((r) => r.user_id === _user_id && (!_id || r.id === _id)).map(pub),
  };
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      if (!handlers[fn]) throw new Error(`rpc desconocida ${fn}`);
      return { data: handlers[fn](args), error: null };
    }),
  };
  return { db, state };
}

const venueSite = `<html><body><a href="/contacto">Contacto</a></body></html>`;
const contactPage = `<html><body>Reservaciones: reservas@casaoaxaca.com.mx</body></html>`;

function setup(flag = true) {
  const { db, state } = fakeDb(flag);
  const sent: Array<Record<string, any>> = [];
  const model = vi.fn(async () => ({ ok: true, status: 200, data: fixtures.cases[0].claude }));
  const google = vi.fn(async () => ({
    displayName: { text: "Casa Oaxaca" }, websiteUri: "https://casaoaxaca.com.mx/", timeZone: { id: "America/Mexico_City" },
    internationalPhoneNumber: "+52 951 514 4173", addressComponents: [{ shortText: "MX", types: ["country"] }], businessStatus: "OPERATIONAL",
  }));
  const fetchPage = vi.fn(async (url: string) => ({ url, html: url.endsWith("/contacto") ? contactPage : venueSite }));
  // Forma real de GET /emails/receiving/{id} de Resend (campos que usamos).
  let received: Record<string, unknown> = {
    object: "email", id: "em_1", from: "Casa Oaxaca <reservas@casaoaxaca.com.mx>", subject: "Re: Solicitud", text: fixtures.cases[0].reply.text,
    html: null, authentication: { spf: "pass", dkim: "pass", dmarc: "pass" }, created_at: "2026-11-02T18:00:00Z",
    message_id: "<CAF1234@mail.casaoaxaca.com.mx>", reply_to: null, headers: { from: "Casa Oaxaca <reservas@casaoaxaca.com.mx>" },
    raw: { download_url: "https://inbound-raw.resend.test/em_1.eml?sig=x", expires_at: "2026-11-02T19:00:00Z" },
  };
  const deps: ServiceDeps = {
    db,
    sendEmail: vi.fn(async (m) => { sent.push(m); return { ok: true, id: `re_${sent.length}` }; }),
    callModel: model,
    contact: { googlePlace: google, fetchPage },
    profile: async () => ({ name: "Ana López", email: "ana@cliente.test" }),
    receivedEmail: vi.fn(async () => received),
    fetchRaw: vi.fn(async () => new TextEncoder().encode("From: reservas@casaoaxaca.com.mx\r\n\r\nCon gusto confirmamos").buffer as ArrayBuffer),
    config: { appUrl: "https://traveliatos.life/dashboard/reservas#reservas-ia", functionUrl: "https://fn.test/functions/v1/ai-reservations", linkSecret: "link-secret", inboundSecret: SECRET },
    now: () => NOW,
  };
  return { deps, state, sent, model, google, fetchPage, setReceived: (r: Record<string, unknown>) => { received = { ...received, ...r }; } };
}

const intent = { venue: { name: "Casa Oaxaca", place_id: "ChIJ_casaoaxaca_0001" }, datetime_local: "2026-11-03T20:30", party_size: 4 };

async function webhook(token: string, eventId = "msg_evt_1", emailId = "em_1", from = "reservas@casaoaxaca.com.mx") {
  const body = JSON.stringify({ type: "email.received", data: { email_id: emailId, from, to: [`reservas+${token}@reply.traveliatos.life`], subject: "Re: Solicitud · Ref R-ABC231" } });
  const ts = Math.floor(NOW.getTime() / 1000);
  const headers = new Headers({ "svix-id": eventId, "svix-timestamp": String(ts), "svix-signature": `v1,${await signSvix(SECRET, eventId, ts, body)}` });
  return { headers, body };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("flujo completo por correo", () => {
  it("crear → el usuario confirma → correo al restaurante con Reply-To único → confirmación escrita → correo al usuario con cita, .ics y mapa", async () => {
    const t = setup();
    const c = await createIntent(t.deps, USER, intent);
    expect(c.status).toBe(200);
    const res = c.body.reservation as Record<string, any>;
    expect(res).toMatchObject({ status: "awaiting_user_ok", venue_email: "reservas@casaoaxaca.com.mx", bridge_state: "READY_TO_BOOK" });
    expect(res).not.toHaveProperty("reply_token");
    expect(c.body.confirm_prompt).toBe("Confirmar: escribiremos a Casa Oaxaca en tu nombre");
    expect((c.body.preview as any).to).toBe("reservas@casaoaxaca.com.mx");
    expect(t.sent).toHaveLength(0); // crear la intención no escribe a nadie

    // Sin confirmación explícita no sale nada.
    expect((await confirmSend(t.deps, USER, { id: res.id })).body.code).toBe("CONSENT_REQUIRED");
    const s = await confirmSend(t.deps, USER, { id: res.id, confirm: true, consent: { share_contact: false, cc_me: true } });
    expect(s.status).toBe(200);
    expect((s.body.reservation as any).status).toBe("sent");
    const [venueMail, copy] = t.sent;
    expect(venueMail.to).toBe("reservas@casaoaxaca.com.mx");
    expect(venueMail.replyTo).toMatch(/^reservas\+[0-9a-f]{24}@reply\.traveliatos\.life$/);
    expect(venueMail.from).toBe("Ana López vía IATOS <reservas@traveliatos.life>");
    expect(venueMail.text).toContain("Ana López");
    expect(venueMail.text).not.toContain("ana@cliente.test"); // no compartió su contacto
    expect(copy.to).toBe("ana@cliente.test"); // copia aparte, solo porque la pidió
    // Doble toque: no se manda otra vez.
    expect((await confirmSend(t.deps, USER, { id: res.id, confirm: true, consent: {} })).body.code).toBe("ALREADY_SENT");
    expect(t.sent).toHaveLength(2);

    const token = t.state.rows.get(res.id)!.reply_token!;
    const w = await webhook(token);
    const r = await handleInbound(t.deps, w.headers, w.body);
    expect(r.body).toMatchObject({ ok: true, outcome: "confirmed", status: "confirmed" });
    const userMail = t.sent[2];
    expect(userMail.to).toBe("ana@cliente.test");
    expect(userMail.html).toContain("Con gusto confirmamos su reserva para 4 personas");
    expect(userMail.html).toContain("MX-4821");
    expect(userMail.text).toMatch(/Agregar al calendario \(\.ics\): https:\/\/fn\.test\/functions\/v1\/ai-reservations\?ics=/);
    expect(userMail.text).toContain("calendar.google.com");
    expect(userMail.text).toContain("google.com/maps/search");

    // El enlace .ics firmado funciona y no se puede alterar.
    const row = t.state.rows.get(res.id)!;
    const link = new URL((await icsUrl(t.deps, row))!);
    const ics = await icsForLink(t.deps, row.id, row.user_id, link.searchParams.get("sig"));
    expect(ics.status).toBe(200);
    expect(ics.body).toContain("BEGIN:VEVENT");
    expect((await icsForLink(t.deps, row.id, "22222222-2222-2222-2222-222222222222", link.searchParams.get("sig"))).status).toBe(403);
  });

  it("el mismo webhook dos veces se procesa una sola vez (un solo correo al usuario)", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: true, cc_me: false } });
    const w = await webhook(t.state.rows.get(id)!.reply_token!);
    const first = await handleInbound(t.deps, w.headers, w.body);
    const second = await handleInbound(t.deps, w.headers, w.body);
    expect(first.body.outcome).toBe("confirmed");
    expect(second.body).toMatchObject({ ok: true, duplicate: true });
    expect(t.model).toHaveBeenCalledTimes(1);
    expect(t.state.calls.filter((c) => c.startsWith("apply:"))).toHaveLength(1);
    expect(t.sent.filter((m) => m.to === "ana@cliente.test")).toHaveLength(1);
  });

  it("sin firma o firma inválida → 401 y no se toca la base", async () => {
    const t = setup();
    const w = await webhook("ab".repeat(12));
    expect((await handleInbound(t.deps, new Headers(), w.body)).status).toBe(401);
    expect((await handleInbound(t.deps, w.headers, w.body.replace("em_1", "em_9"))).status).toBe(401);
    expect(t.deps.db.rpc).not.toHaveBeenCalled();
    expect((await handleInbound({ ...t.deps, config: { ...t.deps.config, inboundSecret: undefined } }, w.headers, w.body)).status).toBe(503);
  });

  it("token desconocido → se acusa recibo sin clasificar ni avisar", async () => {
    const t = setup();
    const w = await webhook("cd".repeat(12));
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ unmatched: true });
    expect(t.model).not.toHaveBeenCalled();
  });

  it("si falla la descarga del correo responde 500 y el reintento de Resend sí se procesa", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
    const w = await webhook(t.state.rows.get(id)!.reply_token!);
    (t.deps.receivedEmail as any).mockResolvedValueOnce(null);
    expect((await handleInbound(t.deps, w.headers, w.body)).status).toBe(500);
    expect((await handleInbound(t.deps, w.headers, w.body)).body.outcome).toBe("confirmed");
  });

  it("'sí, pero a otra hora' → el usuario elige el alterno; si el restaurante ya lo apartó queda confirmado", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
    const alt = fixtures.cases.find((c) => c.name === "yes_different_time_en")!;
    t.model.mockResolvedValueOnce({ ok: true, status: 200, data: alt.claude });
    t.setReceived({ text: alt.reply.text });
    const w = await webhook(t.state.rows.get(id)!.reply_token!);
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "alternative_offered", status: "needs_user" });
    expect(t.sent.at(-1)!.subject).toContain("propone otro horario");
    const before = t.sent.length;
    const ch = await chooseAlternative(t.deps, USER, { id, index: 0 });
    expect((ch.body.reservation as any).status).toBe("confirmed");
    expect(t.sent[before].to).toBe("reservas@casaoaxaca.com.mx"); // se le avisa al restaurante que aceptamos
    expect(t.sent[before + 1].to).toBe("ana@cliente.test"); // y al usuario, con la cita como prueba
  });

  it("cancelar después de escribir al restaurante le manda un aviso de cancelación", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
    const r = await cancelReservation(t.deps, USER, { id });
    expect(r.body).toMatchObject({ ok: true, venue_notified: true });
    expect(t.sent.at(-1)!.subject).toMatch(/^Cancelación de la solicitud/);
    // Otro usuario no puede cancelarla.
    expect((await cancelReservation(t.deps, "33333333-3333-3333-3333-333333333333", { id })).body.code).toBe("NOT_FOUND");
  });

  it("sin correo verificable → needs_user con opciones y sin enviar nada", async () => {
    const t = setup();
    t.fetchPage.mockImplementation(async (url: string) => ({ url, html: "<html>Llámanos</html>" }));
    const c = await createIntent(t.deps, USER, intent);
    expect(c.body.reservation).toMatchObject({ status: "needs_user", reason: "no_contact", bridge_state: "FAILED" });
    expect((c.body.reservation as any).user_options).toMatchObject({ phone_url: "tel:+529515144173", fixer: true });
    expect(c.body.preview).toBeNull();
    expect(t.sent).toHaveLength(0);
  });
});

describe("cron", () => {
  it("un solo recordatorio al restaurante y luego vence con aviso al usuario; correr dos veces no duplica", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
    const row = t.state.rows.get(id)!;
    row.sent_at = "2026-10-31T17:00:00Z"; // hace 25 h
    row.expires_at = "2026-11-02T17:00:00Z";
    const a = await runCron(t.deps);
    const b = await runCron(t.deps);
    expect(a.body).toMatchObject({ reminded: 1, expired: 0 });
    expect(b.body).toMatchObject({ reminded: 0, expired: 0 });
    expect(t.sent.filter((m) => /^Recordatorio/.test(m.subject))).toHaveLength(1);
    t.deps.now = () => new Date("2026-11-02T17:00:01Z");
    expect((await runCron(t.deps)).body).toMatchObject({ expired: 1 });
    expect((await runCron(t.deps)).body).toMatchObject({ expired: 0 });
    expect(t.state.rows.get(id)!.status).toBe("expired");
    expect(t.sent.filter((m) => m.to === "ana@cliente.test" && /no respondió a tiempo/.test(m.subject))).toHaveLength(1);
  });
});

describe("bandera apagada (por defecto): nada se envía", () => {
  it("crear, confirmar, alterno, webhook y cron no mandan correos, no llaman a Claude, Google ni al sitio", async () => {
    const t = setup(false);
    expect((await createIntent(t.deps, USER, intent)).body).toMatchObject({ ok: false, code: "FEATURE_DISABLED" });
    expect((await confirmSend(t.deps, USER, { id: "00000000-0000-0000-0000-000000000001", confirm: true, consent: {} })).body.code).toBe("FEATURE_DISABLED");
    expect((await chooseAlternative(t.deps, USER, { id: "00000000-0000-0000-0000-000000000001", index: 0 })).body.code).toBe("FEATURE_DISABLED");
    const w = await webhook("ab".repeat(12));
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ ok: true, ignored: "disabled" });
    expect((await runCron(t.deps)).body).toMatchObject({ disabled: true });
    expect((await reservationStatus(t.deps, USER, {})).body).toMatchObject({ enabled: false, reservations: [] });
    expect(t.deps.sendEmail).not.toHaveBeenCalled();
    expect(t.model).not.toHaveBeenCalled();
    expect(t.google).not.toHaveBeenCalled();
    expect(t.fetchPage).not.toHaveBeenCalled();
  });

  it("si se apaga con una reserva enviada, cancelar no escribe al restaurante y lo dice", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
    t.state.flag = false;
    const n = t.sent.length;
    const r = await cancelReservation(t.deps, USER, { id });
    expect(r.body).toMatchObject({ ok: true, venue_notified: false });
    expect(String(r.body.message)).toMatch(/avísales tú/);
    expect(t.sent).toHaveLength(n);
  });
});

describe("Booking Bridge", () => {
  it("una oferta REQUEST crea la intención (idempotente por offer_id) y nunca nace confirmada", async () => {
    const t = setup();
    const offer = {
      offer_id: "off_123", product_type: "restaurant" as const, provider: "google_places", provider_offer_id: "ChIJ_casaoaxaca_0001",
      venue: { name: "Casa Oaxaca" }, datetime_local: "2026-11-03T20:30", traveler_count: 4, language: "es", restrictions: "Una persona celíaca", trip_id: null,
    };
    const a = await createIntentFromBridgeOffer(t.deps, USER, offer);
    const b = await createIntentFromBridgeOffer(t.deps, USER, offer);
    expect(a.body.reservation).toMatchObject({ source: "booking_bridge", bridge_offer_id: "off_123", bridge_state: "READY_TO_BOOK", notes: "Una persona celíaca" });
    expect(b.body.replay).toBe(true);
    expect((b.body.reservation as any).id).toBe((a.body.reservation as any).id);
    expect(t.sent).toHaveLength(0);
  });
});

async function sentReservation(t: ReturnType<typeof setup>) {
  const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
  await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
  return { id, token: t.state.rows.get(id)!.reply_token! };
}

describe("AUD-02 · remitente de la respuesta, de punta a punta", () => {
  it("respuesta en nuestro hilo (token correcto) pero de otro remitente con DMARC pass → unverified, nunca confirmed", async () => {
    const t = setup();
    const { id, token } = await sentReservation(t);
    t.setReceived({ from: "Reservas <reservas@casaoaxaca-mx.com>", headers: { from: "Reservas <reservas@casaoaxaca-mx.com>" } });
    const w = await webhook(token, "msg_evt_1", "em_1", "reservas@casaoaxaca-mx.com");
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "unverified", status: "venue_replied" });
    expect(t.state.rows.get(id)!.status).toBe("venue_replied");
  });
  it("el From del webhook y el del correo descargado no coinciden → unverified", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    const w = await webhook(token, "msg_evt_1", "em_1", "atacante@evil.test");
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "unverified" });
  });
  it("el encabezado From crudo (headers.from) no coincide con el From que reporta Resend → unverified", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    t.setReceived({ headers: { from: '"reservas@casaoaxaca.com.mx"@evil.test' } });
    const w = await webhook(token);
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "unverified" });
  });
  it("Reply-To distinto no cambia nada: se verifica el From (y el Reply-To del atacante no sirve para falsificar)", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    t.setReceived({ reply_to: ["atacante@evil.test"] });
    const w = await webhook(token);
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "confirmed" });
    const t2 = setup();
    const s2 = await sentReservation(t2);
    t2.setReceived({ from: "atacante@evil.test", headers: { from: "atacante@evil.test" }, reply_to: ["reservas@casaoaxaca.com.mx"] });
    const w2 = await webhook(s2.token, "msg_evt_1", "em_1", "atacante@evil.test");
    expect((await handleInbound(t2.deps, w2.headers, w2.body)).body).toMatchObject({ outcome: "unverified" });
  });
  it("Resend sin bloque de autenticación (authentication: null) → unverified", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    t.setReceived({ authentication: null });
    const w = await webhook(token);
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "unverified" });
  });
  it("SPF y DKIM pass con DMARC fail (d= de otro dominio) → unverified", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    t.setReceived({ authentication: { spf: "pass", dkim: "pass", dmarc: "fail" } });
    const w = await webhook(token);
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "unverified" });
  });
});

describe("AUD-06 · evidencia y repetición", () => {
  it("el mismo Message-ID con otro evento de Svix y otro email_id no se procesa dos veces", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    const a = await webhook(token, "msg_evt_1", "em_1");
    const b = await webhook(token, "msg_evt_2", "em_2");
    expect((await handleInbound(t.deps, a.headers, a.body)).body).toMatchObject({ outcome: "confirmed" });
    expect((await handleInbound(t.deps, b.headers, b.body)).body).toMatchObject({ ok: true, duplicate: true });
    expect(t.model).toHaveBeenCalledTimes(1);
    expect(t.state.calls.filter((c) => c.startsWith("apply:"))).toHaveLength(1);
  });
  it("se guarda la identidad del proveedor, el Message-ID, las huellas del correo, la autenticación y la ligadura con la solicitud", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    const w = await webhook(token);
    await handleInbound(t.deps, w.headers, w.body);
    const e = t.state.attached[0];
    expect(e).toMatchObject({
      provider: "resend", provider_email_id: "em_1", message_id: "<CAF1234@mail.casaoaxaca.com.mx>",
      received_at: "2026-11-02T18:00:00Z", from_address: "reservas@casaoaxaca.com.mx",
      auth: { spf: "pass", dkim: "pass", dmarc: "pass" }, linkage: { method: "reply_token" },
      sender: { verified: true, basis: "dmarc_aligned" }, raw_pointer: "resend:emails/receiving/em_1",
    });
    expect(e.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.raw_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.reply_text).toContain("Con gusto confirmamos su reserva para 4 personas");
  });
  it("la decisión guarda la salida del clasificador con el modelo, las reglas y el id del correo recibido", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    const w = await webhook(token);
    await handleInbound(t.deps, w.headers, w.body);
    const d = t.state.applied[0];
    expect(d.log).toMatchObject({ model: "claude-sonnet-5-5", rules_version: expect.any(String), classifier: { outcome: "confirmed" } });
    expect(d.confirmation).toMatchObject({ inbound_id: "msg_evt_1", inbound_email_id: "em_1", contradictions: [],
      conditions: { date: { basis: "stated" }, time: { basis: "stated" }, party_size: { basis: "stated" }, name: { basis: "stated" } } });
  });
  it("sin Message-ID ni fecha de recepción del proveedor no hay confirmación (queda para revisión)", async () => {
    const t = setup();
    const { token } = await sentReservation(t);
    t.setReceived({ message_id: null });
    const w = await webhook(token);
    expect((await handleInbound(t.deps, w.headers, w.body)).body).toMatchObject({ outcome: "ambiguous", why: "evidence_incomplete" });
  });
});
