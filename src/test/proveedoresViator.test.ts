// Tours con Viator Partner API 2.0 (Full + Booking): nivel de la llave, estado, cancelación y cambios contra los
// ejemplos de la especificación oficial (src/test/fixtures/proveedores/viator). Sin red; nunca reserva de verdad.
import { describe, expect, it, vi } from "vitest";
import { crearViatorReservas, estadoDeEventoViator, estadoViator, VIATOR_MOTIVO_DEFAULT } from "../../supabase/functions/_shared/proveedores/viatorReservas";
import { VIATOR_PROD_BASE, VIATOR_SANDBOX_BASE } from "../../supabase/functions/_shared/viator";
import status from "./fixtures/proveedores/viator/status.json";
import statusPending from "./fixtures/proveedores/viator/status_pending.json";
import cancelReasons from "./fixtures/proveedores/viator/cancel_reasons.json";
import cancelQuote from "./fixtures/proveedores/viator/cancel_quote.json";
import cancel from "./fixtures/proveedores/viator/cancel.json";
import modifiedSince from "./fixtures/proveedores/viator/modified_since.json";
import amendCheck from "./fixtures/proveedores/viator/amendment_check.json";
import amendCheckNo from "./fixtures/proveedores/viator/amendment_check_no.json";
import amendQuote from "./fixtures/proveedores/viator/amendment_quote.json";
import amendAmend from "./fixtures/proveedores/viator/amendment_amend.json";
import cartHold from "./fixtures/proveedores/viator/cart_hold.json";
import cartBook from "./fixtures/proveedores/viator/cart_book.json";

const AHORA = new Date("2021-01-10T00:00:00Z");
const r = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json;version=2.0" } });

function viator(rutas: Record<string, (body: unknown) => Response>, base = VIATOR_SANDBOX_BASE) {
  const llamadas: { metodo: string; ruta: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const ruta = String(url).replace(base, "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    llamadas.push({ metodo: String(init?.method), ruta, body, headers: init?.headers as Record<string, string> });
    const k = Object.keys(rutas).find((x) => `${init?.method} ${ruta}`.startsWith(x));
    return k ? rutas[k](body) : r({ code: "NOT_FOUND" }, 404);
  }) as unknown as typeof fetch;
  return { ad: crearViatorReservas({ fetchImpl, apiKey: "llave-viator", baseUrl: base, ahora: () => AHORA }), llamadas, fetchImpl };
}
const SIN_BANDERA = { reservasRealesPermitidas: false };
const PERMITIDO = { reservasRealesPermitidas: true };

