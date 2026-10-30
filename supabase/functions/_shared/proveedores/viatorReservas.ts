// Tours con Viator Partner API 2.0: nivel de acceso, reservas (carrito), estado, cancelación y cambios. Puro.
// La búsqueda de tours para la app ya existe en _shared/viator.ts (Acceso básico): aquí no se duplica, se reutiliza
// su configuración (viatorConfig: VIATOR_API_KEY o VIATOR_API_KEY_SANDBOX).
//
// Fuente: especificación OpenAPI oficial embebida en https://docs.viator.com/partner-api/technical/ (consultada el
// 30-oct-2026; servidores https://api.viator.com/partner y https://api.sandbox.viator.com/partner):
//   · Niveles: Basic (subconjunto sin transacciones), Full (todo lo no transaccional) y Full + Booking (además
//     /bookings/cart/hold, /bookings/cart/book, /bookings/status, /bookings/cancel-reasons, cancel-quote, cancel y
//     /amendment/*). /bookings/hold y /bookings/book son SOLO de merchants (IATOS no lo es).
//   · Tabla de acceso: /products/modified-since ❌ Basic ✅ Full; /bookings/cancel-reasons solo Full + Booking.
//     Con eso se averigua el nivel de la llave SIN reservar ni gastar (dos GET de lectura).
//   · /bookings/status: CONFIRMED | PENDING | REJECTED | CANCELED | IN_PROGRESS | ON_HOLD… (+ cancellationPolicy
//     refundEligibility[{percentageRefundable, startTimestamp, endTimestamp}] y totalPrice.price).
//   · Cancelar: GET /bookings/{ref}/cancel-quote (CANCELLABLE | CANCELLED | NOT_CANCELLABLE + refundDetails) →
//     POST /bookings/{ref}/cancel {reasonCode} (ACCEPTED | DECLINED). reasonCode sale de /bookings/cancel-reasons.
//   · Cambiar: GET /amendment/check/{ref} (isAmendable, amendmentTypes; solo reservas posteriores a jul-2025) →
//     POST /amendment/quote → POST /amendment/amend/{quoteRef} (AMENDED | REJECTED).
//   · Avisos: no hay webhooks; se consulta /bookings/modified-since (cada hora; cada 5 min si hay cancelaciones
//     del proveedor) con eventType CONFIRMATION | REJECTION | AMENDMENT | CANCELLATION | CUSTOMER_CANCELLATION.
//   · Pago (afiliado Full + Booking): el carrito con paymentDataSubmissionMode VIATOR_FORM devuelve un
//     paymentSessionToken; la tarjeta la captura el formulario de Viator en la app y da el paymentToken que pide
//     /bookings/cart/book. Viator es el comerciante (cobra y reembolsa). Sin ese token aquí no se reserva.
import { puedeEscribir } from "./seguridad.ts";
import { type AdaptadorProveedor, type Entorno, type EstadoGestionado, falla, type FallaProveedor, isoUtc, num, type Politicas, type ReservaProveedor } from "./tipos.ts";

export const VIATOR_RESERVAS_DOCS = ["https://docs.viator.com/partner-api/technical/", "https://partnerresources.viator.com/travel-commerce/levels-of-access/"];
const BASES: Record<Entorno, string> = { produccion: "https://api.viator.com/partner", sandbox: "https://api.sandbox.viator.com/partner" };
/** Motivo por omisión (está en el ejemplo oficial de cancel-reasons): el viajero canceló su viaje. */
export const VIATOR_MOTIVO_DEFAULT = "Customer_Service.I_canceled_my_entire_trip";

export type NivelViator = "full_booking" | "full" | "basic" | "llave_invalida" | "sin_llave" | "desconocido";

export type ViatorReservasDeps = {
  fetchImpl: typeof fetch;
  apiKey?: string;
  /** Base que devolvió viatorConfig (producción o sandbox). */
  baseUrl?: string;
  ahora?: () => Date;
  timeoutMs?: number;
};

