// Doble en memoria de las RPC de 20261029090000_reclamos.sql (lo usan derechosServicio y el operador IA).
// Sacado tal cual de src/test/derechosServicio.test.ts para compartirlo (misma forma de respuesta que la base).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;
const TRANS: Record<string, string[]> = {
  esperando_ok: ["enviando", "enviado", "cancelado"], enviando: ["enviado", "fallido", "esperando_ok"], fallido: ["esperando_ok", "enviando", "cancelado"],
  enviado: ["recordado", "respondido", "necesita_usuario", "escalable", "resuelto", "cerrado", "cancelado"],
  recordado: ["respondido", "necesita_usuario", "escalable", "resuelto", "cerrado", "cancelado"],
  respondido: ["necesita_usuario", "escalable", "resuelto", "cerrado", "enviado"],
  necesita_usuario: ["enviado", "respondido", "escalable", "resuelto", "cerrado", "cancelado"],
  escalable: ["escalado", "resuelto", "cerrado", "necesita_usuario"], escalado: ["resuelto", "cerrado"],
};

/** Doble en memoria de las RPC de 20261029090000_reclamos.sql (misma forma de respuesta). */
export function fakeClaimsDb(state: { flag: boolean; now: () => Date }) {
  const claims = new Map<string, Row>();
  const inbound = new Map<string, Row>();
  const events: Row[] = [];
  const forward: Row[] = [];
  const tokens = new Map<string, string>();
  let seq = 0;
  const pub = (c: Row) => { const { reply_token: _t, send_lock_at: _l, ...r } = c; return { ...r }; };
  const move = (c: Row, to: string, actor: string, note = "") => {
    if (c.status === to) return true;
    if (!TRANS[c.status]?.includes(to)) return false;
    events.push({ claim_id: c.id, from: c.status, to, actor, note });
    c.status = to;
    return true;
  };
  const days = (n: number) => new Date(state.now().getTime() + n * 86_400_000).toISOString();
  const rpc = async (fn: string, a: Row = {}): Promise<{ data: any; error: null | { message: string } }> => {
    switch (fn) {
      case "claim_create": {
        const p = a._p;
        if (p.recipient_email && !p.recipient_source?.kind) return { data: { ok: false, code: "INVALID" }, error: null };
        if (p.channel === "correo" && !p.recipient_email) return { data: { ok: false, code: "INVALID" }, error: null };
        const id = `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
        const c: Row = { id, user_id: a._user_id, status: "esperando_ok", ref_code: `C-TEST${String(seq).padStart(2, "0")}`, reply_token: String(seq).padStart(24, "a"),
          reminders_sent: 0, sent_at: null, reply: null, incident_id: null, created_at: state.now().toISOString(), ...p };
        claims.set(id, c);
        events.push({ claim_id: id, to: "esperando_ok" });
        return { data: { ok: true, claim: pub(c) }, error: null };
      }
      case "claim_set_text": {
        const c = claims.get(a._id);
        if (!c || c.user_id !== a._user_id || c.status !== "esperando_ok") return { data: { ok: false, code: "ALREADY_SENT" }, error: null };
        Object.assign(c, { subject: a._subject, body_text: a._body_text, body_html: a._body_html });
        return { data: { ok: true, claim: pub(c) }, error: null };
      }
      case "claim_set_incident": { const c = claims.get(a._id); if (c && !c.incident_id) c.incident_id = a._incident_id; return { data: null, error: null }; }
      case "claim_claim_send": {
        if (!state.flag) return { data: { ok: false, code: "FEATURE_DISABLED" }, error: null };
        if (a._consent?.confirmed !== true) return { data: { ok: false, code: "CONSENT_REQUIRED" }, error: null };
        const c = claims.get(a._id);
        if (!c || c.user_id !== a._user_id) return { data: { ok: false, code: "NOT_FOUND" }, error: null };
        if (c.channel !== "correo") return { data: { ok: false, code: "NO_EMAIL" }, error: null };
        if (!["esperando_ok", "fallido"].includes(c.status)) return { data: { ok: false, code: "ALREADY_SENT" }, error: null };
        move(c, "enviando", "usuario");
        c.consent = { ...a._consent, via: "iatos", at: state.now().toISOString() };
        return { data: { ok: true, claim: pub(c), reply_token: c.reply_token }, error: null };
      }
      case "claim_mark_sent": {
        const c = claims.get(a._id)!;
        if (a._kind === "envio") {
          if (a._ok) { move(c, "enviado", "sistema"); c.sent_at = state.now().toISOString(); c.followup_at = days(c.response_days + 2); c.escalate_after = days(c.escalate_days); }
          else move(c, "fallido", "sistema");
        } else events.push({ claim_id: c.id, kind: a._kind, ok: a._ok });
        return { data: { ok: true, claim: pub(c) }, error: null };
      }
      case "claim_mark_user_sent": {
        const c = claims.get(a._id);
        if (!c || c.user_id !== a._user_id) return { data: { ok: false, code: "NOT_FOUND" }, error: null };
        if (!move(c, "enviado", "usuario")) return { data: { ok: false, code: "ILLEGAL_TRANSITION" }, error: null };
        c.sent_at = state.now().toISOString(); c.consent = { via: "usuario", case_number: a._case_number }; c.escalate_after = days(c.escalate_days);
        return { data: { ok: true, claim: pub(c) }, error: null };
      }
      case "claim_transition": {
        const c = claims.get(a._id);
        if (!c || (a._user_id && c.user_id !== a._user_id)) return { data: { ok: false, code: "NOT_FOUND" }, error: null };
        if (c.status === a._to) return { data: { ok: true, noop: true, claim: pub(c) }, error: null };
        const prev = c.status;
        if (!move(c, a._to, a._actor, a._note)) return { data: { ok: false, code: "ILLEGAL_TRANSITION" }, error: null };
        return { data: { ok: true, prev_status: prev, claim: pub(c) }, error: null };
      }
      case "claim_list_for_user":
        return { data: [...claims.values()].filter((c) => c.user_id === a._user_id && (!a._id || c.id === a._id)).map(pub), error: null };
      case "claim_due": {
        const now = state.now().toISOString();
        return { data: [...claims.values()].filter((c) => ["enviado", "recordado"].includes(c.status) && ((c.channel === "correo" && c.reminders_sent === 0 && c.followup_at <= now) || c.escalate_after <= now))
          .map((c) => ({ ...pub(c), reply_token: c.reply_token, due: c.escalate_after <= now ? "escalar" : "recordar" })), error: null };
      }
      case "claim_claim_reminder": {
        const c = claims.get(a._id);
        if (!state.flag || !c || c.status !== "enviado" || c.reminders_sent !== 0 || c.followup_at > state.now().toISOString()) return { data: null, error: null };
        c.reminders_sent = 1; move(c, "recordado", "sistema");
        return { data: { ...pub(c), reply_token: c.reply_token }, error: null };
      }
      case "claim_inbound_claim": {
        const prev = inbound.get(a._event_id);
        if (prev && prev.status !== "failed") return { data: { state: "duplicate" }, error: null };
        let user: string | null = null; let c: Row | null = null;
        if (a._kind === "reclamo") { c = [...claims.values()].find((x) => x.reply_token === a._token) ?? null; user = c?.user_id ?? null; }
        else user = [...tokens.entries()].find(([, t]) => t === a._token)?.[0] ?? null;
        if (!user) return { data: { state: "unmatched" }, error: null };
        const id = `in-${inbound.size + 1}`;
        inbound.set(a._event_id, { id, status: "processing", claim_id: c?.id ?? null });
        return { data: { state: "new", inbound_id: id, user_id: user, claim: c ? { ...pub(c), recipient_email: c.recipient_email } : null }, error: null };
      }
      case "claim_inbound_attach": {
        const mid = a._e?.message_id;
        if (mid && [...inbound.values()].some((x) => x.message_id === mid && x.id !== a._inbound_id)) return { data: { ok: true, duplicate: true }, error: null };
        const r = [...inbound.values()].find((x) => x.id === a._inbound_id)!; r.message_id = mid; r.evidence = a._e;
        return { data: { ok: true }, error: null };
      }
      case "claim_inbound_finish": { const r = [...inbound.values()].find((x) => x.id === a._inbound_id); if (r) Object.assign(r, { status: a._status, outcome: a._outcome }); return { data: null, error: null }; }
      case "claim_apply_reply": {
        const c = claims.get(a._id)!;
        const to = ["respondido", "necesita_usuario", "escalable"].includes(a._d.estado_sugerido) ? a._d.estado_sugerido : "necesita_usuario";
        if (["enviado", "recordado", "respondido", "necesita_usuario"].includes(c.status)) move(c, to, "proveedor");
        c.reply = a._d; c.last_reply_at = state.now().toISOString();
        const r = [...inbound.values()].find((x) => x.id === a._inbound_id); if (r) r.status = "done";
        return { data: { ok: true, claim: pub(c) }, error: null };
      }
      case "claim_forward_token": { if (!tokens.has(a._user_id)) tokens.set(a._user_id, "f".repeat(24)); return { data: tokens.get(a._user_id), error: null }; }
      case "claim_store_forward": {
        const ref = /C-[A-Z0-9]{6}/.exec(`${a._p.subject} ${a._p.text}`)?.[0];
        const c = ref ? [...claims.values()].find((x) => x.ref_code === ref && x.user_id === a._user_id) : null;
        forward.push({ user_id: a._user_id, claim_id: c?.id ?? null, ...a._p });
        return { data: { ok: true, claim_id: c?.id ?? null, ref }, error: null };
      }
      default: throw new Error(`RPC sin doble: ${fn}`);
    }
  };
  return { rpc, claims, inbound, events, forward, tokens };
}
