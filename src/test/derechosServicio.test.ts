// Punta a punta del envío y seguimiento de reclamos, con dobles (sin red, sin correos reales):
// preparar → consentimiento → envío → respuesta firmada del proveedor (IA con salida estructurada) →
// siguiente paso → recordatorio único → escalamiento al organismo → reenvío del usuario → quejas.
// La base real (RPC y CHECK) se prueba aparte en supabase/tests/reclamos.
import { describe, expect, it } from "vitest";
import { signSvix } from "../../supabase/functions/_shared/ai-reservations/signature";
import { handleInbound as reservasInbound, type ServiceDeps } from "../../supabase/functions/_shared/ai-reservations/service";
import {
  confirmarEnvio, escalarReclamo, estadoReclamos, handleInbound, marcarEnviadoPorUsuario, prepararReclamoServicio, prepararReclamoVuelo,
  type ReclamosDeps, registrarQueja, runSeguimiento,
} from "../../supabase/functions/_shared/derechos/servicio";
import type { NucleoIncidentes } from "../../supabase/functions/_shared/derechos/nucleo";
import { RESPUESTA_TOOL_NAME } from "../../supabase/functions/_shared/derechos/respuesta";

const USER = "0c000000-0000-0000-0000-00000000000a";
const SECRET = "whsec_" + btoa("secreto-de-prueba-reclamos-1234567890");
const NOW = new Date("2026-10-29T18:00:00Z");

import { fakeClaimsDb as fakeDb, type Row } from "./helpers/fakeClaimsDb";

type Sent = { to: string | string[]; subject: string; text: string; from?: string; replyTo?: string };

function setup(opts: { flag?: boolean; modelo?: (payload: any) => any } = {}) {
  const state = { flag: opts.flag ?? true, now: () => clock.now };
  const clock = { now: NOW };
  const db = fakeDb(state);
  const sent: Sent[] = [];
  const correos = new Map<string, any>();
  const incidentes: Array<{ tipo: string; datos?: any }> = [];
  const nucleo: NucleoIncidentes = {
    crear: async (i) => { incidentes.push({ tipo: i.tipo, datos: i }); return { id: `inc-${incidentes.length}` }; },
    evento: async (id, e) => { incidentes.push({ tipo: `evento:${id}:${e.tipo}` }); },
    estado: async (id, s) => { incidentes.push({ tipo: `estado:${id}:${s}` }); },
  };
  const llamadasModelo: any[] = [];
  const deps: ReclamosDeps = {
    db: { rpc: db.rpc as never },
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: `re_${sent.length}` }; },
    callModel: async (payload) => { llamadasModelo.push(payload); return { ok: true, status: 200, data: opts.modelo ? opts.modelo(payload) : null }; },
    receivedEmail: async (id) => correos.get(id) ?? null,
    profile: async () => ({ name: "Rodrigo del Castillo", email: "rodrigo@cliente.example" }),
    nucleo,
    config: { replyDomain: "reply.traveliatos.life", inboundSecret: SECRET, appUrl: "https://traveliatos.life/dashboard" },
    now: () => clock.now,
  };
  return { deps, db, sent, correos, incidentes, clock, state, llamadasModelo };
}

async function webhook(deps: ReclamosDeps | ServiceDeps, eventId: string, data: Record<string, unknown>, secret = SECRET) {
  const body = JSON.stringify({ type: "email.received", data });
  const ts = Math.floor(NOW.getTime() / 1000);
  const headers = new Headers({ "svix-id": eventId, "svix-timestamp": String(ts), "svix-signature": `v1,${await signSvix(secret, eventId, ts, body)}` });
  return (handleInbound as any)(deps, headers, body);
}

const toolUse = (input: Record<string, unknown>) => ({ model: "claude-test", stop_reason: "tool_use", content: [{ type: "tool_use", name: RESPUESTA_TOOL_NAME, input }] });
const CASO = { evento: "cancelacion" as const, origen: "MAD", destino: "MEX", aerolinea: "IB", vuelo: "IB6403", fecha: "2026-10-26", aviso_dias: 3, reubicacion: { ofrecida: false }, motivo: "razones operativas" };

