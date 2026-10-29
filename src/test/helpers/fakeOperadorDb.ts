// Doble en memoria de las RPC del operador (migración 20261029100000_operador) sobre la base falsa de incidentes:
// bandera, candado por incidente, marca de agua, despertar con cada mensaje entrante, topes (acciones, gasto, UNA
// búsqueda de vuelos, correos), consentimiento solo de un mensaje real del viajero y cola de correos con fuente.
// La lógica real está en SQL (supabase/tests/operador); aquí solo lo necesario para probar el TypeScript.
import { createFakeIncidentDb, type FakeIncident } from "./fakeIncidentDb";

type Case = {
  state: string; lockOwner: string | null; lockedUntil: number | null; lastEventId: number; wakeAt: number | null; followUpAt: number | null;
  lastRunAt: number | null; runs: number; actions: number; spend: number; flights: number; emails: number;
  consents: Record<string, { event_id: number; at: string }>; pending: Record<string, unknown> | null; summary: string | null;
};
export type FakeOutbox = {
  id: string; requestId: string; provider: string; to: string; source: Record<string, unknown>; subject: string; body: string; tz: string | null;
  sendAfter: number; token: string; status: string; dedupe: string; providerId?: string | null;
};

export const LIMITES = { max_actions: 25, max_spend_usd: 0.8, max_flight_searches: 1, max_provider_emails: 3, lock_seconds: 120 };

