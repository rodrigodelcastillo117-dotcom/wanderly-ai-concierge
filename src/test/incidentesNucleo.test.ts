// Núcleo de incidentes: interfaz _shared/incidents.ts (lo que importan los demás módulos), canales enchufables,
// severidad por reglas, detección con IA solo si hace falta, Iato (report_incident) y el formulario.
import { describe, expect, it, vi } from "vitest";
import {
  addIncidentEvent, assignIncident, classifyIncident, cleanLocation, cleanRefs, createIncident, detectIncident, incidentFolio, incidentGuide,
  incidentSeverityFor, ingestInboundMessage, operatorHeartbeat, setIncidentNextStep, setIncidentStatus, watchIncidents,
} from "../../supabase/functions/_shared/incidents";
import { CHANNEL_SECRETS, createChannelRegistry } from "../../supabase/functions/_shared/channels/registry";
import { folioInText } from "../../supabase/functions/_shared/channels/types";
import { alertFacts, incidentTeamAlertEmail, type AlertClaim } from "../../supabase/functions/_shared/incident-alerts";
import { parseIncidentBody } from "../../supabase/functions/incidente/core";
import { TOOL_DEFS, validateToolInput } from "../../supabase/functions/concierge-chat/toolDefs";
import { autoOpenIncident, incidentPromptNote, runReportIncidentTool } from "../../supabase/functions/concierge-chat/incident";
import { opsTypeLabel, userStageText } from "../../supabase/functions/_shared/ops-labels";
import { teamReplyEmail } from "../../supabase/functions/_shared/ops-desk";

const USER = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";

function mockDb(data: unknown, error: { message: string } | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { calls, rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data, error }; }) };
}

