// La vigilancia avisa al viajero por la MISMA entrega de canales que el Operador (_shared/channels/entrega.ts):
// WhatsApp con su ventana de 24 h y plantillas aprobadas, canal preferido, horario de no molestar de channel_prefs y
// lo urgente ya por todos los canales. Se conservan el tope diario de avisos no urgentes y que cada aviso salga una
// sola vez. Dobles en memoria (sin push, correos ni mensajes reales).
import { afterEach, describe, expect, it, vi } from "vitest";
import { correrVigilancia, type VigilanciaDeps } from "../../supabase/functions/_shared/vigilancia/runner";
import { avisarUsuario, entregarDiferidos, type EntregaDeps } from "../../supabase/functions/_shared/channels/entrega";
import type { ChannelSendResult } from "../../supabase/functions/_shared/channels/types";

type Row = Record<string, any>;
const ANA = "0a000000-0000-4000-8000-00000000000a";
const TRIP = "0b000000-0000-4000-8000-00000000000b";
const CASO = "0c1d2e3f-0000-4000-8000-00000000000c";

class FakeDb {
  cfg: Row = { enabled: true, serp_tope_diario: 4, avisos_tope_diario: 3, hora_desde: 8, hora_hasta: 21, retraso_aviso_min: 60,
    retraso_incidente_min: 120, incidente_por_puerta: false, confirmar_desde_horas: 48, confirmacion_limite_horas: 8, sin_respuesta_horas: 12 };
  avisos: Row[] = [];
  eventos: Row[] = [];
  incEventos: Row[] = [];
  /** channel_prefs: sin fila = nunca guardó preferencias. */
  prefs = new Map<string, Row>();
  links: Row[] = [];
  diferidos: Row[] = [];
  enviadosPrevios = 0;
  constructor(public now: () => Date) {}

  aviso(p: Partial<Row>): Row {
    const a: Row = { id: `av-${this.avisos.length + 1}`, user_id: ANA, trip_id: TRIP, clave: `aviso:x:${this.avisos.length + 1}`, tipo: "clima",
      titulo: "Lluvia fuerte en Madrid", cuerpo: "Mañana se esperan 40 mm de lluvia.", url: `/dashboard/viajes/${TRIP}`, urgente: false,
      zona_horaria: "America/Mexico_City", programado_para: this.now().toISOString(), expira_at: null, incidente_id: null, plantilla: null,
      estado: "pendiente", ...p };
    this.avisos.push(a);
    return a;
  }

  async rpc(fn: string, a: Record<string, any>): Promise<{ data: any; error: null | { message: string } }> {
    const ok = (data: any) => ({ data, error: null });
    const now = this.now();
    switch (fn) {
      case "vigilancia_cfg": return ok(this.cfg);
      case "vigilancia_avisos_reclamar": {
        const due = this.avisos.filter((x) => x.estado === "pendiente" && Date.parse(x.programado_para) <= now.getTime())
          .sort((x, y) => Number(y.urgente) - Number(x.urgente));
        due.forEach((x) => (x.estado = "enviando"));
        return ok(due.map((x) => ({ ...x, enviados_24h: this.enviadosPrevios + this.avisos.filter((y) => y.user_id === x.user_id && y.estado === "enviado" && !y.urgente).length })));
      }
      case "vigilancia_aviso_cerrar": {
        const x = this.avisos.find((y) => y.id === a._id)!;
        if (a._reprogramar) { x.estado = "pendiente"; x.programado_para = a._reprogramar; } else { x.estado = a._estado; x.canales = a._canales; }
        return ok({ ok: true });
      }
      case "vigilancia_evento": {
        if (this.eventos.some((e) => e.clave === a._e.clave)) return ok({ ok: true, created: false });
        this.eventos.push(a._e);
        return ok({ ok: true, created: true });
      }
      case "incident_add_event": this.incEventos.push({ id: a._id, ...a._ev }); return ok({ ok: true, event_id: this.incEventos.length });
      case "channel_targets": {
        const p = this.prefs.get(a._user);
        return ok({
          prefs: p ? { preferido: "app", noMolestarInicio: null, noMolestarFin: null, tz: null, updated_at: "2026-10-30T10:00:00Z", ...p }
            : { preferido: "app", noMolestarInicio: null, noMolestarFin: null, tz: null },
          links: this.links.filter((l) => l.user_id === a._user),
          email: "ana@ejemplo.test", name: "Ana López",
        });
      }
      case "channel_deferred_add": {
        if (this.diferidos.some((x) => x.user_id === a._user && x.dedupe_key === a._dedupe)) return ok({ ok: true, id: null, duplicate: true });
        this.diferidos.push({ id: this.diferidos.length + 1, user_id: a._user, payload: a._payload, send_after: a._send_after, dedupe_key: a._dedupe, status: "pendiente" });
        return ok({ ok: true, id: this.diferidos.length, duplicate: false });
      }
      case "channel_deferred_due": {
        const due = this.diferidos.filter((x) => x.status === "pendiente" && Date.parse(x.send_after) <= now.getTime());
        due.forEach((x) => (x.status = "enviando"));
        return ok(due.map((x) => ({ id: x.id, user_id: x.user_id, payload: x.payload })));
      }
      case "channel_deferred_finish": {
        const x = this.diferidos.find((y) => y.id === a._id)!;
        x.status = a._ok ? "enviado" : "pendiente"; x.error = a._error ?? null;
        return ok(true);
      }
      default: throw new Error(`rpc no simulada: ${fn}`);
    }
  }
}

