// Vigilancia proactiva de punta a punta con dobles (sin SerpApi, sin correos ni push reales). Una base en memoria
// imita las funciones de la migración 20261030010000_vigilancia (su semántica la prueba la suite SQL
// supabase/tests/vigilancia) y las del núcleo de incidentes que se usan (incident_create idempotente,
// incident_add_event). Escenarios pedidos: cancelación → incidente + derechos UE/MX + aviso; retraso de 4 h; cambio
// de puerta; fuente no concluyente; traslado sin confirmar → incidente preventivo; sin consentimiento → no se contacta.
import { beforeEach, describe, expect, it } from "vitest";
import { correrVigilancia, type VigilanciaDeps } from "../../supabase/functions/_shared/vigilancia/runner";
import { CONFIG_POR_OMISION, topeVigilanciaSugerido } from "../../supabase/functions/_shared/vigilancia/vuelos";
import { flightsReserve } from "../../supabase/functions/_shared/serpBrake";
import { respuestaConfirmacion } from "../../supabase/functions/_shared/vigilancia/entrante";
import type { FlightData, FlightOutcome } from "../../supabase/functions/_shared/flight-serpapi";
import { esCorreoDeReclamos, rutaEntrante } from "../../supabase/functions/_shared/derechos/rutas";
import { handleInbound, type ReclamosDeps } from "../../supabase/functions/_shared/derechos/servicio";
import { signSvix } from "../../supabase/functions/_shared/ai-reservations/signature";
import { entregarDiferidos, type EntregaDeps } from "../../supabase/functions/_shared/channels/entrega";

type Row = Record<string, any>;
const U = "11111111-1111-4111-8111-111111111111";
const TRIP = "22222222-2222-4222-8222-222222222222";
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

class FakeDb {
  cfg: Row = { enabled: true, serp_tope_diario: 4, avisos_tope_diario: 3, hora_desde: 8, hora_hasta: 21, retraso_aviso_min: 60,
    retraso_incidente_min: 120, incidente_por_puerta: false, confirmar_desde_horas: 48, confirmacion_limite_horas: 8, sin_respuesta_horas: 12 };
  candidatos: Row[] = [];
  vuelos: Row[] = [];
  eventos: Row[] = [];
  avisos: Row[] = [];
  confirmaciones: Row[] = [];
  prefs = new Map<string, boolean>();
  viajes: Row[] = [];
  incidentes: Row[] = [];
  incEventos: Row[] = [];
  usados = 0;
  operador = false;
  diferidos: Row[] = [];
  constructor(public now: () => Date) {}