describe("_shared/incidents.ts · interfaz estable", () => {
  it("createIncident: limpia lo que no cumple (zona, coordenadas, PNR), calcula la severidad por reglas y manda incident_create", async () => {
    const db = mockDb({ ok: true, created: true, id: ID, folio: "44444444", severity: "critica", assignee: "humano", escalation_level: 1,
      alert_id: "a1", next_step: "Una persona…", next_step_due_at: "2026-10-29T17:10:00Z", trip_id: null });
    const r = await createIncident(db, {
      userId: USER, categoria: "salud", descripcion: "  Mi papá se desmayó en el hotel  ", origen: "usuario",
      ubicacion: { ciudad: "Roma", lat: 999, lng: 12.5, zona_horaria: "Marte/Olympus" }, refs: { pnr: "ab c12", vuelo: "az 610" },
      idempotencyKey: "corta",
    });
    expect(r).toMatchObject({ ok: true, created: true, id: ID, severity: "critica", assignee: "humano", escalationLevel: 1, alertId: "a1" });
    const input = db.calls[0].args._input as Record<string, unknown>;
    expect(db.calls[0].fn).toBe("incident_create");
    expect(input).toMatchObject({ user_id: USER, categoria: "salud", severidad: "critica", descripcion: "Mi papá se desmayó en el hotel",
      ubicacion: { ciudad: "Roma", lng: 12.5 }, refs: { pnr: "ABC12", vuelo: "AZ610" }, idem_key: null });
    expect((input.ubicacion as Record<string, unknown>).lat).toBeUndefined();
    expect((input.ubicacion as Record<string, unknown>).zona_horaria).toBeUndefined();
  });

  it("createIncident: errores tipados sin llamar a la base (usuario, categoría, descripción) y los de la base tal cual", async () => {
    const db = mockDb({ ok: false, code: "IDEM_CONFLICT" });
    expect(await createIncident(db, { userId: "x", categoria: "otro", descripcion: "hola", origen: "usuario" })).toEqual({ ok: false, code: "USER_REQUIRED" });
    expect(await createIncident(db, { userId: USER, categoria: "zombis" as never, descripcion: "hola", origen: "usuario" })).toEqual({ ok: false, code: "INVALID_CATEGORY" });
    expect(await createIncident(db, { userId: USER, categoria: "otro", descripcion: " ", origen: "usuario" })).toEqual({ ok: false, code: "DESCRIPTION_REQUIRED" });
    expect(db.calls).toHaveLength(0);
    expect(await createIncident(db, { userId: USER, categoria: "otro", descripcion: "hola equipo", origen: "monitor_vuelos", idempotencyKey: "vuelo:AM1:2026-10-29" }))
      .toMatchObject({ ok: false, code: "IDEM_CONFLICT" });
  });

  it("una queja sin subtipo se guarda como servicio_iatos (la base exige el subtipo)", async () => {
    const db = mockDb({ ok: true, created: true, id: ID, severity: "media", assignee: "humano" });
    await createIncident(db, { userId: USER, categoria: "queja", descripcion: "no me gustó", origen: "iato" });
    expect((db.calls[0].args._input as Record<string, unknown>).queja).toEqual({ subtipo: "servicio_iatos" });
  });

  it("bitácora, estado, asignación, siguiente paso, latido, vigilante y mensajes entrantes llaman a su RPC con lo que esperan", async () => {
    const db = mockDb({ ok: true, event_id: 7, duplicate: false, status: "esperando_confirmacion", closed: false, assignee: "humano", alert_id: "a9",
      escalation_level: 1, escalated: 2, alerts: 1, operator_alive: false, pending_alerts: 3 });
    expect(await addIncidentEvent(db, ID, { kind: "accion", actor: "iato_ops", body: "Llamé al hotel", channel: "voz", direction: "saliente", dedupeKey: "c1" }))
      .toEqual({ ok: true, eventId: 7, duplicate: false });
    expect(db.calls[0].args._ev).toMatchObject({ kind: "accion", actor: "iato_ops", channel: "voz", dedupe_key: "c1", visible_to_user: false });
    expect(await setIncidentStatus(db, ID, "resuelto", { note: "Hotel confirmó la habitación" })).toEqual({ ok: true, status: "esperando_confirmacion", closed: false });
    expect(db.calls[1].args).toMatchObject({ _status: "resuelto", _actor: "iato_ops" });
    expect(await assignIncident(db, ID, { to: "humano", reason: "El hotel solo atiende por teléfono local" })).toMatchObject({ ok: true, assignee: "humano", alertId: "a9" });
    expect(await setIncidentNextStep(db, ID, "Te confirmo con el hotel", new Date("2026-10-29T18:00:00Z"))).toEqual({ ok: true });
    expect(await setIncidentNextStep(db, ID, "x", "no es fecha")).toEqual({ ok: false, code: "BAD_DUE" });
    expect(await operatorHeartbeat(db)).toBe(true);
    expect(await watchIncidents(db)).toMatchObject({ ok: true, escalated: 2, operatorAlive: false, pendingAlerts: 3 });
    await ingestInboundMessage(db, ID, { channel: "whatsapp", from: "+5215555555555", text: "¿Ya?", providerMessageId: "wamid.1" });
    expect(db.calls.at(-1)!.args._ev).toMatchObject({ kind: "mensaje", actor: "usuario", direction: "entrante", dedupe_key: "in:whatsapp:wamid.1", visible_to_user: true });
  });

  it("limpieza y folio", () => {
    expect(cleanLocation({ zona_horaria: "Europe/Madrid", lat: 40.4, lng: -3.7 })).toEqual({ zona_horaria: "Europe/Madrid", lat: 40.4, lng: -3.7 });
    expect(cleanLocation({ ciudad: "  " })).toBeNull();
    expect(cleanRefs({ pnr: "1234567890" })).toBeNull();
    expect(incidentFolio(ID)).toBe("44444444");
  });
});

