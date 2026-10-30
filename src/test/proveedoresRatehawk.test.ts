// Hoteles con RateHawk (ETG API v3): cada llamada contra la respuesta de ejemplo de la documentación oficial
// (src/test/fixtures/proveedores/ratehawk). Sin red. Nunca se reserva ni cancela en producción sin la bandera.
import { describe, expect, it, vi } from "vitest";
import {
  crearRatehawk, estadoRatehawk, firmaWebhookRatehawk, politicasRatehawk, RATEHAWK_HOSTS, ratehawkConfig,
} from "../../supabase/functions/_shared/proveedores/ratehawk";
import serp from "./fixtures/proveedores/ratehawk/serp_hotels.json";
import prebook from "./fixtures/proveedores/ratehawk/prebook.json";
import form from "./fixtures/proveedores/ratehawk/booking_form.json";
import finish from "./fixtures/proveedores/ratehawk/booking_finish.json";
import finishStatus from "./fixtures/proveedores/ratehawk/booking_finish_status.json";
import orderInfo from "./fixtures/proveedores/ratehawk/order_info.json";
import orderCancel from "./fixtures/proveedores/ratehawk/order_cancel.json";

const AHORA = new Date("2025-12-01T00:00:00Z");
const r = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function proveedor(rutas: Record<string, (body: Record<string, unknown>) => Response>, extra: Partial<Parameters<typeof crearRatehawk>[0]> = {}) {
  const llamadas: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    llamadas.push({ url: String(url), body, auth: String((init?.headers as Record<string, string>)?.Authorization ?? "") });
    const ruta = Object.keys(rutas).find((k) => String(url).endsWith(k));
    return ruta ? rutas[ruta](body) : r({ status: "error", error: "unknown", data: null }, 400);
  }) as unknown as typeof fetch;
  const ad = crearRatehawk({ fetchImpl, keyId: "1234", apiKey: "llave-sandbox", entorno: "sandbox", ahora: () => AHORA, esperar: async () => {}, ...extra });
  return { ad, llamadas };
}
const PERMITIDO = { reservasRealesPermitidas: true };
const SIN_BANDERA = { reservasRealesPermitidas: false };

describe("RateHawk · configuración y seguridad", () => {
  it("sin secretos queda apagado (SIN_CONFIGURAR) y no llama a nadie; el entorno por omisión es sandbox", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const ad = crearRatehawk({ fetchImpl, ...ratehawkConfig(() => undefined) });
    expect(ad.configurado).toBe(false);
    expect(ad.entorno).toBe("sandbox");
    expect(await ad.consultar("x-123")).toMatchObject({ ok: false, code: "SIN_CONFIGURAR" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ratehawkConfig((k) => ({ RATEHAWK_ENTORNO: "produccion" } as Record<string, string>)[k]).entorno).toBe("produccion");
    expect(ratehawkConfig((k) => ({ RATEHAWK_ENTORNO: "prod" } as Record<string, string>)[k]).entorno).toBe("sandbox");
  });

  it("producción sin la bandera: reservar y cancelar se bloquean ANTES de llamar al proveedor", async () => {
    const { ad, llamadas } = proveedor({}, { entorno: "produccion" });
    const s = { id_oferta: "p-1", partner_order_id: "iatos-0001", huespedes: [{ nombre: "Ana", apellido: "Pérez" }], contacto: { email: "a@x.test", telefono: "1" } };
    expect(await ad.reservar(s, SIN_BANDERA)).toMatchObject({ ok: false, code: "BLOQUEADO_PRODUCCION" });
    expect(await ad.cancelar("iatos-0001", SIN_BANDERA)).toMatchObject({ ok: false, code: "BLOQUEADO_PRODUCCION" });
    expect(llamadas).toHaveLength(0);
  });

  it("usa el host de sandbox de la documentación y HTTP Basic con KEY_ID:API_KEY", async () => {
    const { ad, llamadas } = proveedor({ "/hotel/order/info/": () => r(orderInfo) });
    await ad.consultar("tut");
    expect(llamadas[0].url).toBe(`${RATEHAWK_HOSTS.sandbox}/api/b2b/v3/hotel/order/info/`);
    expect(llamadas[0].auth).toBe(`Basic ${btoa("1234:llave-sandbox")}`);
    expect(llamadas[0].body).toMatchObject({ search: { partner_order_ids: ["tut"] } });
  });
});