function montar(iso: string) {
  let now = new Date(iso);
  const db = new FakeDb(() => now);
  const salidas: Array<{ canal: string; to: string; texto?: string; plantilla?: string; params?: string[] }> = [];
  const app: Row[] = [];
  const okR = (channel: ChannelSendResult["channel"], to: string): ChannelSendResult => ({ ok: true, channel, to, providerMessageId: "x" });
  const entrega: EntregaDeps = {
    db: db as never, siteUrl: "https://traveliatos.life", ahora: () => now,
    push: vi.fn(async (u: string) => { salidas.push({ canal: "push", to: u }); return 1; }),
    telegram: vi.fn(async (to: string, texto: string) => { salidas.push({ canal: "telegram", to, texto }); return okR("telegram", to); }),
    whatsapp: {
      proveedor: "meta",
      texto: vi.fn(async (to: string, texto: string) => { salidas.push({ canal: "whatsapp", to, texto }); return okR("whatsapp", to); }),
      plantilla: vi.fn(async (to: string, nombre: string, params: string[]) => { salidas.push({ canal: "whatsapp", to, plantilla: nombre, params }); return okR("whatsapp", to); }),
      botones: vi.fn(), descargar: vi.fn(),
    } as never,
    email: vi.fn(async (to: string) => { salidas.push({ canal: "email", to }); return okR("email", to); }),
  };
  const deps: VigilanciaDeps = {
    db: db as never,
    consultarVuelo: async () => { throw new Error("no se consulta SerpApi en estas pruebas"); },
    notificarApp: async (n) => { app.push(n); return true; },
    entrega,
    alertarEquipo: async () => undefined,
    despertarOperador: async () => undefined,
    operadorActivo: async () => false,
    enviarCorreo: async () => { throw new Error("no se manda correo a proveedores en estas pruebas"); },
    ahora: () => now,
    config: { dominioRespuesta: "reply.traveliatos.life", remitente: "IATOS Concierge <concierge@traveliatos.life>" },
  };
  return { db, deps, entrega, salidas, app, setNow: (x: string) => { now = new Date(x); } };
}

const vincular = (db: FakeDb, channel: string, external_id: string, window_open = false) => db.links.push({ user_id: ANA, channel, external_id, window_open });

afterEach(() => vi.restoreAllMocks());

