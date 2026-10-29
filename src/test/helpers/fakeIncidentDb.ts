// Base de datos FALSA de incidentes para Vitest: implementa en memoria el contrato de las RPC de la migración
// 20261029080000_incidentes (crear idempotente, avisos en cola, reparto, vigilante, mesa, respuestas y lo que ve
// el usuario) con un reloj controlable. La lógica real está en SQL y la prueba supabase/tests/incidentes; aquí
// solo se simula lo necesario para probar de punta a punta el código TypeScript (sin red, sin correos reales).

export type FakeEvent = Ev;
type Ev = { id?: number; at: number; kind: string; actor: string; direction?: string | null; body?: string | null; visible?: boolean; channel?: string | null;
  data?: Record<string, unknown>; dedupe?: string | null; counterpart?: string | null; delivery?: string | null };
export type FakeIncident = {
  id: string; userId: string; categoria: string; severidad: string; payload: Record<string, unknown>; status: string; title: string;
  idemKey: string | null; assignee: "iato_ops" | "humano"; level: number; receivedAt: number; firstResponseAt: number | null;
  firstHumanAt: number | null; takenAt: number | null; owner: string | null; escalatedAt: number | null; nextStep: string; due: number;
  resolvedAt: number | null; closedBy: string | null; resolutionNote: string | null; events: Ev[];
  replies: { id: string; kind: string; body: string; at: number; email_status: string }[];
};
export type FakeAlert = { id: string; requestId: string; level: number; reason: string; status: string; attempts: number; claimed: number | null; createdAt: number };

const TAKE: Record<string, number> = { critica: 10, alta: 30, media: 120, baja: 480 };
const ADMINS: Record<string, { name: string; email: string }> = {
  "00000000-0000-4000-8000-0000000000d1": { name: "Dueño", email: "dueno@iatos.test" },
  "00000000-0000-4000-8000-0000000000c1": { name: "Carlo", email: "carlo@iatos.test" },
};
const USERS: Record<string, { name: string; email: string }> = {};