const ESTADOS: Record<string, EstadoGestionado> = {
  CONFIRMED: "confirmada", AMENDED: "confirmada", PENDING: "pendiente", IN_PROGRESS: "pendiente", ON_HOLD: "pendiente",
  REJECTED: "rechazada", CANCELED: "cancelada", CANCELLED: "cancelada", FAILED: "fallida",
};
export const estadoViator = (s: unknown): EstadoGestionado => ESTADOS[String(s ?? "").toUpperCase()] ?? "pendiente";

/** Evento de /bookings/modified-since → estado. */
export function estadoDeEventoViator(ev: unknown): string | null {
  switch (String(ev ?? "").toUpperCase()) {
    case "CONFIRMATION": return "CONFIRMED";
    case "REJECTION": return "REJECTED";
    case "CANCELLATION": case "CUSTOMER_CANCELLATION": return "CANCELED";
    case "AMENDMENT": return "AMENDED";
    default: return null;
  }
}

type Elegibilidad = { percentageRefundable?: number; startTimestamp?: string; endTimestamp?: string };
export function politicasViator(cp: { description?: string; refundEligibility?: Elegibilidad[] } | null | undefined, total: number | null, moneda: string | null, ahora: Date): Politicas {
  const tramos = (Array.isArray(cp?.refundEligibility) ? cp!.refundEligibility! : []).map((e) => {
    const pct = num(e.percentageRefundable);
    return { desde: isoUtc(e.startTimestamp), hasta: isoUtc(e.endTimestamp), monto: pct !== null && total !== null ? Math.round(total * (100 - pct)) / 100 : null, moneda,
      pct };
  });
  const t = ahora.getTime();
  const gratis = tramos.filter((x) => x.pct === 100 && x.hasta).map((x) => x.hasta as string).sort().pop() ?? null;
  const vigente = tramos.find((x) => (!x.desde || Date.parse(x.desde) <= t) && (!x.hasta || t <= Date.parse(x.hasta)));
  return {
    cancelable: tramos.length > 0,
    gratis_hasta: gratis,
    penalizacion_actual: gratis && t < Date.parse(gratis) ? 0 : vigente?.monto ?? null,
    tramos: tramos.map(({ pct: _p, ...x }) => x),
    // Solo reservas posteriores a jul-2025 y productos que lo permitan: se confirma con /amendment/check antes de cambiar.
    cambiable: true,
    como_cambiar: "api",
    moneda,
    fuente: `Viator cancellationPolicy${cp?.description ? `: ${String(cp.description).slice(0, 200)}` : ""}`,
  };
}

// deno-lint-ignore no-explicit-any
export function reservaViator(j: any, entorno: Entorno, ahora: Date): ReservaProveedor {
  const p = j?.totalPrice?.price ?? j?.itemTotalPrice?.price ?? j?.totalConfirmedPrice?.price ?? {};
  const moneda = typeof j?.currency === "string" ? j.currency : null;
  const venta = num(p?.recommendedRetailPrice);
  return {
    proveedor: "viator", entorno, producto: "tour",
    id_proveedor: String(j?.bookingRef ?? ""), localizador: j?.bookingRef ? String(j.bookingRef) : null,
    partner_order_id: j?.partnerBookingRef ? String(j.partnerBookingRef) : null,
    estado: estadoViator(j?.status), estado_proveedor: String(j?.status ?? ""),
    politicas: politicasViator(j?.cancellationPolicy, venta, moneda, ahora),
    neto: num(p?.partnerNetPrice), venta, comision: num(p?.commission), moneda,
    inicio: isoUtc(j?.travelDate ?? j?.bookedItem?.travelDate), fin: null, titulo: null,
    fuente: "Viator /bookings/status",
  };
}