  async rpc(fn: string, a: Record<string, any>): Promise<{ data: any; error: null | { message: string } }> {
    const ok = (data: any) => ({ data, error: null });
    const now = this.now();
    switch (fn) {
      case "vigilancia_cfg": return ok(this.cfg);
      case "vigilancia_candidatos_vuelo": return ok(this.candidatos);
      case "vigilancia_vuelo_upsert": {
        for (const r of a._rows) {
          const ex = this.vuelos.find((v) => v.user_id === r.user_id && v.vuelo === r.vuelo && v.fecha === r.fecha);
          if (ex) { ex.trip_id ??= r.trip_id; ex.en_seguimiento ||= r.fuente === "seguimiento"; if (!ex.salida_exacta) ex.salida_at = r.salida_at; continue; }
          this.vuelos.push({ id: uuid(), ...r, en_seguimiento: r.fuente === "seguimiento", activo: true, estado: {}, fallas_seguidas: 0, revisiones: 0, incidente_id: null, llegada_at: null, claimed_at: null });
        }
        return ok(a._rows.length);
      }
      case "vigilancia_vuelos_reclamar": {
        const rest = Math.max(this.cfg.serp_tope_diario - this.usados, 0);
        const due = this.vuelos.filter((v) => v.activo && v.proxima_revision_at && Date.parse(v.proxima_revision_at) <= now.getTime() && !v.claimed_at);
        const items = due.slice(0, Math.min(a._limit, rest));
        items.forEach((v) => (v.claimed_at = now.toISOString()));
        return ok({ ok: true, items: items.map((v) => ({ ...v })), usados: this.usados, tope: this.cfg.serp_tope_diario, restantes: rest, sin_cupo: rest === 0 && due.length > 0 });
      }
      case "vigilancia_vuelo_guardar": {
        const v = this.vuelos.find((x) => x.id === a._id)!;
        const p = a._p;
        if (p.estado) v.estado = p.estado;
        for (const k of ["ultimo_resultado", "ultima_revision_at", "ultimo_ok_at", "fallas_seguidas", "llegada_at", "fin_motivo"]) if (p[k] != null) v[k] = p[k];
        if (p.salida_exacta && p.salida_at) { v.salida_at = p.salida_at; v.salida_exacta = true; }
        if (p.origen && !v.origen) v.origen = p.origen;
        if (p.destino && !v.destino) v.destino = p.destino;
        if ("proxima_revision_at" in p) v.proxima_revision_at = p.proxima_revision_at;
        if ("activo" in p) v.activo = p.activo;
        if (p.incidente_id) v.incidente_id ??= p.incidente_id;
        if (p.contar) v.revisiones++;
        v.claimed_at = null;
        return ok({ ok: true });
      }
      case "vigilancia_evento": {
        if (this.eventos.some((e) => e.clave === a._e.clave)) return ok({ ok: true, created: false });
        this.eventos.push({ ...a._e, id: this.eventos.length + 1, created_at: now.toISOString() });
        return ok({ ok: true, created: true });
      }
      case "vigilancia_eventos_trip":
        return ok(this.eventos.filter((e) => e.trip_id === a._trip && e.ambito === a._ambito).reverse());
      case "vigilancia_aviso_encolar": {
        if (this.avisos.some((x) => x.clave === a._a.clave)) return ok({ ok: true, created: false });
        this.avisos.push({ id: uuid(), estado: "pendiente", programado_para: now.toISOString(), expira_at: null, incidente_id: null, ...a._a });
        return ok({ ok: true, created: true });
      }
      case "vigilancia_avisos_reclamar": {
        const due = this.avisos.filter((x) => x.estado === "pendiente" && Date.parse(x.programado_para) <= now.getTime())
          .sort((x, y) => Number(y.urgente) - Number(x.urgente));
        due.forEach((x) => (x.estado = "enviando"));
        return ok(due.map((x) => ({ ...x, enviados_24h: this.avisos.filter((y) => y.user_id === x.user_id && y.estado === "enviado" && !y.urgente).length })));
      }
      case "vigilancia_aviso_cerrar": {
        const x = this.avisos.find((y) => y.id === a._id)!;
        if (a._reprogramar) { x.estado = "pendiente"; x.programado_para = a._reprogramar; } else { x.estado = a._estado; x.canales = a._canales; }
        return ok({ ok: true });
      }
      case "vigilancia_viajes_ventana":
        return ok(this.viajes.map((t) => ({ ...t, vuelos: this.vuelos.filter((v) => v.trip_id === t.id) })));
      case "vigilancia_confirmaciones_sync": return ok(0);
      case "vigilancia_confirmaciones_pendientes":
        return ok(this.confirmaciones.filter((c) => ["pendiente", "sin_consentimiento", "programada", "enviando", "enviada"].includes(c.estado))
          .map((c) => ({ ...c, consentimiento: this.prefs.get(c.user_id) ?? false })));
      case "vigilancia_confirmacion_actualizar": {
        const c = this.confirmaciones.find((x) => x.id === a._id)!;
        const p = a._p;
        if (p.estado === "enviando") {
          if (!this.prefs.get(c.user_id)) { c.estado = "sin_consentimiento"; return ok({ ok: false, code: "SIN_CONSENTIMIENTO" }); }
          c.estado = "enviando"; return ok({ ok: true });
        }
        if (p.estado) c.estado = p.estado;
        if (p.estado === "enviada") c.enviada_at = now.toISOString();
        for (const k of ["enviar_desde", "incidente_id", "respuesta_resultado", "respuesta_extracto", "remitente_verificado", "error"]) if (k in p) c[k] = p[k];
        return ok({ ok: true });
      }
      case "vigilancia_confirmacion_por_token": return ok(this.confirmaciones.find((c) => c.reply_token === a._token) ?? null);
      case "incident_create": {
        const i = a._input;
        const ex = this.incidentes.find((x) => x.idem_key === i.idem_key);
        if (ex) return ok({ ok: true, created: false, id: ex.id, folio: ex.folio, severity: ex.severidad, assignee: ex.assignee });
        const id = uuid();
        const row = { id, folio: id.replace(/-/g, "").slice(0, 8).toUpperCase(), assignee: this.operador ? "iato_ops" : "humano", ...i };
        this.incidentes.push(row);
        return ok({ ok: true, created: true, id, folio: row.folio, severity: i.severidad, assignee: row.assignee, escalation_level: this.operador ? 0 : 1 });
      }
      case "incident_add_event": {
        if (a._ev.dedupe_key && this.incEventos.some((e) => e.id === a._id && e.dedupe_key === a._ev.dedupe_key)) return ok({ ok: true, event_id: null, duplicate: true });
        this.incEventos.push({ id: a._id, ...a._ev });
        return ok({ ok: true, event_id: this.incEventos.length, duplicate: false });
      }
      // Entrega de canales (la del Operador): el viajero de estas pruebas nunca guardó preferencias ni vinculó chats.
      case "channel_targets":
        return ok({ prefs: { preferido: "app", noMolestarInicio: null, noMolestarFin: null, tz: null }, links: [], email: "viajero@ejemplo.test", name: "Ana" });
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
        x.status = a._ok ? "enviado" : "pendiente";
        return ok(true);
      }
      default: throw new Error(`rpc no simulada: ${fn}`);
    }
  }
}

