// PARTE A · Integración: los reclamos y quejas (derechos) abren su caso en el núcleo de incidentes y cada paso del
// reclamo queda en la bitácora del caso. Sin red, sin correos reales: base de incidentes y de reclamos en memoria.
// Antes de conectar nucleoDesdeEntorno() el adaptador era nulo: ningún reclamo abría caso (prueba "antes").
import { describe, expect, it } from "vitest";
import { createFakeIncidentDb } from "./helpers/fakeIncidentDb";
import { fakeClaimsDb } from "./helpers/fakeClaimsDb";
import {
  confirmarEnvio, handleInbound, prepararReclamoServicio, prepararReclamoVuelo, type ReclamosDeps, registrarQueja, resolverReclamo,
} from "../../supabase/functions/_shared/derechos/servicio";
import { nucleoNulo } from "../../supabase/functions/_shared/derechos/nucleo";
import { categoriaDeReclamo, claveCaso, nucleoSobreIncidentes } from "../../supabase/functions/_shared/derechos/nucleoIncidentes";
import { autoOpenIncident } from "../../supabase/functions/concierge-chat/incident";
import { reportIncident } from "../../supabase/functions/_shared/incident-report";
import { signSvix } from "../../supabase/functions/_shared/ai-reservations/signature";
import { RESPUESTA_TOOL_NAME } from "../../supabase/functions/_shared/derechos/respuesta";

const USER = "0c000000-0000-4000-8000-00000000000a";
const NOW = new Date("2026-10-29T18:00:00Z");
const SECRET = "whsec_" + btoa("secreto-de-prueba-reclamos-1234567890");
const CASO = { evento: "cancelacion" as const, origen: "MAD", destino: "MEX", aerolinea: "IB", vuelo: "IB6403", fecha: "2026-10-26", aviso_dias: 3, reubicacion: { ofrecida: false }, motivo: "razones operativas" };

function setup(nucleoReal = true, opts: { modelo?: (p: unknown) => unknown } = {}) {
  const inc = createFakeIncidentDb({ start: NOW, operatorAlive: true });
  const claims = fakeClaimsDb({ flag: true, now: () => NOW });
  const sent: { to: string | string[]; subject: string }[] = [];
  const correos = new Map<string, unknown>();
  const deps: ReclamosDeps = {
    db: { rpc: claims.rpc as never },
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: `re_${sent.length}` }; },
    callModel: async (payload) => ({ ok: true, status: 200, data: opts.modelo ? opts.modelo(payload) : null }),
    receivedEmail: async (id) => (correos.get(id) as never) ?? null,
    profile: async () => ({ name: "Ana Viajera", email: "ana@cliente.example" }),
    nucleo: nucleoReal ? nucleoSobreIncidentes(inc, { hoy: () => "2026-10-29", origen: "iato" }) : nucleoNulo,
    config: { replyDomain: "reply.traveliatos.life", inboundSecret: SECRET, appUrl: "https://traveliatos.life/dashboard" },
    now: () => NOW,
  };
  return { inc, claims, deps, sent, correos };
}

