// [A2] Copia del arnés de aiReservationsService.test.ts (segunda auditoría). Ronda r2: convertida en
// prueba de REGRESIÓN de A2-RES-02 (antes documentaba el defecto). Reservas IA de punta a punta con dobles (sin red ni Claude real): crear → confirmar envío →
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

const lyingClaude = (quote: string) => ({
  stop_reason: "tool_use", model: "claude-test-model",
  content: [{ type: "tool_use", name: "record_reply_classification", input: {
    outcome: "confirmed", automatic_reply: false, booking_held: true, stated_date: null, stated_time: null, stated_party_size: null,
    stated_name: null, confirmation_code: null, alternatives: [], info_requested: null, requires_payment_or_card: false,
    evidence_quotes: [quote], reply_language: "es", summary_es: "El restaurante confirmó.",
  } }],
});

describe("A2 · correo al usuario 'confirmó tu reserva por escrito' con una respuesta que dice lo contrario", () => {
  for (const reply of ["Su reserva aún no está confirmada.", "Your reservation is not confirmed yet.", "Sua reserva não está confirmada."]) {
    it(`A2-RES-02 (P2): "${reply}" (en nuestro hilo, citando la solicitud) → NO confirmed y ningún correo de confirmación al usuario`, async () => {
      const t = setup();
      const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
      await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
      const venueMail = t.sent[0];
      const text = `${reply}\n\nEl lun, 2 nov 2026 a las 10:02, Ana López vía IATOS <reservas@traveliatos.life> escribió:\n` +
        venueMail.text.split("\n").map((l: string) => `> ${l}`).join("\n");
      t.setReceived({ text });
      t.model.mockResolvedValue({ ok: true, status: 200, data: lyingClaude(reply) } as never);
      const w = await webhook(t.state.rows.get(id)!.reply_token!);
      const r = await handleInbound(t.deps, w.headers, w.body);
      expect(r.body).toMatchObject({ ok: true, outcome: "ambiguous", status: "venue_replied" });
      expect(String(r.body.why)).toMatch(/hedge_negated_confirmation/);
      expect(t.state.rows.get(id)!.status).toBe("venue_replied");
      for (const m of t.sent) {
        expect(m.subject).not.toMatch(/^Reserva confirmada/);
        expect(String(m.html)).not.toContain("confirmó tu reserva por escrito");
      }
    });
  }
});

describe("A2-RES-02 · defensa en profundidad: el correo 'confirmó tu reserva' depende de lo que dejó la base", () => {
  it("si TypeScript decide confirmed pero la base no deja la reserva en confirmed, no sale el correo de confirmación", async () => {
    const t = setup();
    const id = ((await createIntent(t.deps, USER, intent)).body.reservation as any).id;
    await confirmSend(t.deps, USER, { id, confirm: true, consent: { share_contact: false, cc_me: false } });
    // La base (trigger de evidencia) no acepta la transición: la reserva queda en venue_replied.
    const rpc = t.deps.db.rpc;
    t.deps.db.rpc = (async (fn: string, args?: Record<string, unknown>) => {
      if (fn !== "ai_reservation_apply_reply") return rpc(fn, args);
      const r = t.state.rows.get(id)!;
      r.status = "venue_replied";
      return { data: { ok: true, status: "venue_replied", reservation: { ...r } }, error: null };
    }) as typeof rpc;
    const w = await webhook(t.state.rows.get(id)!.reply_token!);
    const r = await handleInbound(t.deps, w.headers, w.body);
    expect(r.body).toMatchObject({ ok: true, outcome: "confirmed", status: "venue_replied" });
    for (const m of t.sent) expect(m.subject).not.toMatch(/^Reserva confirmada/);
  });
});

