// Reservas gestionadas: la tarea (ejecuta solo lo aprobado por una persona y sincroniza estados), el webhook de
// proveedores, los traslados NO VERIFICADOS y el cargo por servicio. Con dobles: sin red y sin base real.
import { describe, expect, it, vi } from "vitest";
import { adaptadorDe, adaptadoresDesdeEnv, ejecutarSolicitudes, idParaProveedor, sincronizarReservas, type Adaptadores } from "../../supabase/functions/_shared/proveedores/registro";
import { crearTraslados } from "../../supabase/functions/_shared/proveedores/traslados";
import { firmaWebhookRatehawk } from "../../supabase/functions/_shared/proveedores/ratehawk";
import { manejarWebhook } from "../../supabase/functions/proveedores-webhook/handler";
import { calcularCargo, type ReglaCargo } from "../../supabase/functions/_shared/comisiones/cargo";
import orderInfo from "./fixtures/proveedores/ratehawk/order_info.json";
import orderCancel from "./fixtures/proveedores/ratehawk/order_cancel.json";

const r = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } });
const BOOKING = { id: "m1", ref_code: "R-AB23CD", provider: "ratehawk", environment: "sandbox" as const, provider_booking_id: "rh-1",
  partner_order_id: "tut", status: "confirmada" };

function entorno(rutas: Record<string, () => Response> = {}, env: Record<string, string> = { RATEHAWK_KEY_ID: "1", RATEHAWK_API_KEY: "k" }) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    urls.push(String(url));
    const k = Object.keys(rutas).find((x) => String(url).endsWith(x));
    return k ? rutas[k]() : r({ status: "error", error: "unknown" }, 400);
  }) as unknown as typeof fetch;
  const adaptadores = adaptadoresDesdeEnv((k) => env[k], fetchImpl);
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const respuestas: Record<string, unknown> = {};
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { data: respuestas[fn] ?? { ok: true }, error: null }; });
  return { adaptadores, urls, rpcs, rpc, respuestas };
}

describe("tarea reservas-gestionadas · ejecutar lo aprobado", () => {
  it("con la bandera de ejecución apagada (la base responde apagado) no llama a ningún proveedor", async () => {
    const e = entorno();
    e.respuestas.managed_requests_claim = { ok: true, apagado: true, solicitudes: [] };
    const out = await ejecutarSolicitudes({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => false });
    expect(out).toEqual({ apagado: true, tomadas: 0, hechas: 0, fallidas: 0 });
    expect(e.urls).toHaveLength(0);
  });

  it("cancelación aprobada en sandbox: cancela con el partner_order_id, registra el resultado ANTES y luego el estado", async () => {
    const e = entorno({ "/hotel/order/cancel/": () => r(orderCancel) });
    e.respuestas.managed_requests_claim = { ok: true, solicitudes: [{ id: "q1", kind: "cancelacion", details: {}, booking: BOOKING }] };
    const out = await ejecutarSolicitudes({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => false });
    expect(out).toMatchObject({ tomadas: 1, hechas: 1, fallidas: 0 });
    expect(e.urls).toEqual(["https://api-sandbox.ratehawk.com/api/b2b/v3/hotel/order/cancel/"]);
    expect(e.rpcs.map((x) => x.fn)).toEqual(["managed_requests_claim", "managed_request_finish", "managed_booking_apply_status"]);
    expect(e.rpcs[1].args).toMatchObject({ _id: "q1", _ok: true });
    expect(e.rpcs[2].args).toMatchObject({ _provider: "ratehawk", _environment: "sandbox", _provider_booking_id: "rh-1", _provider_status: "cancelled", _kind: "ejecucion" });
  });

  it("reserva de PRODUCCIÓN sin adaptador de producción (secretos de sandbox): falla registrada, nunca se usa la llave equivocada", async () => {
    const e = entorno({ "/hotel/order/cancel/": () => r(orderCancel) });
    e.respuestas.managed_requests_claim = { ok: true, solicitudes: [{ id: "q2", kind: "cancelacion", details: {}, booking: { ...BOOKING, environment: "produccion" } }] };
    const out = await ejecutarSolicitudes({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => true });
    expect(out).toMatchObject({ hechas: 0, fallidas: 1 });
    expect(e.urls).toHaveLength(0);
    expect(e.rpcs.find((x) => x.fn === "managed_request_finish")?.args).toMatchObject({ _ok: false, _result: { code: "SIN_CONFIGURAR" } });
    expect(e.rpcs.some((x) => x.fn === "managed_booking_apply_status")).toBe(false);
  });

  it("producción con secretos pero SIN la bandera proveedores_reservas_enabled: bloqueado, sin llamar", async () => {
    const e = entorno({}, { RATEHAWK_KEY_ID: "1", RATEHAWK_API_KEY: "k", RATEHAWK_ENTORNO: "produccion" });
    e.respuestas.managed_requests_claim = { ok: true, solicitudes: [{ id: "q3", kind: "cancelacion", details: {}, booking: { ...BOOKING, environment: "produccion" } }] };
    await ejecutarSolicitudes({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => false });
    expect(e.urls).toHaveLength(0);
    expect(e.rpcs.find((x) => x.fn === "managed_request_finish")?.args).toMatchObject({ _ok: false, _result: { code: "BLOQUEADO_PRODUCCION" } });
  });

  it("cambio en RateHawk: NO_SOPORTADO queda como fallida (una persona cancela y vuelve a reservar)", async () => {
    const e = entorno();
    e.respuestas.managed_requests_claim = { ok: true, solicitudes: [{ id: "q4", kind: "cambio", details: { nueva_fecha: "2026-12-24" }, booking: BOOKING }] };
    const out = await ejecutarSolicitudes({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => false });
    expect(out.fallidas).toBe(1);
    expect(e.rpcs.find((x) => x.fn === "managed_request_finish")?.args).toMatchObject({ _ok: false, _result: { code: "NO_SOPORTADO" } });
  });

  it("id que se le da a cada proveedor: RateHawk = nuestro partner_order_id; Viator = su bookingRef", () => {
    expect(idParaProveedor(BOOKING)).toBe("tut");
    expect(idParaProveedor({ ...BOOKING, provider: "viator", provider_booking_id: "BR-1234" })).toBe("BR-1234");
  });
});