describe("severidad por reglas (determinista, con motivos)", () => {
  it("base por categoría y modificadores explicables", () => {
    expect(incidentSeverityFor("salud").severidad).toBe("critica");
    expect(incidentSeverityFor("equipaje", { texto: "mi maleta no llegó" }).severidad).toBe("media");
    expect(incidentSeverityFor("equipaje", { texto: "mi maleta con la insulina no llegó" })).toMatchObject({ severidad: "alta", motivos: expect.arrayContaining(["lleva medicinas o algo indispensable"]) });
    expect(incidentSeverityFor("vuelo_cancelado", { horaLocal: 3 }).severidad).toBe("critica");
    expect(incidentSeverityFor("vuelo_cancelado", { horaLocal: 12, texto: "viajo con mi bebé" })).toMatchObject({ severidad: "critica", motivos: expect.arrayContaining(["viaja con menores o personas vulnerables"]) });
    expect(incidentSeverityFor("vuelo_retrasado", { retrasoMin: 200 }).severidad).toBe("alta");
    expect(incidentSeverityFor("queja", { texto: "voy a ir a Profeco" }).severidad).toBe("alta");
    expect(incidentSeverityFor("cobro_reembolso", { expectativa: "informacion", texto: "¿cuándo llega?" }).severidad).toBe("baja");
    expect(incidentSeverityFor("hotel_problema", { reabierto: true }).severidad).toBe("alta");
  });

  it("la guía de salud, seguridad y robo trae la línea de emergencia; la de queja dice qué pasa con el reembolso", () => {
    expect(incidentGuide("salud").emergencia).toMatch(/911.*112/);
    expect(incidentGuide("equipaje").emergencia).toBeNull();
    expect(incidentGuide("queja", { expectativa: "reembolso" }).equipo).toMatch(/Si el cargo lo hizo IATOS, revisamos el reembolso/);
  });
});

describe("detección: quejas implícitas, sentimiento y expectativa; IA solo si hace falta", () => {
  it("entiende la queja aunque no diga 'queja' y lo que la persona espera", () => {
    expect(detectIncident("esto es una porquería")).toMatchObject({ detected: true, categoria: "queja", sentimiento: "muy_molesto" });
    expect(detectIncident("Worst service ever, I want my money back")).toMatchObject({ categoria: "queja", queja: { subtipo: "cobro" }, expectativa: "reembolso", idioma: "en" });
    expect(detectIncident("me cancelaron el vuelo, quiero que me cambien a otro")).toMatchObject({ categoria: "vuelo_cancelado", expectativa: "cambio" });
    expect(detectIncident("¿te molesto con una duda?").detected).toBe(false);
    expect(detectIncident("esto es un robo, me cobraron de más").categoria).toBe("queja");
  });

  it("la IA solo se llama cuando las reglas dudan; si falla o tarda, se quedan las reglas", async () => {
    const ai = vi.fn(async () => '{"detected":true,"categoria":"queja","queja":{"subtipo":"calidad"},"sentimiento":"molesto","expectativa":"disculpa"}');
    expect((await classifyIncident("Me cancelaron el vuelo a Lima", { ai })).via).toBe("reglas");
    expect(ai).not.toHaveBeenCalled();
    expect(detectIncident("la comida del tour no estuvo a la altura").categoria).toBe("queja");
    const r = await classifyIncident("pues nada, ahí quedó lo de ayer…", { ai });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ via: "ia", detected: true, categoria: "queja", queja: { subtipo: "calidad" } });
    const broken = vi.fn(async () => { throw new Error("proveedor caído"); });
    expect(await classifyIncident("no sé, algo raro pasó?", { ai: broken })).toMatchObject({ via: "reglas" });
  });
});