describe("Viator · nivel de la llave sin reservar ni gastar", () => {
  it("Full + Booking: /bookings/cancel-reasons responde 200 (una sola lectura, GET)", async () => {
    const { ad, llamadas } = viator({ "GET /bookings/cancel-reasons": () => r(cancelReasons.value) });
    expect((await ad.nivel()).nivel).toBe("full_booking");
    expect(llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toEqual(["GET /bookings/cancel-reasons"]);
  });
  it("Full: cancel-reasons 403 y products/modified-since 200", async () => {
    const { ad, llamadas } = viator({ "GET /bookings/cancel-reasons": () => r({}, 403), "GET /products/modified-since": () => r({ products: [] }) });
    expect((await ad.nivel()).nivel).toBe("full");
    expect(llamadas.every((l) => l.metodo === "GET")).toBe(true);
  });
  it("Basic (la que tiene IATOS hoy según el inventario): ambas 403", async () => {
    const { ad } = viator({ "GET /bookings/cancel-reasons": () => r({}, 403), "GET /products/modified-since": () => r({}, 403) });
    expect((await ad.nivel()).nivel).toBe("basic");
  });
  it("401 = llave inválida o aún no activa; sin llave no llama", async () => {
    const { ad } = viator({ "GET /bookings/cancel-reasons": () => r({}, 401) });
    expect((await ad.nivel()).nivel).toBe("llave_invalida");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect((await crearViatorReservas({ fetchImpl }).nivel()).nivel).toBe("sin_llave");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("encabezados de la documentación: exp-api-key y Accept application/json;version=2.0", async () => {
    const { ad, llamadas } = viator({ "GET /bookings/cancel-reasons": () => r(cancelReasons.value) });
    await ad.nivel();
    expect(llamadas[0].headers).toMatchObject({ "exp-api-key": "llave-viator", Accept: "application/json;version=2.0" });
  });
});

describe("Viator · consultar, cancelar, cambiar, avisos", () => {
  it("estados documentados", () => {
    expect(["CONFIRMED", "PENDING", "REJECTED", "CANCELED", "IN_PROGRESS", "AMENDED"].map(estadoViator))
      .toEqual(["confirmada", "pendiente", "rechazada", "cancelada", "pendiente", "confirmada"]);
    expect(["CONFIRMATION", "REJECTION", "CANCELLATION", "CUSTOMER_CANCELLATION", "AMENDMENT", "X"].map(estadoDeEventoViator))
      .toEqual(["CONFIRMED", "REJECTED", "CANCELED", "CANCELED", "AMENDED", null]);
  });

  it("consultar (POST /bookings/status): estado, neto, venta, moneda y política de reembolso con fecha gratis", async () => {
    const { ad, llamadas } = viator({ "POST /bookings/status": () => r(status.value) });
    const res = await ad.consultar("BR-791143912");
    expect(llamadas[0].body).toEqual({ bookingRef: "BR-791143912" });
    expect(res.ok && res.reserva).toMatchObject({ estado: "confirmada", localizador: "BR-791143912", neto: 20.52, venta: 21.4, moneda: "USD", entorno: "sandbox" });
    expect(res.ok && res.reserva.politicas).toMatchObject({ cancelable: true, gratis_hasta: "2021-03-30T23:00:00.000Z", penalizacion_actual: 0 });
    expect(await ad.consultar("123")).toMatchObject({ ok: false, code: "ENTRADA_INVALIDA" });
  });

  it("pendiente con comisión del proveedor", async () => {
    const { ad } = viator({ "POST /bookings/status": () => r(statusPending.value) });
    const res = await ad.consultar("BR-784007177");
    expect(res.ok && res.reserva).toMatchObject({ estado: "pendiente", comision: 5.1, venta: 510 });
  });

  it("nivel insuficiente (403) se dice tal cual", async () => {
    const { ad } = viator({ "POST /bookings/status": () => r({}, 403) });
    expect(await ad.consultar("BR-1234")).toMatchObject({ ok: false, code: "NIVEL_INSUFICIENTE" });
  });

  it("cancelar: cancel-quote (CANCELLABLE) → cancel con motivo válido → ACCEPTED, con el reembolso de la cotización", async () => {
    const { ad, llamadas } = viator({
      "GET /bookings/BR-581567752/cancel-quote": () => r(cancelQuote.value),
      "POST /bookings/BR-581567752/cancel": () => r(cancel.value),
    });
    const res = await ad.cancelar("BR-581567752", SIN_BANDERA);
    expect(res).toMatchObject({ ok: true, estado: "cancelada", reembolso: 60.2, moneda: "AUD" });
    expect(llamadas[1].body).toEqual({ reasonCode: VIATOR_MOTIVO_DEFAULT });
  });

  it("cancelar: NOT_CANCELLABLE no llama a cancel; DECLINED es error; producción sin bandera ni siquiera cotiza", async () => {
    const a = viator({ "GET /bookings/BR-1001/cancel-quote": () => r({ bookingId: "BR-1001", status: "NOT_CANCELLABLE" }) });
    expect(await a.ad.cancelar("BR-1001", SIN_BANDERA)).toMatchObject({ ok: false, code: "NO_CANCELABLE" });
    expect(a.llamadas).toHaveLength(1);
    const b = viator({ "GET /bookings/BR-2002/cancel-quote": () => r(cancelQuote.value), "POST /bookings/BR-2002/cancel": () => r({ bookingId: "BR-2002", status: "DECLINED" }) });
    expect(await b.ad.cancelar("BR-2002", SIN_BANDERA)).toMatchObject({ ok: false, code: "PROVEEDOR_ERROR" });
    const c = viator({}, VIATOR_PROD_BASE);
    expect(await c.ad.cancelar("BR-3003", SIN_BANDERA)).toMatchObject({ ok: false, code: "BLOQUEADO_PRODUCCION" });
    expect(c.llamadas).toHaveLength(0);
  });

  it("cambiar: amendment/check → quote → amend; si cuesta más que el tope aprobado, se detiene antes de modificar", async () => {
    const rutas = {
      "GET /amendment/check/BR-123456789": () => r(amendCheck.value),
      "POST /amendment/quote": () => r(amendQuote.value),
      "POST /amendment/amend/": () => r(amendAmend.value),
    };
    const caro = viator(rutas);
    const sinTope = await caro.ad.cambiar("BR-123456789", { updatePaxMix: { addPaxMix: [] } }, SIN_BANDERA);
    expect(sinTope).toMatchObject({ ok: false, code: "NO_SOPORTADO" });
    expect(caro.llamadas.some((l) => l.ruta.startsWith("/amendment/amend/"))).toBe(false);
    const ok = viator(rutas);
    const res = await ok.ad.cambiar("BR-123456789", { updatePaxMix: { addPaxMix: [] }, tope_diferencia: 100 }, SIN_BANDERA);
    expect(res).toMatchObject({ ok: true, estado: "confirmada", detalle: { diferencia: 100, cotizacion: "QR-4891fddc-7e2e-4203-9517-ec75703daa8a" } });
    expect(ok.llamadas.find((l) => l.ruta === "/amendment/quote")?.body).toEqual({ bookingRef: "BR-123456789", updatePaxMix: { addPaxMix: [] } });
  });

  it("cambiar: reserva no modificable (UNSUPPORTED_PRODUCT) → NO_SOPORTADO con el motivo de Viator", async () => {
    const { ad } = viator({ "GET /amendment/check/BR-1001": () => r(amendCheckNo.value) });
    const res = await ad.cambiar("BR-1001", {}, SIN_BANDERA);
    expect(res).toMatchObject({ ok: false, code: "NO_SOPORTADO" });
    expect(res.ok === false && res.motivo).toMatch(/UNSUPPORTED_PRODUCT/);
  });

  it("avisos (/bookings/modified-since): cancelaciones del proveedor como estado y cursor siguiente", async () => {
    const { ad } = viator({ "GET /bookings/modified-since": () => r(modifiedSince.value) });
    const a = await ad.avisos(null);
    expect(a.eventos).toEqual([
      { bookingRef: "BR-204104077", evento: "CANCELLATION", estado: "CANCELED" },
      { bookingRef: "BR-204104078", evento: "CANCELLATION", estado: "CANCELED" },
    ]);
    expect(a.siguiente).toBe("MTYxMjc2OTM4NXwxNTU5MTlQMXxJTkFDVElWRQ==");
  });
});

describe("Viator · reservar (carrito con el formulario de pago de Viator)", () => {
  const s = { id_oferta: "172432P20|TG2|2023-08-20|09:00|ADULTx2", partner_order_id: "irk5vCJ7", huespedes: [{ nombre: "Jane", apellido: "Doe" }],
    contacto: { email: "jane.doe@example.com", telefono: "+61 444444444" } };

  it("sin el paymentToken del formulario de Viator no se reserva (no hay llamadas)", async () => {
    const { ad, llamadas } = viator({});
    expect(await ad.reservar(s, SIN_BANDERA)).toMatchObject({ ok: false, code: "NO_SOPORTADO" });
    expect(llamadas).toHaveLength(0);
  });

  it("sandbox con token: cart/hold (VIATOR_FORM) → cart/book → CONFIRMED con neto, venta y comisión", async () => {
    const { ad, llamadas } = viator({ "POST /bookings/cart/hold": () => r(cartHold.value), "POST /bookings/cart/book": () => r(cartBook.value) });
    const res = await ad.reservar({ ...s, token_pago: "tok-del-iframe" }, SIN_BANDERA);
    expect(llamadas[0].body).toMatchObject({ paymentDataSubmissionMode: "VIATOR_FORM", items: [{ productCode: "172432P20", productOptionCode: "TG2", travelDate: "2023-08-20" }] });
    expect(llamadas[1].body).toMatchObject({ cartRef: "CR-cb9c9d63017a63c96454e4a5b0b153eb", paymentToken: "tok-del-iframe", items: [{ bookingRef: "BR-593038025" }] });
    expect(res.ok && res.reserva).toMatchObject({ estado: "confirmada", localizador: "BR-593038025", neto: 12.52, venta: 13.6, comision: 1.08, moneda: "AUD" });
  });

  it("producción sin la bandera: bloqueado aunque haya token", async () => {
    const { ad, llamadas } = viator({}, VIATOR_PROD_BASE);
    expect(await ad.reservar({ ...s, token_pago: "x" }, SIN_BANDERA)).toMatchObject({ ok: false, code: "BLOQUEADO_PRODUCCION" });
    expect(llamadas).toHaveLength(0);
    expect(ad.entorno).toBe("produccion");
    const permitido = viator({ "POST /bookings/cart/hold": () => r(cartHold.value), "POST /bookings/cart/book": () => r(cartBook.value) }, VIATOR_PROD_BASE);
    expect((await permitido.ad.reservar({ ...s, token_pago: "x" }, PERMITIDO)).ok).toBe(true);
  });

  it("buscar no se duplica: vive en viator-search", async () => {
    const { ad } = viator({});
    expect(await ad.buscar({})).toMatchObject({ ok: false, code: "NO_SOPORTADO" });
  });
});