describe("tarea reservas-gestionadas · sincronizar (solo lecturas)", () => {
  it("consulta cada reserva activa y aplica el estado del proveedor; marca las ya ocurridas", async () => {
    const e = entorno({ "/hotel/order/info/": () => r(orderInfo) });
    e.respuestas.managed_bookings_due_sync = [BOOKING];
    e.respuestas.managed_booking_apply_status = { ok: true, from: "confirmada", status: "cancelada" };
    e.respuestas.managed_bookings_complete_past = 2;
    const out = await sincronizarReservas({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => false });
    expect(out).toEqual({ revisadas: 1, cambios: 1, errores: 0, completadas: 2 });
    expect(e.rpcs.find((x) => x.fn === "managed_booking_apply_status")?.args).toMatchObject({ _provider_status: "cancelled", _kind: "sincronizacion" });
  });

  it("sin secretos del proveedor: cuenta el error y no inventa estado", async () => {
    const e = entorno({}, {});
    e.respuestas.managed_bookings_due_sync = [BOOKING];
    const out = await sincronizarReservas({ rpc: e.rpc, adaptadores: e.adaptadores, reservasRealesPermitidas: async () => false });
    expect(out).toMatchObject({ revisadas: 1, errores: 1, cambios: 0 });
    expect(e.rpcs.some((x) => x.fn === "managed_booking_apply_status")).toBe(false);
  });
});