export function crearViatorReservas(d: ViatorReservasDeps): AdaptadorProveedor & { nivel(): Promise<{ nivel: NivelViator; detalle: string }>; avisos(cursor?: string | null): Promise<{ ok: boolean; eventos: Array<{ bookingRef: string; estado: string | null; evento: string }>; siguiente: string | null; code?: string }> } {
  const entorno: Entorno = d.baseUrl === BASES.sandbox ? "sandbox" : "produccion";
  const base = d.baseUrl ?? BASES.produccion;
  const configurado = !!d.apiKey;
  const ahora = () => d.ahora?.() ?? new Date();
  const sinConfig = falla("SIN_CONFIGURAR", "Falta VIATOR_API_KEY (o VIATOR_API_KEY_SANDBOX).");

  // deno-lint-ignore no-explicit-any
  async function llamar(metodo: "GET" | "POST", ruta: string, body?: unknown): Promise<{ ok: true; data: any; http: number } | FallaProveedor> {
    let res: Response;
    try {
      res = await d.fetchImpl(`${base}${ruta}`, {
        method: metodo,
        headers: { "exp-api-key": d.apiKey ?? "", Accept: "application/json;version=2.0", "Accept-Language": "es-MX", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(d.timeoutMs ?? 120_000), // la documentación recomienda 120 s para reservar
      });
    } catch (e) {
      return falla((e as Error)?.name === "TimeoutError" ? "TIEMPO_AGOTADO" : "PROVEEDOR_ERROR", "No se pudo hablar con Viator.");
    }
    // deno-lint-ignore no-explicit-any
    const j: any = await res.json().catch(() => null);
    if (res.status === 401) return falla("SIN_CONFIGURAR", "Viator rechazó la llave (401).", { http: 401 });
    if (res.status === 403) return falla("NIVEL_INSUFICIENTE", "La llave de Viator no tiene acceso a esto (403): hace falta el nivel Full + Booking.", { http: 403 });
    if (res.status === 404) return falla("NO_ENCONTRADA", "Viator no encontró esa reserva.", { http: 404 });
    if (!res.ok || !j) return falla("PROVEEDOR_ERROR", `Viator respondió HTTP ${res.status}.`, { http: res.status, detalle: typeof j?.message === "string" ? j.message.slice(0, 200) : null });
    return { ok: true, data: j, http: res.status };
  }

  return {
    id: "viator", producto: "tour", verificado: true, documentacion: VIATOR_RESERVAS_DOCS, entorno, configurado,

    /** Nivel de la llave con dos lecturas sin costo (nunca reserva ni gasta). */
    async nivel() {
      if (!configurado) return { nivel: "sin_llave", detalle: "Sin VIATOR_API_KEY." };
      const a = await llamar("GET", "/bookings/cancel-reasons");
      if (a.ok) return { nivel: "full_booking", detalle: "/bookings/cancel-reasons respondió 200 (solo Full + Booking y merchants)." };
      if (a.code === "SIN_CONFIGURAR") return { nivel: "llave_invalida", detalle: "401: la llave no es válida o aún no está activa (Viator tarda hasta 24 h)." };
      const b = await llamar("GET", "/products/modified-since?count=1");
      if (b.ok) return { nivel: "full", detalle: "/bookings/cancel-reasons 403 y /products/modified-since 200: Full (sin reservas)." };
      if (b.code === "NIVEL_INSUFICIENTE") return { nivel: "basic", detalle: "/bookings/cancel-reasons 403 y /products/modified-since 403: Basic (solo búsqueda y enlaces)." };
      return { nivel: "desconocido", detalle: `${a.motivo} / ${b.motivo}` };
    },

    // La búsqueda de tours vive en _shared/viator.ts (viator-search y Iato). Aquí no se duplica.
    buscar() {
      return Promise.resolve(falla("NO_SOPORTADO", "La búsqueda de tours de Viator ya existe en viator-search (_shared/viator.ts)."));
    },

    async cotizar(idOferta) {
      if (!configurado) return sinConfig;
      // idOferta = productCode|productOptionCode|travelDate|startTime|ADULTxN
      const [productCode, optionCode, travelDate, startTime, pax] = String(idOferta).split("|");
      const adultos = Number(String(pax ?? "").replace(/^ADULTx/, "")) || 1;
      if (!productCode || !/^\d{4}-\d{2}-\d{2}$/.test(travelDate ?? "")) return falla("ENTRADA_INVALIDA", "productCode|opción|AAAA-MM-DD|HH:MM|ADULTxN");
      const r = await llamar("POST", "/availability/check", {
        productCode, travelDate, ...(optionCode ? { productOptionCode: optionCode } : {}), ...(startTime ? { startTime } : {}),
        currency: "USD", paxMix: [{ ageBand: "ADULT", numberOfTravelers: adultos }],
      });
      if (!r.ok) return r;
      const item = (Array.isArray(r.data?.bookableItems) ? r.data.bookableItems : []).find((i: { available?: boolean }) => i?.available);
      if (!item) return falla("NO_ENCONTRADA", "Sin disponibilidad para esa fecha.");
      const p = item?.totalPrice?.price ?? {};
      return { ok: true, cambio_precio: false, oferta: {
        proveedor: "viator", producto: "tour", id_oferta: idOferta, titulo: `${productCode} ${item.productOptionCode ?? ""}`.trim(),
        neto: num(p.partnerNetPrice), venta_sugerida: num(p.recommendedRetailPrice), comision: num(p.commission), moneda: r.data?.currency ?? null,
        politicas: null, fuente: "Viator /availability/check", consultado_at: ahora().toISOString() } };
    },

    async reservar(s, ctx) {
      if (!configurado) return sinConfig;
      const bloqueo = puedeEscribir(entorno, ctx);
      if (bloqueo) return bloqueo;
      if (!s.token_pago) {
        return falla("NO_SOPORTADO", "Viator cobra con su propio formulario de pago (VIATOR_FORM): hace falta ese formulario en la app y su paymentToken. Pendiente.");
      }
      const [productCode, optionCode, travelDate, startTime, pax] = String(s.id_oferta).split("|");
      const adultos = Number(String(pax ?? "").replace(/^ADULTx/, "")) || s.huespedes.length || 1;
      const hold = await llamar("POST", "/bookings/cart/hold", {
        currency: "USD", partnerCartRef: s.partner_order_id.slice(0, 50),
        items: [{ partnerBookingRef: s.partner_order_id.slice(0, 50), productCode, ...(optionCode ? { productOptionCode: optionCode } : {}),
          ...(startTime ? { startTime } : {}), travelDate, paxMix: [{ ageBand: "ADULT", numberOfTravelers: adultos }] }],
        paymentDataSubmissionMode: "VIATOR_FORM", hostingUrl: "https://traveliatos.life",
      });
      if (!hold.ok) return hold;
      const item = hold.data?.items?.[0];
      if (item?.status !== "BOOKABLE") return falla("NO_ENCONTRADA", "Viator no pudo apartar ese tour.");
      const book = await llamar("POST", "/bookings/cart/book", {
        cartRef: hold.data.cartRef, bookerInfo: { firstName: s.huespedes[0]?.nombre ?? "", lastName: s.huespedes[0]?.apellido ?? "" },
        communication: { email: s.contacto.email, phone: s.contacto.telefono }, items: [{ bookingRef: item.bookingRef }], paymentToken: s.token_pago,
      });
      if (!book.ok) return book;
      const it = book.data?.items?.[0] ?? {};
      return { ok: true, reserva: reservaViator({ ...it, currency: book.data?.currency, travelDate }, entorno, ahora()) };
    },

    async consultar(idProveedor) {
      if (!configurado) return sinConfig;
      if (!/^BR-\d{3,20}$/.test(idProveedor)) return falla("ENTRADA_INVALIDA", "bookingRef de Viator (BR-…).");
      const r = await llamar("POST", "/bookings/status", { bookingRef: idProveedor });
      if (!r.ok) return r;
      return { ok: true, reserva: reservaViator(r.data, entorno, ahora()) };
    },

    async cancelar(idProveedor, ctx, opciones) {
      if (!configurado) return sinConfig;
      const bloqueo = puedeEscribir(entorno, ctx);
      if (bloqueo) return bloqueo;
      if (!/^BR-\d{3,20}$/.test(idProveedor)) return falla("ENTRADA_INVALIDA", "bookingRef de Viator (BR-…).");
      const q = await llamar("GET", `/bookings/${encodeURIComponent(idProveedor)}/cancel-quote`);
      if (!q.ok) return q;
      if (q.data?.status === "CANCELLED") return { ok: true, estado: "cancelada", reembolso: null, moneda: null, detalle: { ya_cancelada: true } };
      if (q.data?.status !== "CANCELLABLE") return falla("NO_CANCELABLE", "Viator dice que esta reserva ya no se puede cancelar (el tour ya pasó).");
      const motivo = opciones?.motivo && /^[A-Za-z_]+\.[A-Za-z_]+$/.test(opciones.motivo) ? opciones.motivo : VIATOR_MOTIVO_DEFAULT;
      const c = await llamar("POST", `/bookings/${encodeURIComponent(idProveedor)}/cancel`, { reasonCode: motivo });
      if (!c.ok) return c;
      if (c.data?.status !== "ACCEPTED") return falla("PROVEEDOR_ERROR", "Viator no aceptó la cancelación (DECLINED).");
      const rd = q.data?.refundDetails ?? {};
      return { ok: true, estado: "cancelada", reembolso: num(rd.refundAmount), moneda: rd.currencyCode ?? null,
        detalle: { porcentaje: num(rd.refundPercentage), precio: num(rd.itemPrice), motivo } };
    },

    async cambiar(idProveedor, cambio, ctx) {
      if (!configurado) return sinConfig;
      const bloqueo = puedeEscribir(entorno, ctx);
      if (bloqueo) return bloqueo;
      if (!/^BR-\d{3,20}$/.test(idProveedor)) return falla("ENTRADA_INVALIDA", "bookingRef de Viator (BR-…).");
      const chk = await llamar("GET", `/amendment/check/${encodeURIComponent(idProveedor)}`);
      if (!chk.ok) return chk;
      if (!chk.data?.isAmendable) return falla("NO_SOPORTADO", `Viator no permite cambiar esta reserva (${String(chk.data?.reason ?? "sin motivo")}).`);
      const { tope_diferencia, ...pedido } = cambio as Record<string, unknown> & { tope_diferencia?: number };
      const quote = await llamar("POST", "/amendment/quote", { bookingRef: idProveedor, ...pedido });
      if (!quote.ok) return quote;
      const dif = num(quote.data?.quotePriceDifference?.recommendedRetailPrice) ?? 0;
      const tope = typeof tope_diferencia === "number" ? tope_diferencia : 0;
      if (dif > tope) {
        return falla("NO_SOPORTADO", `El cambio cuesta ${dif} más: una persona debe aprobar ese monto antes.`, { detalle: String(quote.data?.quoteRef ?? "") });
      }
      const am = await llamar("POST", `/amendment/amend/${encodeURIComponent(String(quote.data?.quoteRef ?? ""))}`);
      if (!am.ok) return am;
      if (am.data?.status !== "AMENDED") return falla("PROVEEDOR_ERROR", `Viator rechazó el cambio (${String(am.data?.rejectionReasonCode ?? "REJECTED")}).`);
      return { ok: true, estado: "confirmada", detalle: { diferencia: dif, cotizacion: quote.data?.quoteRef ?? null } };
    },

    /** Avisos de cambios de estado (no hay webhooks en Viator): /bookings/modified-since. */
    async avisos(cursor) {
      if (!configurado) return { ok: false, eventos: [], siguiente: null, code: "SIN_CONFIGURAR" };
      const r = await llamar("GET", `/bookings/modified-since${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!r.ok) return { ok: false, eventos: [], siguiente: cursor ?? null, code: r.code };
      const eventos = (Array.isArray(r.data?.bookings) ? r.data.bookings : []).map((b: { bookingRef?: string; eventType?: string }) => ({
        bookingRef: String(b?.bookingRef ?? ""), evento: String(b?.eventType ?? ""), estado: estadoDeEventoViator(b?.eventType),
      })).filter((e: { bookingRef: string }) => e.bookingRef);
      return { ok: true, eventos, siguiente: typeof r.data?.nextCursor === "string" ? r.data.nextCursor : null };
    },
  };
}