const widget = (p: Partial<FlightData> = {}): FlightOutcome => ({ kind: "ok", fetchedAt: undefined, data: {
  status: "a tiempo", scheduled_departure: "11:00", estimated_departure: "11:00", origin: "MAD", destination: "MEX", provider_status: "Scheduled",
  departure_at: "2026-11-02T10:00:00.000Z", arrival_at: "2026-11-02T22:00:00.000Z", ...p,
} as FlightData });

function montar(t0: string) {
  let now = new Date(t0);
  const db = new FakeDb(() => now);
  // push: avisos por push al viajero; viajero: TODO lo que salió por sus canales (push, correo…), vía channels/entrega.ts.
  const llamadas = { serp: 0, push: [] as Row[], viajero: [] as Row[], app: [] as Row[], correos: [] as Row[], equipo: [] as string[], operador: [] as string[] };
  const entrega: EntregaDeps = {
    db: db as never, siteUrl: "https://traveliatos.life", ahora: () => now,
    push: async (userId, p, urgente) => { llamadas.push.push({ userId, titulo: p.title, body: p.body, url: p.url, urgente }); llamadas.viajero.push({ canal: "push", titulo: p.title }); return 1; },
    telegram: null, whatsapp: null,
    email: async (to, asunto, texto) => { llamadas.viajero.push({ canal: "email", to, titulo: asunto, texto }); return { ok: true, channel: "email", to, providerMessageId: "re_v" }; },
  };
  let respuestas: FlightOutcome[] = [];
  const deps: VigilanciaDeps = {
    db: db as never,
    consultarVuelo: async () => { llamadas.serp++; db.usados++; return respuestas.shift() ?? { kind: "no_data" }; },
    notificarApp: async (n) => { llamadas.app.push(n); return true; },
    entrega,
    alertarEquipo: async (id) => { llamadas.equipo.push(id); },
    despertarOperador: async (id) => { llamadas.operador.push(id); },
    operadorActivo: async () => db.operador,
    enviarCorreo: async (m) => { llamadas.correos.push(m); return { ok: true, id: `re_${llamadas.correos.length}` }; },
    ahora: () => now,
    config: { dominioRespuesta: "reply.traveliatos.life", remitente: "IATOS Concierge <concierge@traveliatos.life>" },
  };
  return {
    db, deps, llamadas, entrega,
    /** Lo que hace el vigilante cada 2 min: entregar los avisos que esperaban el fin del no molestar. */
    vigilante: () => entregarDiferidos(entrega),
    /** Texto completo del aviso encolado con ese título. */
    texto: (titulo: string) => String(db.avisos.find((a) => a.titulo.slice(0, 80) === titulo)?.cuerpo ?? ""),
    setNow: (iso: string) => { now = new Date(iso); },
    responder: (...o: FlightOutcome[]) => { respuestas = o; },
  };
}

const vueloDelViaje = { fuente: "viaje", user_id: U, trip_id: TRIP, vuelo: "IB6400", fecha: "2026-11-02", hora_salida: "11:00", origen: "MAD", destino: "MEX" };