describe("reclamo por correo de punta a punta (con dobles)", () => {
  it("preparar → sin consentimiento no sale nada → con bandera apagada tampoco → con ok se envía con Reply-To propio", async () => {
    const t = setup({ flag: false });
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO, pasajero: { reserva: "ABC123" }, correo_proveedor: { email: "Customer.Relations@iberia.example", fuente: "usuario_confirmado", detalle: "Se lo dio la aerolínea por escrito" } });
    expect(prep.status).toBe(200);
    const claim = prep.body.claim as Row;
    expect(claim.ref_code).toBe("C-TEST01");
    expect(String(claim.subject)).toContain("Ref. C-TEST01"); // el folio real reemplazó al provisional
    expect(String(claim.body_text)).not.toContain("C-PENDIENTE");
    expect(prep.body.siguiente).toBe("confirmar_envio");
    expect(String(prep.body.confirmacion)).toContain("customer.relations@iberia.example");
    expect(claim.incident_id).toBe("inc-1"); // caso abierto en el núcleo
    expect(t.incidentes[0].tipo).toBe("reclamo_vuelo");

    expect((await confirmarEnvio(t.deps, USER, { id: claim.id })).body.code).toBe("CONSENT_REQUIRED");
    expect((await confirmarEnvio(t.deps, USER, { id: claim.id, confirm: true })).body.code).toBe("FEATURE_DISABLED");
    expect(t.sent).toHaveLength(0);

    t.state.flag = true;
    const env = await confirmarEnvio(t.deps, USER, { id: claim.id, confirm: true, cc_me: true });
    expect(env.status).toBe(200);
    expect(t.sent[0]).toMatchObject({ to: "customer.relations@iberia.example", replyTo: `reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`, from: "Rodrigo del Castillo vía IATOS <reclamos@traveliatos.life>" });
    expect(t.sent[0].subject).toContain("Reclamación formal");
    expect(t.sent[1]).toMatchObject({ to: "rodrigo@cliente.example" }); // copia al usuario
    expect(t.db.claims.get(claim.id)!.status).toBe("enviado");
    expect(t.incidentes.map((i) => i.tipo)).toContain("evento:inc-1:reclamo_enviado");
    // Una segunda confirmación no vuelve a enviar.
    expect((await confirmarEnvio(t.deps, USER, { id: claim.id, confirm: true })).body.code).toBe("ALREADY_SENT");
    expect(t.sent).toHaveLength(2);
  });

  it("sin correo verificado: la carta se prepara para el formulario oficial y el usuario marca que lo envió", async () => {
    const t = setup();
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO });
    expect(prep.body.siguiente).toBe("enviar_tu_mismo");
    expect((prep.body.carta as Row).url).toBe("https://www.iberia.com/us/claims-receipts/");
    expect((prep.body.carta as Row).para).toBeNull();
    const id = (prep.body.claim as Row).id;
    expect((await confirmarEnvio(t.deps, USER, { id, confirm: true })).body.code).toBe("NO_EMAIL");
    const yo = await marcarEnviadoPorUsuario(t.deps, USER, { id, numero_caso: "IB-99812" });
    expect(yo.body.ok).toBe(true);
    expect(t.db.claims.get(id)!.consent).toMatchObject({ via: "usuario", case_number: "IB-99812" });
    expect(t.sent).toHaveLength(0);
  });

  it("respuesta firmada del proveedor que ofrece un vale → no se da por aceptado; se propone exigir dinero (art. 7(3))", async () => {
    const t = setup({ modelo: () => toolUse({ resultado: "ofrece_vale", monto_ofrecido: null, moneda: null, vale: { valor: 600, moneda: "EUR", vigencia: "12 meses" }, datos_pedidos: null, motivo_rechazo: null, alega_circunstancias_extraordinarias: false, numero_caso_proveedor: "IB-5551", citas: ["we can offer you a travel voucher of 600 EUR"], idioma: "en", resumen_es: "Iberia ofrece un vale de 600 EUR." }) });
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO, correo_proveedor: { email: "customer.relations@iberia.example", fuente: "usuario_confirmado" } });
    const id = (prep.body.claim as Row).id;
    await confirmarEnvio(t.deps, USER, { id, confirm: true });
    t.correos.set("em-1", { from: "Iberia Customer Relations <customer.relations@iberia.example>", subject: "RE: Reclamación formal · Ref. C-TEST01", text: "Dear customer, we can offer you a travel voucher of 600 EUR valid for 12 months.", created_at: NOW.toISOString(), message_id: "<m1@iberia.example>", authentication: { spf: "pass", dkim: "pass", dmarc: "pass" } });

    // Sin firma válida no se lee nada.
    const malo = await webhook(t.deps, "evt_1", { email_id: "em-1", from: "customer.relations@iberia.example", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] }, "whsec_" + btoa("otro-secreto-cualquiera-0000000000"));
    expect(malo.status).toBe(401);
    expect(t.llamadasModelo).toHaveLength(0);

    const r = await webhook(t.deps, "evt_1", { email_id: "em-1", from: "customer.relations@iberia.example", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] });
    expect(r.body).toMatchObject({ ok: true, resultado: "ofrece_vale", siguiente: "rechazar_vale", status: "necesita_usuario" });
    const c = t.db.claims.get(id)!;
    expect(c.reply.remitente_verificado).toBe(true);
    expect(c.reply.siguiente.borrador).toContain("artículo 7(3) del Reglamento (CE) 261/2004");
    // El usuario recibe la noticia por correo.
    expect(t.sent.at(-1)).toMatchObject({ to: "rodrigo@cliente.example" });
    expect(t.sent.at(-1)!.text).toContain("No estás obligado a aceptarlo");
    // El mismo evento otra vez no se procesa dos veces.
    expect((await webhook(t.deps, "evt_1", { email_id: "em-1", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] })).body.duplicate).toBe(true);
    expect(t.llamadasModelo).toHaveLength(1);
  });

  it("un «aceptamos» con una cita que no está en el correo, o de un remitente no verificado, NO se da por aceptado", async () => {
    const t = setup({ modelo: () => toolUse({ resultado: "acepto", monto_ofrecido: 600, moneda: "EUR", vale: null, datos_pedidos: null, motivo_rechazo: null, alega_circunstancias_extraordinarias: false, numero_caso_proveedor: null, citas: ["We will pay 600 EUR"], idioma: "en", resumen_es: "Aceptan pagar 600 EUR." }) });
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO, correo_proveedor: { email: "customer.relations@iberia.example", fuente: "usuario_confirmado" } });
    const id = (prep.body.claim as Row).id;
    await confirmarEnvio(t.deps, USER, { id, confirm: true });
    t.correos.set("em-2", { from: "customer.relations@iberia.example", subject: "Re", text: "Thank you, your request is under review.", created_at: NOW.toISOString(), message_id: "<m2@x>", authentication: { spf: "pass", dkim: "pass", dmarc: "pass" } });
    const r = await webhook(t.deps, "evt_2", { email_id: "em-2", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] });
    expect(r.body.resultado).toBe("otro");
    expect(t.db.claims.get(id)!.reply.por_que).toBe("sin_cita_verificable");
    // Remitente falso (DMARC fail) con la cita correcta → tampoco.
    t.correos.set("em-3", { from: "customer.relations@iberia.example", subject: "Re", text: "We will pay 600 EUR within 7 days.", created_at: NOW.toISOString(), message_id: "<m3@x>", authentication: { spf: "fail", dkim: "fail", dmarc: "fail" } });
    const r2 = await webhook(t.deps, "evt_3", { email_id: "em-3", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] });
    expect(r2.body.resultado).toBe("otro");
    expect(t.db.claims.get(id)!.reply.por_que).toBe("remitente_no_verificado");
  });

  it("rechazo → listo para escalar, con la carta para la autoridad del país (AESA) que se crea solo si el usuario lo pide", async () => {
    const t = setup({ modelo: () => toolUse({ resultado: "rechazo", monto_ofrecido: null, moneda: null, vale: null, datos_pedidos: null, motivo_rechazo: "Circunstancias extraordinarias", alega_circunstancias_extraordinarias: true, numero_caso_proveedor: null, citas: ["the cancellation was due to extraordinary circumstances"], idioma: "en", resumen_es: "Iberia rechaza por circunstancias extraordinarias." }) });
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO, correo_proveedor: { email: "customer.relations@iberia.example", fuente: "usuario_confirmado" } });
    const id = (prep.body.claim as Row).id;
    await confirmarEnvio(t.deps, USER, { id, confirm: true });
    t.correos.set("em-4", { from: "customer.relations@iberia.example", subject: "Re", text: "We regret that the cancellation was due to extraordinary circumstances.", created_at: NOW.toISOString(), message_id: "<m4@x>", authentication: { dkim: "pass", dmarc: "pass" } });
    const r = await webhook(t.deps, "evt_4", { email_id: "em-4", to: [`reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life`] });
    expect(r.body).toMatchObject({ resultado: "rechazo", siguiente: "escalar", status: "escalable" });
    const esc = await escalarReclamo(t.deps, USER, { id });
    expect(esc.status).toBe(200);
    const hijo = esc.body.claim as Row;
    expect(hijo).toMatchObject({ target: "organismo", provider_name: "Agencia Estatal de Seguridad Aérea (AESA) — División de Derechos de los Pasajeros", channel: "formulario", parent_id: id });
    expect(String(hijo.body_text)).toContain("Iberia rechaza por circunstancias extraordinarias.");
    expect(t.db.claims.get(id)!.status).toBe("escalado");
    expect(esc.body.siguiente).toBe("enviar_tu_mismo");
  });

  it("seguimiento: UN recordatorio al vencer el plazo, en el mismo hilo; al vencer el de escalar pasa a escalable y avisa al usuario", async () => {
    const t = setup();
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: { ...CASO, aerolinea: "KL", origen: "AMS" }, correo_proveedor: { email: "claims@klm.example", fuente: "usuario_confirmado" } });
    const id = (prep.body.claim as Row).id;
    await confirmarEnvio(t.deps, USER, { id, confirm: true });
    expect(t.sent).toHaveLength(1);
    t.clock.now = new Date(NOW.getTime() + 10 * 86_400_000);
    expect((await runSeguimiento(t.deps)).body).toMatchObject({ recordados: 0 });
    t.clock.now = new Date(NOW.getTime() + 17 * 86_400_000); // 14 + 2 días
    expect((await runSeguimiento(t.deps)).body).toMatchObject({ recordados: 1, escalables: 0 });
    expect(t.sent[1]).toMatchObject({ to: "claims@klm.example", replyTo: `reclamos+${"1".padStart(24, "a")}@reply.traveliatos.life` });
    expect(t.sent[1].subject).toMatch(/^Re: /);
    expect(t.sent[1].text).toContain("17 days have passed without a reply"); // KLM → inglés
    expect((await runSeguimiento(t.deps)).body).toMatchObject({ recordados: 0 }); // nunca dos
    t.clock.now = new Date(NOW.getTime() + 61 * 86_400_000); // UE: 2 meses
    expect((await runSeguimiento(t.deps)).body).toMatchObject({ escalables: 1 });
    expect(t.db.claims.get(id)!.status).toBe("escalable");
    expect(t.sent.at(-1)).toMatchObject({ to: "rodrigo@cliente.example" });
    expect(t.sent.at(-1)!.text).toContain("solo se envía si tú lo autorizas");
  });

  it("con la bandera apagada el seguimiento no manda recordatorios", async () => {
    const t = setup();
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO, correo_proveedor: { email: "x@iberia.example", fuente: "usuario_confirmado" } });
    await confirmarEnvio(t.deps, USER, { id: (prep.body.claim as Row).id, confirm: true });
    t.state.flag = false;
    t.clock.now = new Date(NOW.getTime() + 20 * 86_400_000);
    expect((await runSeguimiento(t.deps)).body).toMatchObject({ recordados: 0 });
    expect(t.sent).toHaveLength(1);
  });
});