describe("vigilancia → entrega de canales del Operador", () => {
  it("WhatsApp preferido con la ventana de 24 h abierta: sale SOLO por WhatsApp (texto), no por push", async () => {
    const m = montar("2026-11-01T18:00:00Z"); // 12:00 en CDMX
    m.db.prefs.set(ANA, { preferido: "whatsapp" });
    vincular(m.db, "whatsapp", "+5215511112222", true);
    vincular(m.db, "telegram", "777");
    const a = m.db.aviso({});
    const r = await correrVigilancia(m.deps, ["entregar"]);
    expect(r.errores).toEqual([]);
    expect(m.salidas).toEqual([{ canal: "whatsapp", to: "+5215511112222", texto: expect.stringContaining("Mañana se esperan 40 mm de lluvia.") }]);
    expect(m.app).toHaveLength(1);
    expect(a.estado).toBe("enviado");
    expect(a.canales).toEqual([{ canal: "app", ok: true }, { canal: "whatsapp", ok: true, detalle: null }]);
  });

  it("URGENTE de noche con la ventana cerrada: ya, por TODOS los canales; WhatsApp con la plantilla del vuelo", async () => {
    const m = montar("2026-11-02T06:00:00Z"); // 00:00 en CDMX
    m.db.prefs.set(ANA, { preferido: "telegram", noMolestarInicio: "22:00", noMolestarFin: "07:00", tz: "America/Mexico_City" });
    vincular(m.db, "whatsapp", "+5215511112222", false);
    vincular(m.db, "telegram", "777");
    m.db.aviso({ tipo: "vuelo", clave: "aviso:vuelo:v1:puerta", titulo: "Cambio de puerta: IB6400 sale de la K12", cuerpo: "Tu vuelo IB6400 ahora sale de la puerta K12.",
      urgente: true, plantilla: { nombre: "iatos_aviso_vuelo", params: ["IB6400", "2026-11-02", "Cambio de puerta: IB6400 sale de la K12"] } });
    await correrVigilancia(m.deps, ["entregar"]);
    expect(m.salidas.map((s) => s.canal)).toEqual(["push", "telegram", "whatsapp", "email"]);
    expect(m.salidas[2]).toMatchObject({ plantilla: "iatos_aviso_vuelo", params: ["IB6400", "2026-11-02", "Cambio de puerta: IB6400 sale de la K12"] });
    expect(m.db.diferidos).toEqual([]);
  });

  it("aviso de un caso abierto, ventana cerrada → plantilla iatos_aviso_caso con el nombre del viajero y el folio", async () => {
    const m = montar("2026-11-01T18:00:00Z");
    m.db.prefs.set(ANA, { preferido: "whatsapp" });
    vincular(m.db, "whatsapp", "+5215511112222", false);
    m.db.aviso({ tipo: "confirmacion", clave: "aviso:confirmacion:c1", titulo: "Estamos asegurando el traslado con Traslados Sol", urgente: true, incidente_id: CASO,
      url: `/dashboard/concierge?tab=solicitudes&id=${CASO}` });
    await correrVigilancia(m.deps, ["entregar"]);
    const wa = m.salidas.find((s) => s.canal === "whatsapp")!;
    expect(wa).toMatchObject({ plantilla: "iatos_aviso_caso", params: ["Ana", "0C1D2E3F", "Estamos asegurando el traslado con Traslados Sol"] });
  });

  it("horario de no molestar de channel_prefs: lo normal no suena, queda en la app y sale UNA vez al terminar, por su canal preferido", async () => {
    const m = montar("2026-11-01T05:30:00Z"); // 23:30 en CDMX
    m.db.prefs.set(ANA, { preferido: "telegram", noMolestarInicio: "22:00", noMolestarFin: "07:30", tz: "America/Mexico_City" });
    vincular(m.db, "telegram", "777");
    const a = m.db.aviso({});
    await correrVigilancia(m.deps, ["entregar"]);
    expect(m.salidas).toEqual([]);
    expect(m.app).toHaveLength(1); // en la app, sin sonar
    expect(a.estado).toBe("enviado");
    expect(a.canales[1]).toMatchObject({ canal: "diferido", ok: true });
    expect(m.db.diferidos).toHaveLength(1);
    expect(m.db.diferidos[0]).toMatchObject({ dedupe_key: `vig:${a.clave}`, send_after: "2026-11-01T13:30:00.000Z" });
    // Otra corrida de la vigilancia no lo vuelve a mandar ni a encolar.
    await correrVigilancia(m.deps, ["entregar"]);
    expect(m.db.diferidos).toHaveLength(1);
    expect(m.app).toHaveLength(1);
    // Al terminar el horario, el vigilante lo entrega por Telegram (preferido), una sola vez.
    m.setNow("2026-11-01T13:31:00Z");
    expect(await entregarDiferidos(m.entrega)).toEqual({ procesados: 1, enviados: 1 });
    expect(await entregarDiferidos(m.entrega)).toEqual({ procesados: 0, enviados: 0 });
    expect(m.salidas.map((s) => s.canal)).toEqual(["telegram"]);
  });

  it("ya no hay ventana propia de 8 a 21 h: quien guardó preferencias SIN horario de no molestar recibe lo normal a las 23:30", async () => {
    const m = montar("2026-11-01T05:30:00Z"); // 23:30 en CDMX
    m.db.prefs.set(ANA, { preferido: "app" });
    const a = m.db.aviso({});
    await correrVigilancia(m.deps, ["entregar"]);
    expect(m.salidas.map((s) => s.canal)).toEqual(["push"]);
    expect(a.estado).toBe("enviado");
    expect(m.db.diferidos).toEqual([]);
  });

  it("quien nunca guardó preferencias: no molestar por omisión 21–08 h en la zona DONDE ESTÁ (la del aviso), por la misma cola de canales", async () => {
    const m = montar("2026-11-01T22:30:00Z"); // 23:30 en Madrid (CET), 16:30 en CDMX
    const a = m.db.aviso({ zona_horaria: "Europe/Madrid" });
    await correrVigilancia(m.deps, ["entregar"]);
    expect(m.salidas).toEqual([]);
    expect(a.estado).toBe("enviado");
    expect(m.db.diferidos).toHaveLength(1);
    expect(m.db.diferidos[0].send_after).toBe("2026-11-02T07:00:00.000Z"); // 08:00 en Madrid
  });

  it("se conserva el tope diario de avisos NO urgentes; lo urgente no cuenta ni espera", async () => {
    const m = montar("2026-11-01T18:00:00Z");
    m.db.prefs.set(ANA, { preferido: "app" });
    m.db.enviadosPrevios = 3;
    const normal = m.db.aviso({});
    const urgente = m.db.aviso({ tipo: "vuelo", titulo: "Tu vuelo IB6400 aparece cancelado", urgente: true });
    await correrVigilancia(m.deps, ["entregar"]);
    expect(urgente.estado).toBe("enviado");
    expect(normal.estado).toBe("pendiente");
    expect(normal.programado_para).toBe("2026-11-01T21:00:00.000Z");
    expect(m.salidas.filter((s) => s.canal === "push")).toHaveLength(1);
  });

  it("un aviso que caducaría durante el no molestar no se guarda ni sale (check-in de un vuelo que sale antes de que termine)", async () => {
    const m = montar("2026-11-01T05:30:00Z"); // 23:30 en CDMX
    m.db.prefs.set(ANA, { noMolestarInicio: "22:00", noMolestarFin: "07:30", tz: "America/Mexico_City" });
    const a = m.db.aviso({ tipo: "checkin", expira_at: "2026-11-01T12:00:00Z" });
    const r = await correrVigilancia(m.deps, ["entregar"]);
    expect(a.estado).toBe("vencido");
    expect(r.avisos.vencidos).toBe(1);
    expect(m.salidas).toEqual([]);
    expect(m.app).toEqual([]);
    expect(m.db.diferidos).toEqual([]);
  });

  it("la cola de diferidos no entrega tarde un aviso caducado", async () => {
    const m = montar("2026-11-01T05:30:00Z");
    m.db.prefs.set(ANA, { noMolestarInicio: "22:00", noMolestarFin: "07:30", tz: "America/Mexico_City" });
    const r = await avisarUsuario(m.entrega, ANA, { titulo: "Check-in", texto: "Ya puedes hacerlo.", url: "/dashboard", urgente: false, tipo: "vuelo",
      dedupe: "vig:checkin:1", expiraAt: "2026-11-01T14:00:00Z" });
    expect(r.modo).toBe("diferido");
    m.setNow("2026-11-01T14:05:00Z"); // el vigilante se atrasó: ya caducó
    expect(await entregarDiferidos(m.entrega)).toEqual({ procesados: 1, enviados: 0 });
    expect(m.salidas).toEqual([]);
    expect(m.db.diferidos[0]).toMatchObject({ status: "enviado", error: expect.stringMatching(/vencido/) });
  });
});