describe("derechos → incidentes (nucleoDesdeEntorno conectado)", () => {
  it("ANTES (adaptador nulo): preparar un reclamo no abría ningún caso", async () => {
    const t = setup(false);
    const r = await prepararReclamoVuelo(t.deps, USER, { caso: CASO });
    expect(r.status).toBe(200);
    expect(t.inc.incidents.size).toBe(0);
  });

  it("AHORA: el reclamo abre su caso (vuelo cancelado) y la bitácora registra preparado → enviado → respuesta → resuelto", async () => {
    const t = setup(true, {
      modelo: () => ({ model: "x", stop_reason: "tool_use", content: [{ type: "tool_use", name: RESPUESTA_TOOL_NAME, input: {
        resultado: "acepto", monto_ofrecido: 600, moneda: "EUR", vale: null, datos_pedidos: null, motivo_rechazo: null,
        alega_circunstancias_extraordinarias: false, numero_caso_proveedor: null, citas: ["we will pay EUR 600"], idioma: "en",
        resumen_es: "Iberia acepta pagar 600 EUR." } }] }),
    });
    const r = await prepararReclamoVuelo(t.deps, USER, { caso: CASO, correo_proveedor: { email: "claims@iberia.example", fuente: "usuario_confirmado" } });
    expect(r.status).toBe(200);
    const claim = r.body.claim as Record<string, unknown>;
    expect(t.inc.incidents.size).toBe(1);
    const caso = [...t.inc.incidents.values()][0];
    expect(caso.categoria).toBe("vuelo_cancelado");
    expect(caso.idemKey).toBe(claveCaso(USER, "vuelo_cancelado", "2026-10-29"));
    expect(claim.incident_id).toBe(caso.id);
    expect(caso.events.some((e) => e.data?.reclamo_evento === "reclamo_preparado" && /folio C-/.test(String(e.body)))).toBe(true);

    await confirmarEnvio(t.deps, USER, { id: String(claim.id), confirm: true });
    expect(caso.events.some((e) => e.data?.reclamo_evento === "reclamo_enviado" && e.channel === "email" && e.direction === "saliente")).toBe(true);

    const raw = JSON.stringify({ type: "email.received", data: { email_id: "em-1", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] } });
    const ts = Math.floor(NOW.getTime() / 1000);
    const h = { "svix-id": "evt_1", "svix-timestamp": String(ts), "svix-signature": `v1,${await signSvix(SECRET, "evt_1", ts, raw)}` };
    t.correos.set("em-1", { from: "claims@iberia.example", subject: "Re", text: "we will pay EUR 600", created_at: NOW.toISOString(), message_id: "<m1@x>", authentication: { dkim: "pass", dmarc: "pass" } });
    await handleInbound(t.deps, new Headers(h), raw);
    const resp = caso.events.find((e) => e.data?.reclamo_evento === "respuesta_proveedor");
    expect(resp).toMatchObject({ actor: "proveedor", direction: "entrante", kind: "mensaje" });

    await resolverReclamo(t.deps, USER, { id: String(claim.id) });
    // El sistema NO cierra: queda esperando que el viajero confirme.
    expect(caso.events.some((e) => e.kind === "estado" && /esperando confirmación/.test(String(e.body)))).toBe(true);
    expect(caso.resolvedAt).toBeNull();
  });

  it("sin duplicados: Iato abrió el caso por detección y el reclamo del mismo día se suma a ese caso", async () => {
    const t = setup(true);
    const report = (input: Parameters<typeof reportIncident>[1]) => reportIncident({ db: t.inc, deliver: async () => ({ sent: 1, failed: 0 }) }, input);
    const abierto = await autoOpenIncident("Me cancelaron el vuelo IB6403 de Madrid a México", { userId: USER, todayISO: "2026-10-29", tz: "Europe/Madrid" }, { report });
    expect(abierto?.categoria).toBe("vuelo_cancelado");
    const r = await prepararReclamoVuelo(t.deps, USER, { caso: CASO });
    expect(t.inc.incidents.size).toBe(1);
    expect((r.body.claim as Record<string, unknown>).incident_id).toBe(abierto!.id);
  });

  it("con el caso que atiende el operador (casoActual) solo se anota, nunca abre otro", async () => {
    const t = setup(true);
    const report = (input: Parameters<typeof reportIncident>[1]) => reportIncident({ db: t.inc, deliver: async () => ({ sent: 1, failed: 0 }) }, input);
    const caso = await report({ userId: USER, descripcion: "El hotel me cobró dos veces la noche", origen: "usuario", canal: "app" });
    expect(caso.ok).toBe(true);
    if (!caso.ok) return;
    t.deps.nucleo = nucleoSobreIncidentes(t.inc, { casoActual: caso.id });
    await prepararReclamoServicio(t.deps, USER, { caso: { problema: "cobro_doble", proveedor: { nombre: "Hotel Roma Centro", tipo: "hotel", pais: "IT" }, monto_cobrado_de_mas: 180, moneda: "EUR", pagado_con: "tarjeta_credito" } });
    expect(t.inc.incidents.size).toBe(1);
    expect(t.inc.incidents.get(caso.id)!.events.filter((e) => e.data?.reclamo_evento === "reclamo_preparado")).toHaveLength(1);
  });

  it("una queja (contra IATOS o un proveedor) abre caso de categoría queja con su subtipo", async () => {
    const t = setup(true);
    const r = await registrarQueja(t.deps, USER, { texto: "Su app me dio un hotel equivocado y nadie me contesta", contra: "iatos" });
    expect(r.status).toBe(200);
    const caso = [...t.inc.incidents.values()][0];
    expect(caso.categoria).toBe("queja");
    expect((caso.payload.queja as { subtipo: string }).subtipo).toBe("servicio_iatos");
    expect((r.body.caso as { id: string }).id).toBe(caso.id);
  });

  it("categoría por tipo de reclamo", () => {
    expect(categoriaDeReclamo({ tipo: "reclamo_vuelo", datos: { evento: "sobreventa" } })).toBe("overbooking");
    expect(categoriaDeReclamo({ tipo: "reclamo_vuelo", datos: { evento: "equipaje_perdido" } })).toBe("equipaje");
    expect(categoriaDeReclamo({ tipo: "reclamo_servicio", datos: { problema: "cobro_doble" } })).toBe("cobro_reembolso");
    expect(categoriaDeReclamo({ tipo: "reclamo_servicio", datos: { problema: "servicio_no_prestado", tipo_proveedor: "traslado" } })).toBe("traslado_no_llego");
    expect(categoriaDeReclamo({ tipo: "reclamo_servicio", datos: { problema: "reserva_no_encontrada", tipo_proveedor: "hotel" } })).toBe("hotel_problema");
    expect(categoriaDeReclamo({ tipo: "queja_proveedor", datos: {} })).toBe("queja");
  });
});