describe("correos que reenvía el usuario (casos+<token>@)", () => {
  it("de su propia cuenta y autenticado → se guarda y, con folio, se lee como respuesta (sin dar por verificado al proveedor)", async () => {
    const t = setup({ modelo: () => toolUse({ resultado: "acepto", monto_ofrecido: 600, moneda: "EUR", vale: null, datos_pedidos: null, motivo_rechazo: null, alega_circunstancias_extraordinarias: false, numero_caso_proveedor: null, citas: ["We have approved your compensation of EUR 600"], idioma: "en", resumen_es: "La aerolínea aprobó 600 EUR." }) });
    const prep = await prepararReclamoVuelo(t.deps, USER, { caso: CASO });
    const id = (prep.body.claim as Row).id;
    await marcarEnviadoPorUsuario(t.deps, USER, { id });
    const st = await estadoReclamos(t.deps, USER);
    expect(st.body.direccion_casos).toBe(`casos+${"f".repeat(24)}@reply.traveliatos.life`);
    t.correos.set("fw-1", { from: "Rodrigo <rodrigo@cliente.example>", subject: "Fwd: Your claim C-TEST01", text: "---------- Forwarded message ----------\nWe have approved your compensation of EUR 600.", created_at: NOW.toISOString(), message_id: "<fw1@cliente>", authentication: { dkim: "pass", dmarc: "pass" } });
    const r = await webhook(t.deps, "evt_f1", { email_id: "fw-1", to: [`casos+${"f".repeat(24)}@reply.traveliatos.life`] });
    expect(t.db.forward).toHaveLength(1);
    expect(t.db.forward[0]).toMatchObject({ claim_id: id, sender_verified: true });
    // "Aceptó" no se da por hecho: el remitente original (la aerolínea) no se puede verificar en un reenvío.
    expect(r.body.resultado).toBe("otro");
  });
  it("de otra dirección → se ignora sin guardar el contenido", async () => {
    const t = setup();
    await estadoReclamos(t.deps, USER);
    t.correos.set("fw-2", { from: "alguien@otro.example", subject: "hola", text: "x", created_at: NOW.toISOString(), message_id: "<fw2@x>", authentication: { dkim: "pass", dmarc: "pass" } });
    const r = await webhook(t.deps, "evt_f2", { email_id: "fw-2", to: [`casos+${"f".repeat(24)}@reply.traveliatos.life`] });
    expect(r.body.ignored).toBe("remitente_no_verificado");
    expect(t.db.forward).toHaveLength(0);
  });
  it("un correo a reservas+ no lo toca Reclamos, y Reservas IA no toca reclamos+/casos", async () => {
    const t = setup();
    const r = await webhook(t.deps, "evt_r", { email_id: "em-9", to: [`reservas+${"b".repeat(24)}@reply.traveliatos.life`] });
    expect(r.body.ignored).toBe("reserva");
    // Reservas IA (cambio mínimo en su service.ts): acusa recibo sin reclamar nada en su base.
    const llamadas: string[] = [];
    const resDeps = { db: { rpc: async (fn: string) => { llamadas.push(fn); return { data: true, error: null }; } }, config: { inboundSecret: SECRET, replyDomain: "reply.traveliatos.life" }, now: () => NOW } as unknown as ServiceDeps;
    const body = JSON.stringify({ type: "email.received", data: { email_id: "em-10", to: ["casos+" + "f".repeat(24) + "@reply.traveliatos.life"] } });
    const ts = Math.floor(NOW.getTime() / 1000);
    const headers = new Headers({ "svix-id": "evt_x", "svix-timestamp": String(ts), "svix-signature": `v1,${await signSvix(SECRET, "evt_x", ts, body)}` });
    const rr = await reservasInbound(resDeps, headers, body);
    expect(rr.body).toMatchObject({ ok: true, ignored: "reclamos" });
    expect(llamadas).toEqual([]);
  });
});