describe("vuelos de punta a punta", () => {
  beforeEach(() => { seq = 0; });

  it("cancelación detectada → incidente (monitor_vuelos, clave idempotente) + derechos UE/MX + aviso urgente por TODOS los canales (push, correo) y app + operador", async () => {
    const m = montar("2026-11-01T09:00:00Z"); // 25 h antes
    m.db.operador = true;
    m.db.candidatos = [vueloDelViaje];
    m.responder(widget({ status: "cancelado", provider_status: "Canceled" }));
    const r = await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(r.errores).toEqual([]);
    expect(m.llamadas.serp).toBe(1);
    expect(m.db.incidentes).toHaveLength(1);
    const inc = m.db.incidentes[0];
    expect(inc).toMatchObject({ categoria: "vuelo_cancelado", origen: "monitor_vuelos", idem_key: `vigilancia:IB6400:2026-11-02:cancelado:${U}`, trip_id: TRIP });
    expect(inc.refs).toEqual({ vuelo: "IB6400", fecha_vuelo: "2026-11-02" });
    const derechos = m.db.incEventos.find((e) => e.kind === "nota" && /Derechos del pasajero/.test(e.body));
    expect(derechos.body).toMatch(/261\/2004/);
    expect(derechos.body).toMatch(/Aviación Civil \(México\)/);
    expect(m.db.incEventos.some((e) => e.kind === "siguiente_paso" && /busca vuelos alternativos MAD→MEX/.test(e.body))).toBe(true);
    expect(m.llamadas.equipo).toEqual([inc.id]);
    expect(m.llamadas.operador).toEqual([inc.id]);
    expect(m.llamadas.push).toHaveLength(1);
    expect(m.llamadas.push[0]).toMatchObject({ urgente: true });
    expect(m.llamadas.viajero.map((c) => c.canal)).toEqual(["push", "email"]);
    expect(m.llamadas.viajero[1].texto).toMatch(/el operador de IATOS ya está buscando vuelos alternativos/);
    expect(m.llamadas.viajero[1].texto).toMatch(/Tus derechos/);
    expect(m.llamadas.app[0]).toMatchObject({ user_id: U, related_id: TRIP });
    expect(m.db.vuelos[0]).toMatchObject({ activo: false, incidente_id: inc.id });
    expect(m.db.eventos.some((e) => e.tipo === "vuelo_cancelado" && e.visible_viajero)).toBe(true);
    expect(m.db.incEventos.some((e) => e.kind === "alerta" && e.delivery === "enviado")).toBe(true);

    // Otra corrida (o una encimada) no duplica nada.
    m.db.vuelos[0].activo = true; m.db.vuelos[0].proxima_revision_at = "2026-11-01T09:00:00Z";
    m.responder(widget({ status: "cancelado", provider_status: "Canceled" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.db.incidentes).toHaveLength(1);
    expect(m.llamadas.push).toHaveLength(1);
  });

  it("retraso de 4 h → incidente de retraso con derechos, aviso con la nueva hora; operador apagado = persona del equipo", async () => {
    const m = montar("2026-11-02T07:00:00Z"); // 3 h antes
    m.db.candidatos = [vueloDelViaje];
    m.responder(widget({ status: "retrasado", delay_minutes: 240, estimated_departure: "15:00", provider_status: "Delayed" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.db.incidentes).toHaveLength(1);
    expect(m.db.incidentes[0]).toMatchObject({ categoria: "vuelo_retrasado", origen: "monitor_vuelos" });
    expect(m.llamadas.operador).toEqual([]);
    expect(m.llamadas.equipo).toHaveLength(1);
    const aviso = m.llamadas.push[0];
    expect(aviso.titulo).toBe("Tu vuelo IB6400 viene retrasado 4 h");
    const texto = m.texto(aviso.titulo);
    expect(texto).toMatch(/Nueva hora estimada de salida: 15:00/);
    expect(texto).toMatch(/una persona del equipo IATOS/);
    expect(texto).toMatch(/261\/2004/);
    // Sigue vigilado (no terminó) y la próxima revisión respeta la frecuencia.
    expect(m.db.vuelos[0].activo).toBe(true);
    expect(Date.parse(m.db.vuelos[0].proxima_revision_at)).toBe(Date.parse("2026-11-02T08:00:00Z"));
  });

  it("cambio de puerta → aviso urgente (por todos los canales, como lo urgente del Operador) y bitácora, sin incidente (por omisión)", async () => {
    const m = montar("2026-11-02T08:00:00Z");
    m.db.candidatos = [vueloDelViaje];
    m.responder(widget({ gate: "J40", terminal: "4" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.llamadas.push).toHaveLength(0); // la primera puerta no es un cambio
    m.db.vuelos[0].proxima_revision_at = "2026-11-02T08:00:00Z";
    m.responder(widget({ gate: "K12", terminal: "4" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.db.incidentes).toHaveLength(0);
    expect(m.llamadas.push).toHaveLength(1);
    expect(m.llamadas.push[0]).toMatchObject({ titulo: "Cambio de puerta: IB6400 sale de la K12", urgente: true });
    expect(m.llamadas.viajero.map((c) => c.canal)).toEqual(["push", "email"]);
    expect(m.db.eventos.some((e) => e.tipo === "cambio_puerta" && /J40 → K12/.test(e.resumen))).toBe(true);
  });

  it("sin spam: si el vuelo ya está en seguimiento (flight-watch-cron avisa la puerta), la vigilancia no repite ese aviso", async () => {
    const m = montar("2026-11-02T08:00:00Z");
    m.db.candidatos = [vueloDelViaje, { fuente: "seguimiento", user_id: U, trip_id: TRIP, vuelo: "IB6400", fecha: "2026-11-02", ruta: "MAD-MEX" }];
    m.responder(widget({ gate: "J40" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.db.vuelos).toHaveLength(1);
    m.db.vuelos[0].proxima_revision_at = "2026-11-02T08:00:00Z";
    m.responder(widget({ gate: "K12" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.llamadas.push).toHaveLength(0);
    expect(m.db.eventos.some((e) => e.tipo === "cambio_puerta")).toBe(true);
    // Un caso sí se avisa (con folio y derechos: flight-watch-cron no lo hace).
    m.db.vuelos[0].proxima_revision_at = "2026-11-02T08:00:00Z";
    m.responder(widget({ gate: "K12", status: "cancelado", provider_status: "Canceled" }));
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.llamadas.push).toHaveLength(1);
    expect(m.db.incidentes).toHaveLength(1);
  });

  it("fuente no concluyente → nada de incidentes ni estados inventados; cerca de la salida, UN aviso tranquilo", async () => {
    const m = montar("2026-11-02T06:00:00Z"); // 4 h antes
    m.db.candidatos = [vueloDelViaje];
    m.responder({ kind: "no_data" });
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.llamadas.push).toHaveLength(0);
    m.setNow("2026-11-02T07:00:00Z");
    m.responder({ kind: "date_mismatch" });
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    m.setNow("2026-11-02T08:00:00Z");
    m.responder({ kind: "provider_error", message: "timeout" });
    await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(m.db.incidentes).toHaveLength(0);
    expect(m.llamadas.push).toHaveLength(1);
    expect(m.llamadas.push[0].titulo).toBe("No pudimos confirmar el estado de tu vuelo IB6400");
    expect(m.texto(m.llamadas.push[0].titulo)).toMatch(/NO significa que haya un problema/);
    expect(m.db.vuelos[0].estado).toEqual({});
    expect(m.db.vuelos[0].fallas_seguidas).toBe(3);
  });

  it("nada antes de 48 h y respeta el cupo diario de SerpApi", async () => {
    const m = montar("2026-10-30T09:00:00Z"); // 73 h antes
    m.db.candidatos = [vueloDelViaje];
    await correrVigilancia(m.deps, ["vuelos"]);
    expect(m.llamadas.serp).toBe(0);
    expect(m.db.vuelos[0].proxima_revision_at).toBe("2026-10-31T10:00:00.000Z");
    m.setNow("2026-11-01T12:00:00Z");
    m.db.usados = 4; // cupo del día agotado
    const r = await correrVigilancia(m.deps, ["vuelos"]);
    expect(m.llamadas.serp).toBe(0);
    expect(r.vuelos.sin_cupo).toBe(true);
    expect(m.db.eventos.some((e) => e.tipo === "sin_cupo" && e.user_id === null)).toBe(true);
  });
});

describe("freno global de SerpApi (serpBrake: SERPAPI_DAILY_BUDGET con la reserva de vuelos, o cuota agotada)", () => {
  beforeEach(() => { seq = 0; });
  const enVentana = () => {
    const m = montar("2026-11-01T12:00:00Z"); // 22 h antes: le toca revisión
    m.db.candidatos = [vueloDelViaje, { ...vueloDelViaje, vuelo: "AM0001", user_id: "33333333-3333-4333-8333-333333333333", trip_id: null }];
    return m;
  };

  it("con el freno puesto no se consulta, el vuelo no se cuenta como falla ni se avisa, y se anota una vez al día", async () => {
    const m = enVentana();
    let preguntas = 0;
    m.deps.frenoSerp = async () => { preguntas++; return "budget"; };
    const r = await correrVigilancia(m.deps, ["vuelos", "entregar"]);
    expect(preguntas).toBeGreaterThan(0);
    expect(m.llamadas.serp).toBe(0);
    expect(r.vuelos).toMatchObject({ consultas: 0, no_concluyentes: 0, sin_cupo: true, freno: "budget" });
    expect(m.db.vuelos.every((v) => v.claimed_at === null && v.fallas_seguidas === 0 && v.revisiones === 0 && v.activo)).toBe(true);
    const nota = m.db.eventos.filter((e) => e.tipo === "sin_cupo_global");
    expect(nota).toHaveLength(1);
    expect(nota[0]).toMatchObject({ user_id: null, ambito: "sistema", clave: "sin_cupo_global:2026-11-01:budget" });
    expect(nota[0].resumen).toMatch(/SERPAPI_DAILY_BUDGET/);
    expect(m.llamadas.push).toHaveLength(0);
    // Otra corrida el mismo día: tampoco consulta y no repite la nota.
    await correrVigilancia(m.deps, ["vuelos"]);
    expect(m.llamadas.serp).toBe(0);
    expect(m.db.eventos.filter((e) => e.tipo === "sin_cupo_global")).toHaveLength(1);
    // Al soltarse el freno, los mismos vuelos se revisan.
    m.deps.frenoSerp = async () => null;
    m.responder(widget(), widget());
    await correrVigilancia(m.deps, ["vuelos"]);
    expect(m.llamadas.serp).toBe(2);
  });

  it("si el freno se pone a media corrida, deja de consultar y suelta los vuelos que faltaban", async () => {
    const m = enVentana();
    m.responder(widget());
    let n = 0;
    m.deps.frenoSerp = async () => (n++ === 0 ? null : "quota");
    const r = await correrVigilancia(m.deps, ["vuelos"]);
    expect(m.llamadas.serp).toBe(1);
    expect(r.vuelos).toMatchObject({ consultas: 1, sin_cupo: true, freno: "quota" });
    const pendiente = m.db.vuelos.find((v) => v.revisiones === 0)!;
    expect(pendiente).toMatchObject({ claimed_at: null, fallas_seguidas: 0, activo: true });
    expect(m.db.eventos.some((e) => e.clave === "sin_cupo_global:2026-11-01:quota")).toBe(true);
  });

  it("SerpApi responde «sin búsquedas» (quota): no es una falla del vuelo ni dispara el aviso de fuente no concluyente", async () => {
    const m = montar("2026-11-02T06:00:00Z"); // 4 h antes
    m.db.candidatos = [vueloDelViaje];
    for (const t of ["2026-11-02T06:00:00Z", "2026-11-02T07:00:00Z", "2026-11-02T08:00:00Z"]) {
      m.setNow(t);
      m.db.vuelos.forEach((v) => (v.proxima_revision_at = t));
      m.responder({ kind: "quota", message: "Your account has run out of searches." });
      const r = await correrVigilancia(m.deps, ["vuelos", "entregar"]);
      expect(r.vuelos.sin_cupo).toBe(true);
    }
    expect(m.llamadas.push).toHaveLength(0);
    expect(m.db.vuelos[0]).toMatchObject({ fallas_seguidas: 0, activo: true, claimed_at: null });
    expect(m.db.eventos.some((e) => e.tipo === "fuente_no_concluyente")).toBe(false);
  });

  it("tope propio por omisión coherente con el plan gratis (SERPAPI_DAILY_BUDGET = 8 → 4 para la vigilancia)", () => {
    expect(CONFIG_POR_OMISION.serp_tope_diario).toBe(4);
    expect(topeVigilanciaSugerido(8)).toBe(4);
    // El tope de la vigilancia nunca pasa de lo que el freno deja a lo «normal» (tope del día menos la reserva de vuelos).
    for (const b of [8, 20, 160, 500]) expect(topeVigilanciaSugerido(b)).toBeLessThanOrEqual(b - flightsReserve(b));
    expect(topeVigilanciaSugerido(null)).toBe(4);
  });
});

describe("confirmaciones previas de punta a punta", () => {
  beforeEach(() => { seq = 0; });
  const traslado = (p: Row = {}) => ({
    id: "c1", user_id: U, trip_id: TRIP, origen: "booking", origen_id: "b1", tipo: "traslado", proveedor: "Traslados Sol", correo: "reservas@trasladossol.mx",
    fuente: { kind: "sitio_oficial", url: "https://trasladossol.mx/contacto" }, zona_horaria: "America/Cancun", idioma: "es",
    servicio_at: "2026-11-03T20:00:00Z", servicio_local: "3 nov, 15:00", personas: 2, referencia: "TS-889", titular: "Ana Pérez", estado: "pendiente",
    enviar_desde: null, enviada_at: null, reply_token: "b".repeat(24), viajero: "Ana Pérez", ...p,
  });

  it("sin consentimiento → no se contacta al proveedor y queda anotado", async () => {
    const m = montar("2026-11-02T16:00:00Z");
    m.db.confirmaciones = [traslado()];
    const r = await correrVigilancia(m.deps, ["confirmaciones"]);
    expect(m.llamadas.correos).toHaveLength(0);
    expect(m.db.confirmaciones[0].estado).toBe("sin_consentimiento");
    expect(r.confirmaciones.sin_consentimiento).toBe(1);
    expect(m.db.eventos.some((e) => e.tipo === "sin_consentimiento")).toBe(true);
  });

  it("traslado sin confirmar → correo con fuente en su horario; sin respuesta a tiempo → incidente preventivo antes de llegar", async () => {
    const m = montar("2026-11-02T16:00:00Z"); // 10:00 en Cancún, 28 h antes
    m.db.prefs.set(U, true);
    m.db.confirmaciones = [traslado()];
    await correrVigilancia(m.deps, ["confirmaciones"]);
    expect(m.llamadas.correos).toHaveLength(1);
    expect(m.llamadas.correos[0]).toMatchObject({ to: "reservas@trasladossol.mx", replyTo: `confirma+${"b".repeat(24)}@reply.traveliatos.life` });
    expect(m.llamadas.correos[0].text).toMatch(/reconfirmar su reserva de traslado el 3 nov, 15:00 para 2 personas/);
    expect(m.db.confirmaciones[0].estado).toBe("enviada");
    // 13 h después nadie respondió.
    m.setNow("2026-11-03T05:30:00Z");
    await correrVigilancia(m.deps, ["confirmaciones", "entregar"]);
    expect(m.db.incidentes).toHaveLength(1);
    expect(m.db.incidentes[0]).toMatchObject({ categoria: "reserva_problema", origen: "proveedor", idem_key: "confirmacion:c1", playbook: "confirmacion_previa_v1" });
    expect(m.db.confirmaciones[0].estado).toBe("sin_respuesta");
    expect(m.llamadas.equipo).toHaveLength(1);
    // Faltan 14 h y en Cancún son las 00:30: el viajero (que nunca eligió horario) lo sabe a las 8:00, no de madrugada.
    // Queda en la app ya y espera en la cola de canales (channel_deferred) hasta el fin del no molestar.
    expect(m.llamadas.push).toHaveLength(0);
    expect(m.db.diferidos).toHaveLength(1);
    expect(m.db.diferidos[0].send_after).toBe("2026-11-03T13:00:00.000Z"); // 08:00 en Cancún
    m.setNow("2026-11-03T13:30:00Z");
    await correrVigilancia(m.deps, ["entregar"]);
    await m.vigilante();
    expect(m.llamadas.push[0].titulo).toBe("Estamos asegurando el traslado con Traslados Sol");
    // No se repite.
    await correrVigilancia(m.deps, ["confirmaciones", "entregar"]);
    await m.vigilante();
    expect(m.db.incidentes).toHaveLength(1);
    expect(m.llamadas.push).toHaveLength(1);
  });

  it("fuera del horario del proveedor se programa para que abra", async () => {
    const m = montar("2026-11-02T06:00:00Z"); // 01:00 en Cancún
    m.db.prefs.set(U, true);
    m.db.confirmaciones = [traslado()];
    await correrVigilancia(m.deps, ["confirmaciones"]);
    expect(m.llamadas.correos).toHaveLength(0);
    expect(m.db.confirmaciones[0]).toMatchObject({ estado: "programada", enviar_desde: "2026-11-02T13:00:00.000Z" }); // 08:00 en Cancún
  });

  it("respuesta del proveedor: confirma (remitente verificado) → confirmada; problema → incidente preventivo", async () => {
    const m = montar("2026-11-02T18:00:00Z");
    m.db.prefs.set(U, true);
    m.db.confirmaciones = [traslado({ estado: "enviada", enviada_at: "2026-11-02T16:00:00Z" }), traslado({ id: "c2", origen_id: "b2", reply_token: "c".repeat(24) })];
    const ok = await respuestaConfirmacion({ ...m.deps, receivedEmail: async () => ({ from: "Traslados Sol <reservas@trasladossol.mx>", subject: "Re: Reconfirmación",
      text: "Confirmado, los esperamos a las 15:00 en la salida del aeropuerto.", authentication: { dmarc: "pass", dkim: "pass", spf: "pass" }, message_id: "<m1>" }) },
      { token: "b".repeat(24), emailId: "e1", eventId: "ev1" });
    expect(ok.body).toMatchObject({ resultado: "confirma", verified: true });
    expect(m.db.confirmaciones[0].estado).toBe("confirmada");
    expect(m.db.avisos.some((a) => a.clave === "aviso:confirmada:c1")).toBe(true);
    m.db.confirmaciones[1].estado = "enviada";
    const mal = await respuestaConfirmacion({ ...m.deps, receivedEmail: async () => ({ from: "reservas@trasladossol.mx", subject: "Re",
      text: "Lo sentimos, no tenemos ninguna reserva a ese nombre.", authentication: { dmarc: "pass" }, message_id: "<m2>" }) },
      { token: "c".repeat(24), emailId: "e2", eventId: "ev2" });
    expect(mal.body).toMatchObject({ resultado: "problema" });
    expect(m.db.incidentes).toHaveLength(1);
    expect(m.db.incidentes[0].descripcion).toMatch(/hay un problema con el traslado/);
    // Un remitente no verificado que "confirma" NO cuenta como confirmación.
    m.db.confirmaciones.push(traslado({ id: "c3", origen_id: "b3", reply_token: "d".repeat(24), estado: "enviada" }));
    const falso = await respuestaConfirmacion({ ...m.deps, receivedEmail: async () => ({ from: "otro@gmail.com", text: "Confirmado", authentication: { dmarc: "fail" } }) },
      { token: "d".repeat(24), emailId: "e3", eventId: "ev3" });
    expect(falso.body).toMatchObject({ resultado: "ambigua", verified: false });
    expect(m.db.confirmaciones.find((c) => c.id === "c3").estado).not.toBe("confirmada");
  });
});

describe("avisos de viaje de punta a punta", () => {
  beforeEach(() => { seq = 0; });
  it("check-in y documentos: una sola vez, a buena hora local y con tope diario", async () => {
    const m = montar("2026-11-01T09:00:00Z"); // 03:00 en CDMX
    m.db.candidatos = [{ ...vueloDelViaje, vuelo: "AM401", hora_salida: "21:40", origen: "MEX", destino: "JFK", fecha: "2026-11-02" }];
    m.db.viajes = [{ id: TRIP, user_id: U, destino: "Nueva York", fecha_salida: "2026-11-02", fecha_regreso: "2026-11-09", ciudad_origen: "Ciudad de México",
      documentos: [{ id: "p1", kind: "pasaporte", title: "Pasaporte", country_code: "MX", expires_on: "2027-02-01", valid_from: null }] }];
    m.responder(widget({ status: "a tiempo", origin: "MEX", destination: "JFK", departure_at: "2026-11-03T03:40:00.000Z", arrival_at: "2026-11-03T09:00:00.000Z" }));
    await correrVigilancia(m.deps);
    // Documentos: visa de EUA y pasaporte con menos de 6 meses → encolados, pero son las 3 a.m.: esperan.
    expect(m.db.avisos.map((a) => a.clave).sort()).toEqual(["checkin:" + m.db.vuelos[0].id, `docs:${TRIP}:entrada:US`, `docs:${TRIP}:pasaporte_6m`].sort());
    expect(m.llamadas.push).toHaveLength(0);
    m.setNow("2026-11-01T16:00:00Z"); // 10:00 en CDMX
    await correrVigilancia(m.deps, ["avisos_viaje", "entregar"]);
    expect(m.llamadas.push.map((p) => p.titulo)).toEqual(expect.arrayContaining(["EUA pide visa con pasaporte mexicano · Nueva York"]));
    m.setNow("2026-11-02T04:00:00Z"); // check-in: 24 h antes de las 21:40 (22:00 del 1 nov en CDMX: no molestar por omisión)
    await correrVigilancia(m.deps, ["avisos_viaje", "entregar"]);
    await m.vigilante();
    expect(m.llamadas.push.map((p) => p.titulo)).not.toContain("Check-in en línea · AM401");
    m.setNow("2026-11-02T15:00:00Z");
    await correrVigilancia(m.deps, ["avisos_viaje", "entregar"]);
    await m.vigilante();
    const titulos = m.llamadas.push.map((p) => p.titulo);
    expect(titulos.filter((x) => x === "Check-in en línea · AM401")).toHaveLength(1);
    expect(new Set(titulos).size).toBe(titulos.length); // nada repetido
  });
});

describe("correo del proveedor: confirma+<token>@ llega a la vigilancia (firma Svix de reclamos-inbound)", () => {
  const tok = "e".repeat(24);
  it("ruta y exclusión de Reservas IA", () => {
    expect(rutaEntrante([`confirma+${tok}@reply.traveliatos.life`])).toEqual({ tipo: "confirmacion", token: tok });
    expect(esCorreoDeReclamos([`Hotel <confirma+${tok}@reply.traveliatos.life>`])).toBe(true);
    expect(rutaEntrante([`reservas+${tok}@reply.traveliatos.life`]).tipo).toBe("reserva");
  });
  it("handleInbound entrega la respuesta firmada a confirmacionEntrante; sin firma, 401", async () => {
    const secret = "whsec_" + Buffer.from("secreto-de-prueba-32-bytes-xxxxx").toString("base64");
    const raw = JSON.stringify({ type: "email.received", data: { email_id: "em_1", to: [`confirma+${tok}@reply.traveliatos.life`] } });
    const now = new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const sig = await signSvix(secret, "msg_1", ts, raw);
    let recibido: unknown = null;
    const deps = { db: { rpc: async () => ({ data: null, error: null }) }, config: { inboundSecret: secret, appUrl: "https://traveliatos.life" }, now: () => now,
      confirmacionEntrante: async (x: unknown) => { recibido = x; return { status: 200, body: { ok: true } }; } } as unknown as ReclamosDeps;
    const ok = await handleInbound(deps, new Headers({ "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` }), raw);
    expect(ok.status).toBe(200);
    expect(recibido).toEqual({ token: tok, emailId: "em_1", eventId: "msg_1" });
    const no = await handleInbound(deps, new Headers({ "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": "v1,falsa" }), raw);
    expect(no.status).toBe(401);
  });
});