describe("proveedores-webhook", () => {
  const cuerpo = async (key: string, data: Record<string, unknown>, token = "tok-0000000001") => {
    const timestamp = Math.floor(Date.now() / 1000);
    return { data, signature: { signature: await firmaWebhookRatehawk(key, timestamp, token), timestamp, token } };
  };

  it("RateHawk auténtico: token de un solo uso y estado aplicado; repetido → 200 sin aplicar", async () => {
    const e = entorno();
    e.respuestas.provider_webhook_token_once = true;
    const b = await cuerpo("k", { partner_order_id: "tut", status: "completed" });
    const out = await manejarWebhook("ratehawk", b, { rpc: e.rpc, adaptadores: e.adaptadores });
    expect(out.status).toBe(200);
    expect(e.rpcs.map((x) => x.fn)).toEqual(["provider_webhook_token_once", "managed_booking_apply_status"]);
    expect(e.rpcs[1].args).toMatchObject({ _provider_booking_id: "tut", _provider_status: "completed", _kind: "webhook", _environment: "sandbox" });
    e.respuestas.provider_webhook_token_once = false;
    const rep = await manejarWebhook("ratehawk", b, { rpc: e.rpc, adaptadores: e.adaptadores });
    expect(rep).toEqual({ status: 200, body: { ok: true, repetido: true } });
  });

  it("firma falsa → 401 y no toca la base; proveedor sin documentación → 404; sin secretos → 503", async () => {
    const e = entorno();
    const malo = await manejarWebhook("ratehawk", await cuerpo("otra", { partner_order_id: "tut", status: "completed" }), { rpc: e.rpc, adaptadores: e.adaptadores });
    expect(malo.status).toBe(401);
    expect(e.rpcs).toHaveLength(0);
    expect((await manejarWebhook("traslados", {}, { rpc: e.rpc, adaptadores: e.adaptadores })).body).toMatchObject({ code: "NO_VERIFICADO" });
    expect((await manejarWebhook("viator", {}, { rpc: e.rpc, adaptadores: e.adaptadores })).status).toBe(404);
    const sin = entorno({}, {});
    expect((await manejarWebhook("ratehawk", {}, { rpc: sin.rpc, adaptadores: sin.adaptadores })).status).toBe(503);
  });

  it("aviso de midoffice 'updated': no se confía en el aviso, se consulta la orden y se aplica lo que dice la API", async () => {
    const e = entorno({ "/hotel/order/info/": () => r(orderInfo) });
    e.respuestas.provider_webhook_token_once = true;
    await manejarWebhook("ratehawk", await cuerpo("k", { type: "updated", partner_order_id: "tut" }), { rpc: e.rpc, adaptadores: e.adaptadores });
    expect(e.urls).toEqual(["https://api-sandbox.ratehawk.com/api/b2b/v3/hotel/order/info/"]);
    expect(e.rpcs.find((x) => x.fn === "managed_booking_apply_status")?.args).toMatchObject({ _provider_status: "cancelled", _data: { aviso: "consultar:updated" } });
  });
});

describe("traslados: solo interfaz (NO VERIFICADO)", () => {
  it("cada método responde NO_VERIFICADO sin llamar a nadie y el registro no lo usa para reservas reales", async () => {
    const t = crearTraslados();
    expect(t.verificado).toBe(false);
    for (const p of [t.buscar({}), t.cotizar("x"), t.consultar("x"), t.cancelar("x", { reservasRealesPermitidas: true }), t.cambiar("x", {}, { reservasRealesPermitidas: true }),
      t.reservar({ id_oferta: "x", partner_order_id: "x", huespedes: [], contacto: { email: "", telefono: "" } }, { reservasRealesPermitidas: true })]) {
      expect(await p).toMatchObject({ ok: false, code: "NO_VERIFICADO" });
    }
    expect(await t.webhook!({})).toMatchObject({ autentico: false });
    const a = entorno().adaptadores as Adaptadores;
    expect(adaptadorDe(a, "traslados", "produccion")).toBeNull();
  });
});

describe("cargo por servicio (apagado por omisión)", () => {
  const regla: ReglaCargo = { producto: "vuelo", modo: "fijo_mas_porcentaje", monto_fijo: 150, porcentaje: 2, minimo: null, maximo: 400, moneda: "MXN",
    por: "reserva", reembolsable: false, etiqueta: "Cargo por servicio IATOS", activo: true };

  it("apagado, sin regla activa o sin monto: no hay cargo", () => {
    expect(calcularCargo(regla, 5000, { prendido: false })).toEqual({ aplica: false, motivo: "apagado" });
    expect(calcularCargo({ ...regla, activo: false }, 5000, { prendido: true })).toEqual({ aplica: false, motivo: "sin_regla" });
    expect(calcularCargo({ ...regla, monto_fijo: null }, 5000, { prendido: true })).toEqual({ aplica: false, motivo: "sin_monto" });
  });

  it("mismo cálculo que la base (150 + 2 % de 5,000 = 250; tope 400) y texto transparente: monto, aparte del proveedor y si se devuelve", () => {
    const c = calcularCargo(regla, 5000, { prendido: true });
    expect(c).toMatchObject({ aplica: true, monto: 250, moneda: "MXN", reembolsable: false });
    expect(c.aplica && c.texto).toMatch(/Cargo por servicio IATOS: \$250\.00.*aparte del precio del proveedor.*no es reembolsable/);
    expect(calcularCargo(regla, 50000, { prendido: true })).toMatchObject({ monto: 400 });
    expect(calcularCargo({ ...regla, modo: "fijo", por: "pasajero", maximo: null, reembolsable: true }, null, { prendido: true, pasajeros: 3 }))
      .toMatchObject({ monto: 450, texto: expect.stringMatching(/se devuelve si cancelas/) });
  });
});