export function createFakeIncidentDb(opts: { start?: Date; operatorAlive?: boolean } = {}) {
  let now = (opts.start ?? new Date("2026-10-29T14:00:00Z")).getTime();
  let seq = 0;
  const uuid = () => `0f${String(++seq).padStart(6, "0")}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const incidents = new Map<string, FakeIncident>();
  const alerts: FakeAlert[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  const enqueue = (requestId: string, level: number, reason: string) => {
    const a: FakeAlert = { id: uuid(), requestId, level, reason, status: "pendiente", attempts: 0, claimed: null, createdAt: now };
    alerts.push(a);
    return a.id;
  };
  const itemOf = (i: FakeIncident) => ({
    source: "concierge_request", id: i.id, type: "incidente", title: i.title, status: i.status,
    stage: i.status === "solicitado" ? "nueva" : i.status === "pendiente_confirmacion" ? "en_proceso" : i.status === "resuelto" ? "resuelta" : "no_se_pudo",
    created_at: iso(i.receivedAt), payload: i.payload, trip: null,
    user: { id: i.userId, ...(USERS[i.userId] ?? { name: "Viajera Prueba", email: "viajera@example.test" }) },
    owner: i.owner ? { id: i.owner, ...ADMINS[i.owner] } : null,
    incident: {
      category: i.categoria, severity: i.severidad, assignee: i.assignee, escalation_level: i.level, received_at: iso(i.receivedAt),
      first_response_at: iso(i.firstResponseAt), first_human_response_at: iso(i.firstHumanAt), taken_at: iso(i.takenAt),
      next_step: i.nextStep, next_step_due_at: iso(i.due), resolved_at: iso(i.resolvedAt),
      minutes_unattended: i.takenAt === null && i.resolvedAt === null ? Math.floor((now - i.receivedAt) / 60000) : null,
    },
  });
  const recipients = (level: number, fallback: string[]) => {
    const list = fallback.map((email, n) => {
      const admin = Object.entries(ADMINS).find(([, v]) => v.email === email);
      return { email, name: admin?.[1].name ?? null, role: n === 0 ? "primario" : "respaldo", user_id: admin?.[0] ?? null, channels: ["email", "push"], on_duty: true };
    });
    return level >= 2 ? list : list.filter((r) => r.role === "primario");
  };
  let evSeq = 0;
  const log = (i: FakeIncident, e: Omit<Ev, "at">) => {
    if (e.dedupe && i.events.some((x) => x.dedupe === e.dedupe)) return null;
    const ev = { id: ++evSeq, at: now, ...e };
    i.events.push(ev);
    onEvent?.(i, ev);
    if (e.direction === "saliente" && e.visible && e.kind === "mensaje") {
      i.firstResponseAt ??= now;
      if (e.actor === "equipo") i.firstHumanAt ??= now;
    }
    return ev.id;
  };
  let onEvent: ((i: FakeIncident, e: Ev) => void) | null = null;

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    incident_create(a) {
      const x = a._input as Record<string, unknown>;
      const key = (x.idem_key as string | null) ?? null;
      if (key) {
        const ex = [...incidents.values()].find((i) => i.idemKey === key);
        if (ex) {
          if (ex.userId !== x.user_id) return { ok: false, code: "IDEM_CONFLICT" };
          return { ok: true, created: false, id: ex.id, folio: ex.id.replace(/-/g, "").slice(0, 8).toUpperCase(), severity: ex.severidad,
            assignee: ex.assignee, escalation_level: ex.level, next_step: ex.nextStep, next_step_due_at: iso(ex.due) };
        }
      }
      const sev = String(x.severidad);
      const id = uuid();
      const alive = opts.operatorAlive === true;
      const i: FakeIncident = {
        id, userId: String(x.user_id), categoria: String(x.categoria), severidad: sev, status: "solicitado", idemKey: key,
        title: `${x.categoria}: ${String(x.descripcion).slice(0, 140)}`,
        payload: Object.fromEntries(Object.entries({ categoria: x.categoria, severidad: sev, descripcion: x.descripcion, origen: x.origen,
          ubicacion: x.ubicacion, refs: x.refs, queja: x.queja, sentimiento: x.sentimiento, expectativa: x.expectativa,
          acciones_tomadas: x.acciones_tomadas }).filter(([, v]) => v != null)),
        assignee: alive ? "iato_ops" : "humano", level: alive ? 0 : 1, receivedAt: now, firstResponseAt: null, firstHumanAt: null,
        takenAt: null, owner: null, escalatedAt: alive ? null : now, nextStep: String(x.siguiente_paso ?? "Una persona del equipo IATOS revisa tu caso"),
        due: now + TAKE[sev] * 60000, resolvedAt: null, closedBy: null, resolutionNote: null, events: [], replies: [],
      };
      incidents.set(id, i);
      log(i, { kind: "creado", actor: String(x.origen) === "usuario" ? "usuario" : "iato", direction: "entrante", body: String(x.descripcion) });
      if (x.respuesta_inmediata) log(i, { kind: "mensaje", actor: "iato", direction: "saliente", visible: true, body: String(x.respuesta_inmediata) });
      const alertId = !alive ? enqueue(id, 1, "nuevo") : sev === "critica" ? enqueue(id, 0, "nuevo") : null;
      return { ok: true, created: true, id, folio: id.replace(/-/g, "").slice(0, 8).toUpperCase(), severity: sev, assignee: i.assignee,
        escalation_level: i.level, alert_id: alertId, next_step: i.nextStep, next_step_due_at: iso(i.due), trip_id: null };
    },
    incident_add_event(a) {
      const i = incidents.get(String(a._id));
      if (!i) return { ok: false, code: "NOT_FOUND" };
      const e = a._ev as Record<string, unknown>;
      const id = log(i, { kind: String(e.kind), actor: String(e.actor), direction: (e.direction as string) ?? null, body: (e.body as string) ?? null,
        visible: e.visible_to_user === true, channel: (e.channel as string) ?? null, data: (e.data as Record<string, unknown>) ?? {},
        dedupe: (e.dedupe_key as string) ?? null, counterpart: (e.counterpart as string) ?? null, delivery: (e.delivery as string) ?? null });
      return { ok: true, event_id: id, duplicate: id === null };
    },
    incident_set_status(a) {
      const i = incidents.get(String(a._id));
      if (!i) return { ok: false, code: "NOT_FOUND" };
      const st = String(a._status); const actor = String(a._actor ?? "iato_ops");
      if (st === "resuelto" && actor !== "equipo") {
        log(i, { kind: "estado", actor, direction: "interno", body: "esperando confirmación del viajero" });
        return { ok: true, status: "esperando_confirmacion", closed: false };
      }
      if (st === "no_se_pudo" && actor !== "equipo") {
        i.assignee = "humano"; i.level = Math.max(1, i.level + 1); enqueue(i.id, i.level, "necesita_humano");
        return { ok: true, status: "escalado", closed: false, code: "HUMAN_REQUIRED" };
      }
      if (st === "en_proceso") { i.status = "pendiente_confirmacion"; log(i, { kind: "estado", actor, direction: "interno", body: "en proceso" }); }
      return { ok: true, status: st === "en_proceso" ? "en_proceso" : st, closed: false };
    },
    incident_assign(a) {
      const i = incidents.get(String(a._id));
      if (!i) return { ok: false, code: "NOT_FOUND" };
      if (a._assignee === "humano") {
        i.assignee = "humano"; i.level = Math.max(1, i.level + 1); i.escalatedAt = now;
        const alertId = enqueue(i.id, i.level, "necesita_humano");
        log(i, { kind: "escalamiento", actor: String(a._actor ?? "iato_ops"), direction: "interno", body: String(a._reason ?? "") });
        return { ok: true, assignee: "humano", alert_id: alertId, escalation_level: i.level };
      }
      if (i.takenAt !== null) return { ok: false, code: "TAKEN_BY_HUMAN" };
      i.assignee = "iato_ops";
      return { ok: true, assignee: "iato_ops", alert_id: null, escalation_level: i.level };
    },
    incident_set_next_step(a) {
      const i = incidents.get(String(a._id));
      if (!i) return { ok: false, code: "NOT_FOUND" };
      i.nextStep = String(a._text); i.due = Date.parse(String(a._due));
      log(i, { kind: "siguiente_paso", actor: String(a._actor ?? "iato_ops"), direction: "interno", body: `${a._text} · ${a._due}` });
      return { ok: true };
    },
    incident_operator_heartbeat() {
      return { ok: true, at: iso(now), enabled: true };
    },
    incident_alerts_claim(a) {
      const fallback = (a._fallback as string[]) ?? [];
      const out = alerts.filter((x) => (x.status === "pendiente" || x.status === "fallido") && x.attempts < 5 && (x.claimed === null || now - x.claimed > 5 * 60000)
        && (!a._request_id || x.requestId === a._request_id)).slice(0, Number(a._limit ?? 20));
      return out.map((x) => {
        x.claimed = now; x.attempts++;
        return { alert: { id: x.id, level: x.level, reason: x.reason, note: null, attempt: x.attempts }, item: itemOf(incidents.get(x.requestId)!), recipients: recipients(x.level, fallback) };
      });
    },
    incident_alert_finish(a) {
      const x = alerts.find((y) => y.id === a._alert_id && y.status !== "enviado");
      if (!x) return { ok: false, code: "NOT_FOUND_OR_SENT" };
      x.status = a._ok ? "enviado" : "fallido"; x.claimed = null;
      log(incidents.get(x.requestId)!, { kind: "alerta", actor: "sistema", direction: "saliente", body: `${x.reason} ${x.status}` });
      return { ok: true };
    },
    incident_watch() {
      let escalated = 0;
      for (const i of incidents.values()) {
        if (!["solicitado", "pendiente_confirmacion"].includes(i.status) || i.takenAt !== null) continue;
        const take = TAKE[i.severidad] * 60000;
        if (now - (i.escalatedAt ?? i.receivedAt) >= take) {
          i.level += 1; i.escalatedAt = now; i.assignee = "humano"; escalated++;
          enqueue(i.id, i.level, i.level === 1 ? "sin_avance" : "sin_tomar");
          log(i, { kind: "escalamiento", actor: "sistema", direction: "interno", body: `nivel ${i.level}` });
        }
      }
      return { ok: true, escalated, alerts: 0, operator_alive: opts.operatorAlive === true, pending_alerts: alerts.filter((x) => x.status === "pendiente").length };
    },
    admin_incident_take(a) {
      const i = incidents.get(String(a._id))!;
      i.owner = String(a.__admin); i.takenAt ??= now; i.assignee = "humano"; i.status = "pendiente_confirmacion";
      log(i, { kind: "asignacion", actor: "equipo", direction: "interno", body: "tomado" });
      return { ok: true, id: i.id, item: itemOf(i) };
    },
    admin_ops_act(a) {
      const i = incidents.get(String(a._id))!;
      if (a._action === "resolver") throw new Error("INCIDENT_NEEDS_CONFIRMATION");
      const reply = { id: uuid(), kind: "respuesta", body: String(a._message), at: now, email_status: "pendiente" };
      i.replies.push(reply);
      log(i, { kind: "mensaje", actor: "equipo", direction: "saliente", visible: true, body: reply.body, channel: "app" });
      return { ok: true, reply_id: reply.id, item: itemOf(i) };
    },
    admin_incident_resolve(a) {
      const i = incidents.get(String(a._id))!;
      const note = String(a._note ?? "").trim();
      if (note.length < 10) return { ok: false, code: "RESOLUTION_NOTE_REQUIRED" };
      const reply = { id: uuid(), kind: "resuelta", body: note, at: now, email_status: "pendiente" };
      i.replies.push(reply);
      log(i, { kind: "mensaje", actor: "equipo", direction: "saliente", visible: true, body: note, channel: "app" });
      i.status = "resuelto"; i.resolvedAt = now; i.closedBy = "equipo"; i.resolutionNote = note;
      for (const x of alerts) if (x.requestId === i.id && x.status !== "enviado") x.status = "descartado";
      return { ok: true, reply_id: reply.id, item: itemOf(i) };
    },
    team_reply_email_claim(a) {
      for (const i of incidents.values()) {
        const r = i.replies.find((q) => q.id === a._reply_id);
        if (r) {
          if (r.email_status === "enviado") return { ok: false, code: "ALREADY_DONE" };
          return { ok: true, reply: { id: r.id, kind: r.kind, body: r.body, source: "concierge_request", source_id: i.id }, to: (USERS[i.userId] ?? { email: "viajera@example.test" }).email,
            name: (USERS[i.userId] ?? { name: "Viajera Prueba" }).name, item: itemOf(i) };
        }
      }
      return { ok: false, code: "NOT_FOUND" };
    },
    team_reply_email_finish(a) {
      for (const i of incidents.values()) {
        const r = i.replies.find((q) => q.id === a._reply_id);
        if (r) r.email_status = a._ok ? "enviado" : "fallido";
      }
      return { ok: true };
    },
    my_team_requests(a) {
      return [...incidents.values()].filter((i) => i.userId === a.__user).map((i) => ({
        ...itemOf(i), replies: i.replies.map((r) => ({ id: r.id, kind: r.kind, body: r.body, at: iso(r.at) })),
        incident: { category: i.categoria, severity: i.severidad, next_step: i.nextStep, next_step_due_at: iso(i.due), is_open: i.resolvedAt === null },
      }));
    },
  };

  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const h = handlers[fn];
      if (!h) return Promise.resolve({ data: null, error: { message: `rpc desconocida: ${fn}` } });
      try {
        return Promise.resolve({ data: h(args ?? {}) as unknown, error: null });
      } catch (e) {
        return Promise.resolve({ data: null, error: { message: (e as Error).message } });
      }
    },
    advance(minutes: number) { now += minutes * 60000; },
    now: () => new Date(now),
    setUser(id: string, u: { name: string; email: string }) { USERS[id] = u; },
    /** Gancho: cada línea nueva de la bitácora (el operador falso lo usa para despertar). */
    onEvent(fn: ((i: FakeIncident, e: Ev) => void) | null) { onEvent = fn; },
    /** Para extender el doble con más RPC (operador). */
    handlers, log, enqueue, iso,
    incidents, alerts, calls,
    ADMIN_DUENO: "00000000-0000-4000-8000-0000000000d1",
    ADMIN_CARLO: "00000000-0000-4000-8000-0000000000c1",
  };
}
export type FakeIncidentDb = ReturnType<typeof createFakeIncidentDb>;