describe("RateHawk · buscar, cotizar, reservar, consultar, cancelar, cambiar", () => {
  it("buscar: tarifas con neto, comisión, moneda y política con su fuente (ejemplo de search-by-hotel-ids)", async () => {
    const { ad, llamadas } = proveedor({ "/search/serp/hotels/": () => r(serp) });
    const res = await ad.buscar({ hids: [10004873, 9015534], checkin: "2027-02-22", checkout: "2027-02-24", adultos: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ofertas.length).toBeGreaterThan(0);
    const o = res.ofertas[0];
    expect(o.proveedor).toBe("ratehawk");
    expect(o.moneda).toBe("EUR");
    expect(o.neto).toBeGreaterThan(0);
    expect(o.politicas?.fuente).toBe("RateHawk search/serp/hotels");
    expect(llamadas[0].body).toMatchObject({ hids: [10004873, 9015534], guests: [{ adults: 2, children: [] }], residency: "mx" });
    expect(await ad.buscar({ hids: [], checkin: "x" })).toMatchObject({ ok: false, code: "ENTRADA_INVALIDA" });
  });

  it("cotizar: prebook sin subir el precio (price_increase_percent 0) y devuelve el book_hash p-… con su política", async () => {
    const { ad, llamadas } = proveedor({ "/hotel/prebook/": () => r(prebook) });
    const res = await ad.cotizar("h-d01a824f-dcce-5932-af8d-8bafc6badc3b");
    expect(llamadas[0].body).toEqual({ hash: "h-d01a824f-dcce-5932-af8d-8bafc6badc3b", price_increase_percent: 0 });
    expect(res.ok && res.oferta.id_oferta).toBe("p-e7029d6b-7b28-4e99-893f-3434d5065f33");
    expect(res.ok && res.oferta).toMatchObject({ neto: 75446.28, comision: 1539.72, moneda: "USD" });
    expect(res.ok && res.cambio_precio).toBe(false);
    // Tarifa sin periodo gratis: un solo tramo con cargo total.
    expect(res.ok && res.oferta.politicas).toMatchObject({ gratis_hasta: null, penalizacion_actual: 75446.28, cancelable: true, cambiable: false });
  });

  it("reservar en sandbox: form → finish (pago deposit, nunca tarjeta) → status ok → order/info", async () => {
    const { ad, llamadas } = proveedor({
      "/hotel/order/booking/form/": () => r(form),
      "/hotel/order/booking/finish/": () => r(finish),
      "/hotel/order/booking/finish/status/": () => r(finishStatus),
      "/hotel/order/info/": () => r(orderInfo),
    });
    const res = await ad.reservar({ id_oferta: "p-64bf9aa1-e848-48f5-a23c-f7732b90b3c8", partner_order_id: "asd12399235", venta: 2300,
      huespedes: [{ nombre: "Martin", apellido: "Smith" }], contacto: { email: "john.smith@example.com", telefono: "12124567899" } }, SIN_BANDERA);
    expect(res.ok).toBe(true);
    const fin = llamadas.find((l) => l.url.endsWith("/booking/finish/"))!;
    expect(fin.body).toMatchObject({ payment_type: { type: "deposit", amount: "2000.00", currency_code: "INR" }, partner: { partner_order_id: "asd12399235", amount_sell_b2b2c: "2300" } });
    expect(JSON.stringify(fin.body)).not.toMatch(/card|cvc/i);
    expect(llamadas.map((l) => l.url.replace(RATEHAWK_HOSTS.sandbox, ""))).toEqual([
      "/api/b2b/v3/hotel/order/booking/form/", "/api/b2b/v3/hotel/order/booking/finish/", "/api/b2b/v3/hotel/order/booking/finish/status/", "/api/b2b/v3/hotel/order/info/"]);
  });

  it("reservar: si la tarifa solo acepta tarjeta ('now') no se reserva; 'processing' sin fin → TIEMPO_AGOTADO sin reintentar finish", async () => {
    const soloTarjeta = { ...form, data: { ...form.data, payment_types: [{ ...form.data.payment_types[0], type: "now", is_need_credit_card_data: true }] } };
    const a = proveedor({ "/hotel/order/booking/form/": () => r(soloTarjeta) });
    const s = { id_oferta: "p-1", partner_order_id: "iatos-0002", huespedes: [{ nombre: "A", apellido: "B" }], contacto: { email: "a@x.test", telefono: "1" } };
    expect(await a.ad.reservar(s, SIN_BANDERA)).toMatchObject({ ok: false, code: "NO_SOPORTADO" });
    const b = proveedor({
      "/hotel/order/booking/form/": () => r(form), "/hotel/order/booking/finish/": () => r(finish),
      "/hotel/order/booking/finish/status/": () => r({ ...finishStatus, status: "processing" }),
    }, { intentosEstado: 3 });
    expect(await b.ad.reservar(s, SIN_BANDERA)).toMatchObject({ ok: false, code: "TIEMPO_AGOTADO" });
    expect(b.llamadas.filter((l) => l.url.endsWith("/booking/finish/"))).toHaveLength(1);
  });

  it("consultar: estado, localizador del hotel, política de la orden (gratis hasta, tramos) y montos", async () => {
    const { ad } = proveedor({ "/hotel/order/info/": () => r(orderInfo) });
    const res = await ad.consultar("tut");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reserva).toMatchObject({
      proveedor: "ratehawk", estado: "cancelada", estado_proveedor: "cancelled", localizador: "361911424", partner_order_id: "tut",
      neto: 411.2, moneda: "EUR", inicio: "2025-12-25T00:00:00.000Z",
    });
    expect(res.reserva.politicas).toMatchObject({ cancelable: false, gratis_hasta: "2025-12-25T05:00:00.000Z", penalizacion_actual: 0, como_cambiar: "cancelar_y_reservar" });
    expect(res.reserva.politicas?.tramos[1]).toMatchObject({ desde: "2025-12-25T05:00:00.000Z", monto: 411.2, moneda: "EUR" });
  });

  it("estados documentados de la orden", () => {
    expect(["completed", "cancelled", "failed", "noshow", "rejected", "otro"].map(estadoRatehawk))
      .toEqual(["confirmada", "cancelada", "fallida", "no_show", "rechazada", "pendiente"]);
  });

  it("después de la fecha gratis, la penalización vigente es la del tramo", () => {
    const p = politicasRatehawk(orderInfo.data.orders[0].cancellation_info, { moneda: "EUR", ahora: new Date("2025-12-26T00:00:00Z"), fuente: "x" });
    expect(p.penalizacion_actual).toBe(411.2);
  });

  it("cancelar en sandbox: reembolso del ejemplo; errores documentados → NO_CANCELABLE / NO_ENCONTRADA", async () => {
    const { ad, llamadas } = proveedor({ "/hotel/order/cancel/": () => r(orderCancel) });
    const res = await ad.cancelar("0b370500-5321-4046-92c5-5982f1a64fc6", SIN_BANDERA);
    expect(res).toMatchObject({ ok: true, estado: "cancelada", reembolso: 50, moneda: "EUR" });
    expect(llamadas[0].body).toEqual({ partner_order_id: "0b370500-5321-4046-92c5-5982f1a64fc6" });
    const nc = proveedor({ "/hotel/order/cancel/": () => r({ data: null, status: "error", error: "order_not_cancellable" }, 400) });
    expect(await nc.ad.cancelar("abc-123", SIN_BANDERA)).toMatchObject({ ok: false, code: "NO_CANCELABLE" });
    const nf = proveedor({ "/hotel/order/cancel/": () => r({ data: null, status: "error", error: "order_not_found" }, 404) });
    expect(await nf.ad.cancelar("abc-123", SIN_BANDERA)).toMatchObject({ ok: false, code: "NO_ENCONTRADA" });
  });

  it("producción CON la bandera sí cancela (decisión del dueño)", async () => {
    const { ad, llamadas } = proveedor({ "/hotel/order/cancel/": () => r(orderCancel) }, { entorno: "produccion" });
    expect(await ad.cancelar("iatos-0001", PERMITIDO)).toMatchObject({ ok: true });
    expect(llamadas[0].url.startsWith(RATEHAWK_HOSTS.produccion)).toBe(true);
  });

  it("cambiar: la API no modifica órdenes → NO_SOPORTADO (cancelar y reservar con una persona), sin llamadas", async () => {
    const { ad, llamadas } = proveedor({});
    expect(await ad.cambiar("x-1", {}, PERMITIDO)).toMatchObject({ ok: false, code: "NO_SOPORTADO" });
    expect(llamadas).toHaveLength(0);
  });
});