describe("hotel / traslado / agencia y quejas", () => {
  it("sobreventa de hotel: carta con fundamento LFPC, sin correo si no tiene fuente; caso abierto con gravedad alta", async () => {
    const t = setup();
    const r = await prepararReclamoServicio(t.deps, USER, { caso: { problema: "sobreventa_hotel", proveedor: { nombre: "Hotel Ejemplo Cancún", tipo: "hotel", pais: "MX" }, monto_pagado: 9000, moneda: "MXN", pagado_con: "tarjeta_credito" } });
    expect(r.body.siguiente).toBe("enviar_tu_mismo");
    expect(String((r.body.carta as Row).texto)).toContain("92 Bis y 92 Ter");
    expect(t.incidentes[0].datos.gravedad).toBe("alta");
  });
  it("queja contra IATOS: clasificación, caso abierto y respuesta empática honesta", async () => {
    const t = setup();
    const r = await registrarQueja(t.deps, USER, { texto: "La app de IATOS me dijo que mi reserva estaba confirmada y en el hotel no la tenían, estoy en recepción ahorita. Quiero que me devuelvan mi dinero." });
    const c = r.body.clasificacion as Row;
    expect(c).toMatchObject({ contra: "iatos", categoria: "hotel", que_espera: "reembolso", gravedad: "alta" });
    expect(t.incidentes[0].tipo).toBe("queja_iatos");
    expect(String(r.body.respuesta)).toContain("Abrí tu caso");
  });
  it("queja crítica (robo): gravedad crítica, urgente y la respuesta prioriza la seguridad", async () => {
    const t = setup();
    const r = await registrarQueja(t.deps, USER, { texto: "Me robaron el pasaporte y la cartera en el metro de Madrid, ¿qué hago?" });
    expect(r.body.clasificacion).toMatchObject({ gravedad: "critica", urgente: true, categoria: "seguridad" });
    expect(String(r.body.respuesta)).toMatch(/112/);
  });
  it("si el núcleo no está conectado, la respuesta lo dice (no promete que el equipo ya lo tiene)", async () => {
    const t = setup();
    t.deps.nucleo = undefined;
    const r = await registrarQueja(t.deps, USER, { texto: "El chofer no llegó al aeropuerto" });
    expect(r.body.caso).toBeNull();
    expect(String(r.body.respuesta)).toContain("No pude abrir el caso");
  });
});