export function createFakeOperadorDb(opts: { start?: Date; enabled?: boolean; limites?: Partial<typeof LIMITES> } = {}) {
  const db = createFakeIncidentDb({ start: opts.start, operatorAlive: true });
  const lim = { ...LIMITES, ...(opts.limites ?? {}) };
  let enabled = opts.enabled ?? true;
  const cases = new Map<string, Case>();
  const outbox: FakeOutbox[] = [];
  let seq = 0;
  const now = () => db.now().getTime();
  const getCase = (id: string) => {
    let c = cases.get(id);
    if (!c) {
      c = { state: "nuevo", lockOwner: null, lockedUntil: null, lastEventId: 0, wakeAt: null, followUpAt: null, lastRunAt: null, runs: 0, actions: 0,
        spend: 0, flights: 0, emails: 0, consents: {}, pending: null, summary: null };
      cases.set(id, c);
    }
    return c;
  };
  // Despertar: cada mensaje entrante del viajero o del proveedor.
  db.onEvent((i, e) => {
    if (e.direction === "entrante" && (e.actor === "usuario" || e.actor === "proveedor")) {
      const c = getCase(i.id);
      c.wakeAt = now();
      if (c.state === "esperando_usuario" || c.state === "esperando_proveedor") c.state = "activo";
    }
  });
  const open = (i: FakeIncident) => i.assignee === "iato_ops" && i.resolvedAt === null && ["solicitado", "pendiente_confirmacion"].includes(i.status);
  const evJson = (i: FakeIncident) => i.events.slice(-60).map((e) => ({ id: e.id!, at: new Date(e.at).toISOString(), kind: e.kind, actor: e.actor, channel: e.channel ?? null,
    direction: e.direction ?? null, counterpart: e.counterpart ?? null, body: e.body ?? null, visible: e.visible === true, data: e.data ?? {} }));
  const locked = (c: Case, owner: string) => c.lockOwner === owner && c.lockedUntil !== null;

  const h = db.handlers;
  h.operator_enabled = () => enabled;
  h.operator_due = (a) => {
    if (!enabled) return [];
    const out: { id: string; reason: string }[] = [];
    for (const i of db.incidents.values()) {
      if (!open(i)) continue;
      const c = cases.get(i.id);
      if (c && ["detenido", "cerrado", "con_humano"].includes(c.state)) continue;
      if (c?.lockedUntil && c.lockedUntil > now()) continue;
      const reason = !c || !c.lastRunAt ? "nuevo"
        : i.events.some((e) => e.id! > c.lastEventId && e.direction === "entrante" && (e.actor === "usuario" || e.actor === "proveedor")) ? "mensaje"
        : c.wakeAt && c.wakeAt > c.lastRunAt ? "despertado"
        : c.followUpAt && c.followUpAt <= now() ? "seguimiento" : null;
      if (reason) out.push({ id: i.id, reason });
    }
    return out.slice(0, Number(a._limit ?? 10));
  };
  h.operator_claim = (a) => {
    if (!enabled) return { ok: false, code: "DISABLED" };
    const i = db.incidents.get(String(a._id));
    if (!i) return { ok: false, code: "NOT_FOUND" };
    if (!open(i)) { const c = cases.get(i.id); if (c) c.state = i.resolvedAt ? "cerrado" : "con_humano"; return { ok: false, code: "NOT_MINE" }; }
    const c = getCase(i.id);
    if (["detenido", "cerrado"].includes(c.state)) return { ok: false, code: "STOPPED" };
    if (c.lockedUntil && c.lockedUntil > now() && c.lockOwner !== a._owner) return { ok: false, code: "LOCKED" };
    c.lockOwner = String(a._owner); c.lockedUntil = now() + lim.lock_seconds * 1000;
    if (c.state === "nuevo") c.state = "activo";
    return {
      ok: true,
      case: { state: c.state, last_event_id: c.lastEventId, runs: c.runs, actions: c.actions, spend_usd: c.spend, flight_searches: c.flights,
        provider_emails: c.emails, consents: { ...c.consents }, pending: c.pending, summary: c.summary,
        follow_up_at: c.followUpAt ? new Date(c.followUpAt).toISOString() : null, last_run_at: c.lastRunAt ? new Date(c.lastRunAt).toISOString() : null },
      limits: { ...lim },
      incident: { id: i.id, user_id: i.userId, trip_id: null, title: i.title, payload: i.payload, category: i.categoria, severity: i.severidad, origin: "usuario",
        escalation_level: i.level, received_at: new Date(i.receivedAt).toISOString(), next_step: i.nextStep, next_step_due_at: new Date(i.due).toISOString(), reopen_count: 0 },
      events: evJson(i),
    };
  };
  h.operator_spend = (a) => {
    const c = cases.get(String(a._id));
    if (!c || !locked(c, String(a._owner))) return { ok: false, code: "NOT_LOCKED" };
    const v = Number(a._amount ?? 1);
    switch (a._kind) {
      case "accion": if (c.actions + 1 > lim.max_actions) return { ok: false, code: "CAP_ACCIONES" }; c.actions++; break;
      case "modelo": if (c.spend + v > lim.max_spend_usd) return { ok: false, code: "CAP_GASTO" }; c.spend += v; break;
      case "vuelos": if (c.flights + 1 > lim.max_flight_searches) return { ok: false, code: "CAP_BUSQUEDA" }; c.flights++; break;
      case "correo_proveedor": if (c.emails + 1 > lim.max_provider_emails) return { ok: false, code: "CAP_CORREOS" }; c.emails++; break;
      default: return { ok: false, code: "BAD_KIND" };
    }
    return { ok: true };
  };
  h.operator_consent = (a) => {
    const c = cases.get(String(a._id));
    if (!c || !locked(c, String(a._owner))) return { ok: false, code: "NOT_LOCKED" };
    const i = db.incidents.get(String(a._id))!;
    const e = i.events.find((x) => x.id === Number(a._event_id));
    if (!e || e.actor !== "usuario" || e.direction !== "entrante" || !["mensaje", "creado"].includes(e.kind)) return { ok: false, code: "NOT_USER_MESSAGE" };
    if (a._must_contain && !String(e.body ?? "").toLowerCase().includes(String(a._must_contain).toLowerCase())) return { ok: false, code: "TEXT_MISSING" };
    c.consents[String(a._kind)] = { event_id: e.id!, at: new Date(e.at).toISOString() };
    return { ok: true, event_id: e.id };
  };
  h.operator_release = (a) => {
    const c = cases.get(String(a._id));
    if (!c || c.lockOwner !== a._owner) return { ok: false, code: "NOT_LOCKED" };
    const p = (a._patch ?? {}) as Record<string, unknown>;
    c.lockOwner = null; c.lockedUntil = null; c.lastRunAt = now(); c.runs++;
    c.lastEventId = Math.max(c.lastEventId, Number(p.last_event_id ?? 0));
    if (p.state) c.state = String(p.state);
    if ("follow_up_at" in p) c.followUpAt = p.follow_up_at ? Date.parse(String(p.follow_up_at)) : null;
    if ("summary" in p) c.summary = String(p.summary ?? "");
    if ("pending" in p) c.pending = (p.pending as Record<string, unknown>) ?? null;
    return { ok: true };
  };
  h.operator_outbox_add = (a) => {
    const c = cases.get(String(a._id));
    if (!c || !locked(c, String(a._owner))) return { ok: false, code: "NOT_LOCKED" };
    const o = a._o as Record<string, unknown>;
    const src = (o.source ?? {}) as Record<string, unknown>;
    const kinds = ["sitio_oficial", "directorio", "reserva", "correo_del_proveedor", "mensaje_usuario"];
    if (!kinds.includes(String(src.kind)) || !(src.url || src.event_id || src.booking)) return { ok: false, code: "INVALID" };
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(String(o.to_email))) return { ok: false, code: "INVALID" };
    if (src.kind === "mensaje_usuario") {
      const i = db.incidents.get(String(a._id))!;
      const e = i.events.find((x) => String(x.id) === String(src.event_id));
      if (!e || e.actor !== "usuario" || !String(e.body ?? "").toLowerCase().includes(String(o.to_email).toLowerCase())) return { ok: false, code: "SOURCE_NOT_FOUND" };
    }
    const dedupe = String(o.dedupe_key);
    if (outbox.some((x) => x.requestId === a._id && x.dedupe === dedupe)) return { ok: true, duplicate: true };
    const sendAfter = Math.max(now(), Date.parse(String(o.send_after ?? new Date(now()).toISOString())));
    const r: FakeOutbox = { id: `ob-${++seq}`, requestId: String(a._id), provider: String(o.provider_name), to: String(o.to_email).toLowerCase(), source: src,
      subject: String(o.subject), body: String(o.body), tz: (o.provider_tz as string) ?? null, sendAfter, token: String(seq).padStart(24, "f"), status: "programado", dedupe };
    outbox.push(r);
    return { ok: true, id: r.id, reply_token: r.token, send_after: new Date(sendAfter).toISOString() };
  };
  h.operator_outbox_due = () => {
    if (!enabled) return [];
    return outbox.filter((o) => o.status === "programado" && o.sendAfter <= now()).map((o) => {
      o.status = "enviando";
      return { id: o.id, request_id: o.requestId, provider_name: o.provider, to_email: o.to, source: o.source, subject: o.subject, body: o.body, reply_token: o.token };
    });
  };
  h.operator_outbox_finish = (a) => {
    const o = outbox.find((x) => x.id === a._out_id && x.status === "enviando");
    if (!o) return { ok: false, code: "NOT_SENDING" };
    o.status = a._ok ? "enviado" : "fallido"; o.providerId = (a._provider_id as string) ?? null;
    db.log(db.incidents.get(o.requestId)!, { kind: "mensaje", actor: "iato_ops", channel: "email", direction: "saliente", body: `${o.subject}\n\n${o.body}`,
      counterpart: `${o.provider} <${o.to}>`, delivery: a._ok ? "enviado" : "fallido", data: { operador: { herramienta: "escribir_proveedor", fuente: o.source, outbox_id: o.id } } });
    return { ok: true, status: o.status };
  };
  h.operator_outbox_by_token = (a) => {
    const o = outbox.find((x) => x.token === a._token);
    return o ? { ok: true, id: o.id, request_id: o.requestId, to_email: o.to, provider_name: o.provider, website: o.source.url ?? null } : null;
  };
  h.incident_open_for_user = (a) => [...db.incidents.values()].filter((i) => i.userId === a._user && i.resolvedAt === null).at(-1)?.id ?? null;

  return Object.assign(db, {
    cases, outbox, limites: lim,
    setEnabled(v: boolean) { enabled = v; },
    /** El viajero escribe en su caso desde la app (my_incident_message). */
    userMessage(id: string, text: string) {
      const i = db.incidents.get(id)!;
      return db.log(i, { kind: "mensaje", actor: "usuario", channel: "app", direction: "entrante", body: text, visible: true });
    },
    /** Llega un correo del proveedor al caso. */
    providerMessage(id: string, text: string, from = "proveedor@example.test") {
      const i = db.incidents.get(id)!;
      return db.log(i, { kind: "mensaje", actor: "proveedor", channel: "email", direction: "entrante", body: text, counterpart: from });
    },
  });
}
export type FakeOperadorDb = ReturnType<typeof createFakeOperadorDb>;
