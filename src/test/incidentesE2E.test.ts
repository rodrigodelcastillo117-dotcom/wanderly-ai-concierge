// Incidentes de punta a punta con mocks (sin red, sin correos reales): el viajero reporta → el equipo recibe el
// correo (simulado) → nadie lo toma y se escala al respaldo → el admin lo toma y responde (correo + push al
// viajero) → el viajero lo ve en "Mis solicitudes" → se resuelve con nota → quedan los tiempos medidos.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeIncidentDb } from "./helpers/fakeIncidentDb";
import { parseIncidentBody } from "../../supabase/functions/incidente/core";
import { reportIncident } from "../../supabase/functions/_shared/incident-report";
import { deliverIncidentAlerts, type IncidentAlertDeps, runIncidentWatch } from "../../supabase/functions/_shared/incident-alerts";
import { createChannelRegistry } from "../../supabase/functions/_shared/channels/registry";
import { sendTeamReply, teamReplyPush } from "../../supabase/functions/_shared/ops-desk";

const USER = "22222222-2222-4222-8222-222222222222";
const TEAM = ["dueno@iatos.test", "carlo@iatos.test"];

afterEach(() => { vi.useRealTimers(); });

describe("incidentes: de punta a punta", () => {
  it("reporta → aviso → escalamiento → tomar → responder → el viajero lo ve → resuelto con nota → tiempos", async () => {
    // 21:40 en Cancún (02:40 UTC del 30-oct).
    const start = new Date("2026-10-30T02:40:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    const db = createFakeIncidentDb({ start });
    db.setUser(USER, { name: "Ana Viajera", email: "ana@example.test" });
    const outbox: { to: string | string[]; subject: string; text: string; html: string }[] = [];
    const pushes: { userId: string; title: string; url: string }[] = [];
    const channels = createChannelRegistry({
      env: (k) => (k === "RESEND_API_KEY" ? "re_prueba" : undefined),
      sendEmail: async (m) => { outbox.push(m); return { ok: true, id: `em_${outbox.length}` }; },
    });
    const deps: IncidentAlertDeps & { admin: typeof db } = {
      admin: db, rpc: db.rpc, channels, siteUrl: "https://traveliatos.life", fallbackEmails: TEAM, now: db.now,
      push: async (userId, p) => { pushes.push({ userId, title: p.title, url: p.url }); return 1; },
    };

    // 1) El viajero reporta desde la app ("Tengo un problema").
    const body = parseIncidentBody({
      categoria: "traslado_no_llego",
      descripcion: "Llegué a Cancún y el chofer del traslado no está; ya pasaron 40 minutos y es de noche.",
      ubicacion: { ciudad: "Cancún", pais: "MX", lat: 21.0365, lng: -86.8771, zona_horaria: "America/Cancun" },
      refs: { proveedor: "Traslados Caribe", reserva: "TC-7781" },
      idempotency_key: "clave-de-reintento-000001",
    });
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    const r = await reportIncident({ db, deliver: (id) => deliverIncidentAlerts(deps, { requestId: id }) },
      { ...body.value, userId: USER, origen: "usuario", canal: "app", idempotencyKey: `app:${USER.slice(0, 8)}:${body.value.idempotencyKey}` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.severidad).toBe("critica"); // de noche y sin traslado
    expect(r.texto).toContain("módulos oficiales del aeropuerto");
    expect(r.texto).toContain(`folio ${r.folio}`);
    expect(r.texto).toMatch(/a más tardar a las 21:50 \(tu hora\)/);

    // Reintento del mismo envío (la red se cayó): mismo caso, sin otro aviso.
    const again = await reportIncident({ db, deliver: (id) => deliverIncidentAlerts(deps, { requestId: id }) },
      { ...body.value, userId: USER, origen: "usuario", canal: "app", idempotencyKey: `app:${USER.slice(0, 8)}:${body.value.idempotencyKey}` });
    expect(again.ok && again.id).toBe(r.id);
    expect(db.incidents.size).toBe(1);

    // 2) El equipo recibe el correo accionable: quién, dónde, hora local, qué pasó, qué ya hizo Iato, enlace.
    expect(outbox).toHaveLength(1);
    const alert = outbox[0];
    expect(alert.to).toBe("dueno@iatos.test");
    expect(alert.subject).toMatch(/^\[CRÍTICA\] Nuevo · El traslado no llegó · Ana Viajera · Cancún, MX · Folio /);
    expect(alert.text).toContain("Hora del viajero: 21:40 (America/Cancun)");
    expect(alert.text).toContain("Llegué a Cancún y el chofer del traslado no está");
    expect(alert.text).toContain("Proveedor: Traslados Caribe");
    expect(alert.text).toContain("Ya hizo Iato: Iato le dio la guía inmediata");
    expect(alert.text).toContain("https://www.google.com/maps/search/?api=1&query=21.0365,-86.8771");
    expect(alert.text).toContain(`https://traveliatos.life/admin/operaciones?id=${r.id}`);
    expect(pushes).toEqual([{ userId: db.ADMIN_DUENO, title: expect.stringContaining("[CRÍTICA] El traslado no llegó · Ana"), url: `/admin/operaciones?id=${r.id}` }]);

    // 3) Nadie lo toma en 10 min → el vigilante escala: avisa al primario y al respaldo (Carlo).
    db.advance(5);
    expect((await runIncidentWatch(deps)).watch.escalated).toBe(0);
    db.advance(6);
    const w = await runIncidentWatch(deps);
    expect(w.watch.escalated).toBe(1);
    expect(w.delivered.sent).toBe(1);
    const escalation = outbox.slice(1);
    expect(escalation.map((m) => m.to).sort()).toEqual(["carlo@iatos.test", "dueno@iatos.test"]);
    expect(escalation[0].subject).toContain("Escalado: nadie lo ha tomado");
    expect(escalation[0].text).toContain("11 min sin que una persona lo tome");
    expect(w.channels.find((c) => c.id === "whatsapp")).toMatchObject({ state: "apagado_sin_secretos" });

    // 4) Carlo lo toma y le responde (app + correo + push al viajero).
    db.advance(2);
    await db.rpc("admin_incident_take", { _id: r.id, __admin: db.ADMIN_CARLO });
    db.advance(1);
    const act = await db.rpc("admin_ops_act", { _source: "concierge_request", _id: r.id, _action: "responder",
      _message: "Ana, ya hablé con Traslados Caribe: el chofer llega en 10 minutos a la salida 3, con letrero IATOS." });
    const replyId = (act.data as { reply_id: string }).reply_id;
    const mailDeps = { rpc: db.rpc, send: async (m: { to: string | string[]; subject: string; html: string; text: string }) => { outbox.push(m); return { ok: true, id: "em_r" }; },
      siteUrl: "https://traveliatos.life", ownerEmail: TEAM };
    expect((await sendTeamReply(mailDeps, replyId)).email_status).toBe("enviado");
    const userMail = outbox[outbox.length - 1];
    expect(userMail.to).toBe("ana@example.test");
    expect(userMail.subject).toMatch(/^Te respondió el equipo IATOS/);
    expect(userMail.text).toContain("el chofer llega en 10 minutos");
    expect(userMail.text).not.toContain("aún no es una reserva");
    expect(teamReplyPush({ kind: "respuesta", body: "Ana, ya hablé con Traslados Caribe" })).toEqual({
      title: "Te respondió el equipo IATOS", body: "Ana, ya hablé con Traslados Caribe", url: "/dashboard/concierge?tab=solicitudes" });

    // 5) El viajero lo ve en "Mis solicitudes".
    const mine = (await db.rpc("my_team_requests", { __user: USER })).data as { id: string; replies: { body: string }[]; stage: string }[];
    expect(mine).toHaveLength(1);
    expect(mine[0].stage).toBe("en_proceso");
    expect(mine[0].replies[0].body).toContain("salida 3");

    // 6) Resolver sin nota no cierra; con nota sí (y el viajero recibe la nota).
    const blocked = await db.rpc("admin_ops_act", { _source: "concierge_request", _id: r.id, _action: "resolver" });
    expect(blocked.error?.message).toMatch(/INCIDENT_NEEDS_CONFIRMATION/);
    expect(((await db.rpc("admin_incident_resolve", { _id: r.id, _note: "ok" })).data as { code: string }).code).toBe("RESOLUTION_NOTE_REQUIRED");
    db.advance(12);
    const done = (await db.rpc("admin_incident_resolve", { _id: r.id, _note: "Ana ya va en el traslado al hotel; el proveedor no cobrará la espera." })).data as { reply_id: string };
    expect((await sendTeamReply(mailDeps, done.reply_id)).email_status).toBe("enviado");
    expect(outbox[outbox.length - 1].subject).toMatch(/^Tu solicitud quedó resuelta/);

    // 7) Tiempos medidos: recibido → 1.ª respuesta (guía, al instante) → tomado (13 min) → 1.ª humana (14) → resuelto (26).
    const inc = db.incidents.get(r.id)!;
    const min = (t: number | null) => (t === null ? null : Math.round((t - inc.receivedAt) / 60000));
    expect(min(inc.firstResponseAt)).toBe(0);
    expect(min(inc.takenAt)).toBe(13);
    expect(min(inc.firstHumanAt)).toBe(14);
    expect(min(inc.resolvedAt)).toBe(26);
    expect(inc.closedBy).toBe("equipo");
    // Nada pendiente: todos los avisos salieron.
    expect(db.alerts.every((a) => a.status === "enviado")).toBe(true);
  });

  it("si el correo falla no se pierde: queda fallido y el vigilante lo reintenta hasta que sale", async () => {
    const start = new Date("2026-10-29T17:00:00Z");
    const db = createFakeIncidentDb({ start });
    let fail = true;
    const sent: string[] = [];
    const channels = createChannelRegistry({
      env: (k) => (k === "RESEND_API_KEY" ? "re_prueba" : undefined),
      sendEmail: async (m) => { if (fail) return { ok: false, error: "resend 503" }; sent.push(String(m.to)); return { ok: true, id: "x" }; },
    });
    const deps = { admin: db, rpc: db.rpc, channels, fallbackEmails: TEAM, now: db.now, push: null };
    const r = await reportIncident({ db, deliver: (id) => deliverIncidentAlerts(deps, { requestId: id }) },
      { userId: USER, descripcion: "Me robaron la mochila con la laptop", origen: "usuario", canal: "app" });
    expect(r.ok && r.teamNotified).toBe(false);
    expect(r.ok && r.texto).toContain("el aviso se está reintentando");
    expect(db.alerts[0].status).toBe("fallido");
    fail = false;
    db.advance(6);
    await runIncidentWatch(deps);
    expect(sent).toEqual(["dueno@iatos.test"]);
    expect(db.alerts[0].status).toBe("enviado");
  });
});