describe("RateHawk · webhook de estado (firma HMAC-SHA256 de la documentación)", () => {
  const cuerpo = async (apiKey: string, extra: Record<string, unknown> = {}) => {
    const timestamp = Math.floor(AHORA.getTime() / 1000);
    const token = "d3395025-1ee7-49a2-bd86-e4bd6b9908b2";
    return { data: { partner_order_id: "0b370500-5321-4046-92c5-5982f1a64fc6", status: "completed" },
      signature: { signature: await firmaWebhookRatehawk(apiKey, timestamp, token), timestamp, token }, ...extra };
  };

  it("firma = HMAC(api key, timestamp+token) en hex (mismo cálculo que el ejemplo de Node.js de la documentación)", async () => {
    const { createHmac } = await import("node:crypto");
    expect(await firmaWebhookRatehawk("k", 1574146939, "tok")).toBe(createHmac("sha256", "k").update("1574146939tok").digest("hex"));
  });

  it("auténtico: devuelve la orden, el estado y el token (para no aceptarlo dos veces)", async () => {
    const { ad } = proveedor({});
    expect(await ad.webhook!(await cuerpo("llave-sandbox"))).toEqual({
      autentico: true, id: "0b370500-5321-4046-92c5-5982f1a64fc6", estado_proveedor: "completed", token: "d3395025-1ee7-49a2-bd86-e4bd6b9908b2" });
  });

  it("firma con otra llave, sin firma o vencida: no auténtico", async () => {
    const { ad } = proveedor({});
    expect(await ad.webhook!(await cuerpo("otra-llave"))).toMatchObject({ autentico: false, motivo: "firma_invalida" });
    expect(await ad.webhook!({ data: { partner_order_id: "x", status: "completed" } })).toMatchObject({ autentico: false, motivo: "sin_firma" });
    const viejo = proveedor({}, { ahora: () => new Date(AHORA.getTime() + 8 * 86_400_000) });
    expect(await viejo.ad.webhook!(await cuerpo("llave-sandbox"))).toMatchObject({ autentico: false, motivo: "vencido" });
  });

  it("aviso de midoffice (updated) pide consultar la orden; cancelled se toma directo", async () => {
    const { ad } = proveedor({});
    const b = await cuerpo("llave-sandbox");
    expect((await ad.webhook!({ ...b, data: { type: "updated", partner_order_id: "abc" } })).estado_proveedor).toBe("consultar:updated");
    expect((await ad.webhook!({ ...b, data: { type: "cancelled", partner_order_id: "abc" } })).estado_proveedor).toBe("cancelled");
  });
});
