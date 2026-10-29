// Evaluación de incidentes (72 escenarios reales, sin IA, con mocks): por cada mensaje se comprueba
// clasificación, severidad, caso creado, respuesta inmediata útil, aviso correcto al equipo, escalamiento si
// nadie lo toma y que NINGÚN caso se pierda. Modo con IA real: scripts/incidentes/evalReal.ts (a mano).
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { INCIDENT_SCENARIOS, type IncidentScenario } from "./fixtures/incidentScenarios";
import { createFakeIncidentDb } from "./helpers/fakeIncidentDb";
import { reportIncident } from "../../supabase/functions/_shared/incident-report";
import { deliverIncidentAlerts, type IncidentAlertDeps, runIncidentWatch } from "../../supabase/functions/_shared/incident-alerts";
import { createChannelRegistry } from "../../supabase/functions/_shared/channels/registry";
import { autoOpenIncident } from "../../supabase/functions/concierge-chat/incident";
import { categoryLabel } from "../../supabase/functions/_shared/incident-labels";

const TEAM = ["dueno@iatos.test", "carlo@iatos.test"];
const TAKE: Record<string, number> = { critica: 10, alta: 30, media: 120, baja: 480 };
const USER = "11111111-1111-4111-8111-111111111111";

function harness(s: IncidentScenario) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(s.at));
  const db = createFakeIncidentDb({ start: new Date(s.at) });
  db.setUser(USER, { name: "Ana Viajera", email: "ana@example.test" });
  const emails: { to: string | string[]; subject: string; text: string; html: string }[] = [];
  const pushes: { userId: string; title: string; body: string; url: string }[] = [];
  const channels = createChannelRegistry({
    env: (k) => (k === "RESEND_API_KEY" ? "re_prueba" : undefined),
    sendEmail: async (m) => { emails.push(m); return { ok: true, id: `em_${emails.length}` }; },
  });
  const deps: IncidentAlertDeps & { admin: typeof db } = {
    admin: db, rpc: db.rpc, channels, siteUrl: "https://traveliatos.life", fallbackEmails: TEAM, now: db.now,
    push: async (userId, p) => { pushes.push({ userId, ...p }); return 1; },
  };
  const report = (input: Parameters<typeof reportIncident>[1]) => reportIncident({ db, deliver: (id) => deliverIncidentAlerts(deps, { requestId: id }) }, input);
  return { db, emails, pushes, deps, report };
}

async function run(s: IncidentScenario) {
  const h = harness(s);
  const r = s.canal === "iato"
    ? await autoOpenIncident(s.texto, { userId: USER, todayISO: s.at.slice(0, 10), tz: s.tz ?? null }, { report: h.report })
    : await h.report({ userId: USER, descripcion: s.texto, categoria: s.elegida ?? null, origen: "usuario", canal: "app",
      ubicacion: s.tz ? { zona_horaria: s.tz } : null, idempotencyKey: `form-${s.id}-0000000000000000` }).then((x) => (x.ok ? x : null));
  return { ...h, r };
}

const results: { id: string; ok: boolean }[] = [];
afterEach(() => { vi.useRealTimers(); });
afterAll(() => {
  // Resumen legible en la salida de la prueba.
  const pass = results.filter((x) => x.ok).length;
  console.info(`EVAL incidentes: ${pass}/${results.length} escenarios correctos`);
});

describe("evaluación de incidentes: 72 escenarios reales (reglas, sin IA)", () => {
  it("el conjunto tiene al menos 60 escenarios, con español, inglés, faltas, quejas y negativos", () => {
    expect(INCIDENT_SCENARIOS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(INCIDENT_SCENARIOS.map((s) => s.id)).size).toBe(INCIDENT_SCENARIOS.length);
    expect(INCIDENT_SCENARIOS.filter((s) => s.categoria === "queja").length).toBeGreaterThanOrEqual(10);
    expect(INCIDENT_SCENARIOS.filter((s) => s.categoria === null).length).toBeGreaterThanOrEqual(6);
    expect(INCIDENT_SCENARIOS.filter((s) => /\b(the|my|i|was)\b/i.test(s.texto)).length).toBeGreaterThanOrEqual(10);
  });

  it.each(INCIDENT_SCENARIOS.map((s) => [s.id, s] as const))("%s", async (_id, s) => {
    let ok = false;
    try {
      const { db, emails, pushes, deps, r } = await run(s);
      if (s.categoria === null) {
        // No es un problema: no se abre caso ni se molesta al equipo.
        expect(r).toBeNull();
        expect(db.incidents.size).toBe(0);
        expect(emails).toHaveLength(0);
        ok = true;
        return;
      }
      // 1) clasificación y severidad
      expect(r, `no abrió caso para: ${s.texto}`).not.toBeNull();
      expect(r!.categoria).toBe(s.categoria);
      if (s.severidad) expect(r!.severidad).toBe(s.severidad);
      if (s.queja) expect(r!.queja?.subtipo).toBe(s.queja);
      // 2) caso creado con su bitácora y primera respuesta medida
      const inc = db.incidents.get(r!.id)!;
      expect(inc).toBeTruthy();
      expect(inc.firstResponseAt).not.toBeNull();
      // 3) respuesta inmediata útil y honesta: pasos de ahora, lo que hará el equipo, folio y hora prometida
      expect(r!.guia.ahora.length).toBeGreaterThanOrEqual(1);
      expect(r!.texto).toContain("Ahora mismo:");
      expect(r!.texto).toContain(r!.folio);
      expect(r!.texto).toMatch(/a más tardar a las \d{2}:\d{2}/);
      if (["salud", "seguridad", "robo"].includes(s.categoria) || r!.severidad === "critica") expect(r!.texto).toMatch(/911|112/);
      // 4) aviso correcto: correo al primario de guardia con severidad, categoría y enlace; push a su cuenta
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(TEAM[0]);
      expect(emails[0].subject).toContain(categoryLabel(s.categoria));
      expect(emails[0].subject).toContain(`[${r!.severidad === "critica" ? "CRÍTICA" : r!.severidad.toUpperCase()}]`);
      expect(emails[0].text).toContain(`/admin/operaciones?id=${r!.id}`);
      expect(pushes.map((p) => p.userId)).toEqual([db.ADMIN_DUENO]);
      expect(r!.teamNotified).toBe(true);
      // 5) nadie lo toma → el vigilante escala y avisa también al respaldo
      db.advance(TAKE[r!.severidad] + 1);
      const w = await runIncidentWatch(deps);
      expect(w.watch.escalated).toBe(1);
      const esc = emails.slice(1);
      expect(esc.map((e) => e.to).sort()).toEqual([...TEAM].sort());
      expect(esc[0].subject).toMatch(/Escalado|ESCALADO/);
      // 6) cero casos perdidos: todo aviso entregado, nada pendiente
      expect(db.alerts.filter((a) => a.requestId === r!.id && a.status !== "enviado")).toHaveLength(0);
      expect(db.alerts.filter((a) => a.requestId === r!.id && a.status === "enviado").length).toBeGreaterThanOrEqual(2);
      ok = true;
    } finally {
      results.push({ id: s.id, ok });
    }
  });
});