describe("canales enchufables", () => {
  it("sin secretos: correo apagado y los demás apagados diciendo qué falta (nombres, nunca valores)", () => {
    const reg = createChannelRegistry({ env: () => undefined, sendEmail: vi.fn() });
    const st = Object.fromEntries(reg.status().map((s) => [s.id, s]));
    expect(st.email).toMatchObject({ enabled: false, state: "apagado_sin_secretos", missing: ["RESEND_API_KEY"] });
    // WhatsApp: por omisión Meta Cloud API directa (canales, 30-oct-2026); con secretos de Twilio, Twilio (prueba de abajo).
    expect(st.whatsapp).toMatchObject({ enabled: false, state: "apagado_sin_secretos", missing: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"] });
    // Un solo secreto: el del webhook se deriva del token (channels/telegram.ts).
    expect(st.telegram.missing).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(st.voz.note).toMatch(/Llamada de voz apagado: faltan/);
    expect(CHANNEL_SECRETS.whatsapp((k) => (k === "WHATSAPP_PROVIDER" ? "meta" : undefined))).toEqual(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"]);
  });

  it("con secretos pero sin adaptador: 'no implementado'; con adaptador: prendido y se usa", async () => {
    const env = (k: string) => ({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_SMS_FROM: "+1", TWILIO_WHATSAPP_FROM: "whatsapp:+1", RESEND_API_KEY: "re" } as Record<string, string>)[k];
    const sms = { id: "sms" as const, label: "SMS", send: vi.fn(async (to: string) => ({ ok: true, channel: "sms" as const, to, providerMessageId: "SM1" })) };
    const reg = createChannelRegistry({ env, sendEmail: vi.fn(async () => ({ ok: false, error: "503" })), adapters: { sms: () => sms } });
    const st = Object.fromEntries(reg.status().map((s) => [s.id, s.state]));
    expect(st).toMatchObject({ email: "activo", sms: "activo", whatsapp: "apagado_no_implementado", telegram: "apagado_sin_secretos" });
    // Respaldo: el correo falla → WhatsApp apagado → SMS sale.
    const r = await reg.sendWithFallback([{ channel: "email", to: "a@b.co" }, { channel: "whatsapp", to: "+52155" }, { channel: "sms", to: "+52155" }], { text: "hola" }, { incidentId: ID });
    expect(r.ok).toBe(true);
    expect(r.delivered).toMatchObject({ channel: "sms", providerMessageId: "SM1" });
    expect(r.attempts.map((a) => [a.channel, a.ok, a.code ?? null])).toEqual([["email", false, "SEND_FAILED"], ["whatsapp", false, "CHANNEL_OFF"], ["sms", true, null]]);
  });

  it("el correo rechaza direcciones inválidas y marca el incidente en el encabezado", async () => {
    const send = vi.fn(async () => ({ ok: true, id: "re_1" }));
    const reg = createChannelRegistry({ env: (k) => (k === "RESEND_API_KEY" ? "x" : undefined), sendEmail: send });
    expect((await reg.send("email", "no-es-correo", { text: "x" })).code).toBe("BAD_ADDRESS");
    expect((await reg.send("email", "a@b.co", { subject: "S", text: "x" }, { incidentId: ID })).providerMessageId).toBe("re_1");
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ to: "a@b.co", subject: "S", headers: { "X-IATOS-Incident": ID } });
    expect(folioInText("Re: tu caso Folio ABCD1234")).toBe("ABCD1234");
  });
});

describe("aviso al equipo", () => {
  const claim = (over: Partial<AlertClaim["item"]> = {}): AlertClaim => ({
    alert: { id: "al1", level: 2, reason: "sin_tomar" },
    recipients: [],
    item: { id: ID, type: "incidente", title: "Queja: …", created_at: "2026-10-29T17:00:00Z",
      payload: { categoria: "queja", severidad: "alta", descripcion: "Me cobraron doble", queja: { subtipo: "cobro" }, sentimiento: "muy_molesto", expectativa: "reembolso" },
      user: { name: "Beto Prueba", email: "beto@example.test" }, incident: { severity: "alta", category: "queja", minutes_unattended: 95, assignee: "humano" }, ...over },
  });
  it("sin zona horaria lo dice y da la hora de CDMX; la queja dice ánimo y lo que espera; nivel 2 = respaldo", () => {
    const f = alertFacts(claim(), "https://traveliatos.life", new Date("2026-10-29T18:35:00Z"));
    expect(f.travelerClock).toBe("Sin zona horaria del viajero · 12:35 en CDMX");
    expect(f.complaint).toBe("Queja: Cobro · Ánimo: Muy molesto · Espera: Reembolso");
    expect(f.unattended).toBe("1 h 35 min sin que una persona lo tome");
    const m = incidentTeamAlertEmail(claim(), "https://traveliatos.life");
    expect(m.subject).toMatch(/^\[ALTA\] Escalado: nadie lo ha tomado · Queja · Beto Prueba · Folio 44444444/);
    expect(m.text).toContain("Nivel 2 · primario y respaldo");
    expect(m.html).not.toMatch(/<script/i);
  });
});

describe("Iato y el formulario", () => {
  it("report_incident está entre las herramientas y valida su entrada", () => {
    expect(TOOL_DEFS.map((t) => t.name)).toContain("report_incident");
    expect(validateToolInput("report_incident", { categoria: "robo", descripcion: "me robaron" })).toMatchObject({ ok: true });
    expect(validateToolInput("report_incident", { categoria: "zombis", descripcion: "x" })).toMatchObject({ ok: false });
  });

  it("la detección y la herramienta usan la MISMA clave (persona + categoría + día): nunca dos casos", async () => {
    const report = vi.fn(async (input: { idempotencyKey?: string | null }) => ({ ok: true as const, id: ID, folio: "44444444", created: true, categoria: "traslado_no_llego" as const,
      categoriaLabel: "El traslado no llegó", severidad: "alta" as const, motivos: [], guia: incidentGuide("traslado_no_llego"), texto: "…", siguientePaso: "x",
      siguientePasoHora: "2026-10-29T17:30:00Z", teamNotified: true, assignee: "humano" as const, queja: null, sentimiento: "preocupado", expectativa: null, _k: input.idempotencyKey }));
    const ctx = { userId: USER, todayISO: "2026-10-29", tz: "America/Cancun" };
    const auto = await autoOpenIncident("el chofer no llegó al aeropuerto", ctx, { report });
    await runReportIncidentTool({ categoria: "traslado_no_llego", descripcion: "no llegó el traslado" }, ctx, { report });
    expect(report.mock.calls.map((c) => (c as unknown as [{ idempotencyKey?: string }])[0].idempotencyKey)).toEqual([`iato:${USER}:traslado_no_llego:2026-10-29`, `iato:${USER}:traslado_no_llego:2026-10-29`]);
    expect(await autoOpenIncident("busca hoteles en Mérida", ctx, { report })).toBeNull();
    const note = incidentPromptNote(auto!, "America/Cancun");
    expect(note).toContain("folio 44444444");
    expect(note).toContain("módulos oficiales del aeropuerto");
    expect(note).toMatch(/a más tardar a las 12:30 \(tu hora\)/);
  });

  it("el formulario valida lo que manda la app", () => {
    expect(parseIncidentBody(null)).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(parseIncidentBody({ descripcion: "x" })).toMatchObject({ ok: false, code: "DESCRIPTION_REQUIRED" });
    expect(parseIncidentBody({ descripcion: "se canceló", categoria: "zombis" })).toMatchObject({ ok: false, code: "INVALID_CATEGORY" });
    const ok = parseIncidentBody({ descripcion: "Se canceló mi vuelo", categoria: "vuelo_cancelado", trip_id: "no-uuid", idempotency_key: "corta" });
    expect(ok).toMatchObject({ ok: true, value: { categoria: "vuelo_cancelado", tripId: null, idempotencyKey: null } });
  });

  it("la mesa y Mis solicitudes nombran el incidente sin decir 'reserva'", () => {
    expect(opsTypeLabel("incidente")).toBe("Incidente");
    expect(userStageText("nueva", "incidente")).toBe("Recibido · el equipo IATOS ya fue avisado");
    expect(userStageText("en_proceso", "incidente")).not.toMatch(/reserva/);
    const m = teamReplyEmail({ reply: { id: "r", kind: "respuesta", body: "Ya hablamos con el hotel", source: "concierge_request", source_id: ID }, to: "a@b.co",
      item: { source: "concierge_request", id: ID, type: "incidente", title: "Problema con el hotel: …", status: "pendiente_confirmacion", stage: "en_proceso" } }, "https://traveliatos.life");
    expect(m.text).toContain("Tu caso:");
    expect(m.text).not.toContain("aún no es una reserva");
  });
});
