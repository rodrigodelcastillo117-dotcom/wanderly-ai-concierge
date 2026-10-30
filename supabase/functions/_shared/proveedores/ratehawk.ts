// Hoteles con RateHawk (Emerging Travel Group, ETG API v3, B2B). Puro: fetch, secretos y espera por parámetro.
//
// Fuente (consultada el 30-oct-2026, documentación oficial):
//   · OpenAPI: https://api.ratehawk.com/openapi.json ("ETG API v3", 3.0.0).
//   · Hosts y llaves: https://docs.emergingtravel.com/docs/fundamentals/authorization/ — sandbox
//     https://api-sandbox.ratehawk.com, producción https://api.ratehawk.com; HTTP Basic con <KEY_ID>:<API_KEY>.
//     (api.worldota.net quedó obsoleto.) El entorno "test" (hotel hid 8473727) implica reservas REALES: no se usa.
//   · Sandbox: "no real bookings, charges, or data changes occur"; moneda siempre EUR; sin pagos con tarjeta.
//   · Flujo: search/serp/hotels → hotel/prebook (hash h-…) o serp/prebook → hotel/order/booking/form (book_hash p-…,
//     partner_order_id, user_ip) → hotel/order/booking/finish (rooms, user, partner, payment_type) →
//     hotel/order/booking/finish/status (ok | processing | 3ds | error) → hotel/order/info (partner_order_ids) →
//     hotel/order/cancel (partner_order_id). Estados de la orden: completed, cancelled, failed, noshow, rejected.
//   · Políticas: payment_options.payment_types[].cancellation_penalties {free_cancellation_before (UTC±0), policies[
//     {start_at, end_at, amount_charge}]}; en la orden: cancellation_info {free_cancellation_before, policies[{start_at,
//     end_at, penalty{amount, currency_code}}]} e is_cancellable.
//   · Cambios: la API NO tiene endpoint para modificar una orden → cambio = cancelar (si la política lo permite) y
//     reservar de nuevo, con una persona.
//   · Webhook de estado (receive-booking-status-webhook): {data:{partner_order_id, status: completed|failed},
//     signature:{signature, timestamp, token}}; firma = HMAC-SHA256(API key, timestamp+token) en hex; el soporte de
//     ETG da de alta la URL. Responder 200; >299 → reintentos.
// Pago: IATOS usa el tipo "deposit" (saldo/contrato B2B de la agencia) o "hotel"; nunca "now" (tarjeta): este código
// no maneja datos de tarjeta.
import { entornoDe, puedeEscribir } from "./seguridad.ts";
import {
  type AdaptadorProveedor, type ContextoEscritura, type Entorno, type EstadoGestionado, falla, type FallaProveedor, isoUtc, num, type Oferta,
  type Politicas, type ReservaProveedor, type Resultado, type SolicitudReserva, type WebhookProveedor,
} from "./tipos.ts";

export const RATEHAWK_HOSTS: Record<Entorno, string> = { sandbox: "https://api-sandbox.ratehawk.com", produccion: "https://api.ratehawk.com" };
export const RATEHAWK_DOCS = [
  "https://api.ratehawk.com/openapi.json",
  "https://docs.emergingtravel.com/docs/fundamentals/authorization/",
  "https://docs.emergingtravel.com/docs/fundamentals/sandbox/",
  "https://docs.emergingtravel.com/docs/b2b-api/post-booking/cancel-booking/",
  "https://docs.emergingtravel.com/docs/b2b-api/post-booking/retrieve-bookings/",
  "https://docs.emergingtravel.com/docs/b2b-api/booking/receive-booking-status-webhook/",
];

export type RatehawkDeps = {
  fetchImpl: typeof fetch;
  keyId?: string;
  apiKey?: string;
  entorno?: Entorno;
  ahora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Intentos de finish/status (la documentación recomienda cada 5 s hasta el tiempo máximo de la reserva). */
  intentosEstado?: number;
};

export function ratehawkConfig(env: (k: string) => string | undefined): Pick<RatehawkDeps, "keyId" | "apiKey" | "entorno"> {
  return { keyId: env("RATEHAWK_KEY_ID")?.trim() || undefined, apiKey: env("RATEHAWK_API_KEY")?.trim() || undefined, entorno: entornoDe(env("RATEHAWK_ENTORNO")) };
}

const MAPA_ESTADO: Record<string, EstadoGestionado> = {
  completed: "confirmada", cancelled: "cancelada", failed: "fallida", rejected: "rechazada", noshow: "no_show",
};
export function estadoRatehawk(s: unknown): EstadoGestionado {
  return MAPA_ESTADO[String(s ?? "").toLowerCase()] ?? "pendiente";
}

type Tramo = { start_at?: string | null; end_at?: string | null; amount_charge?: string; penalty?: { amount?: string; currency_code?: string } };

/** Política normalizada a partir de cancellation_penalties (tarifa) o cancellation_info (orden). */
export function politicasRatehawk(p: { free_cancellation_before?: string | null; policies?: Tramo[] } | null | undefined, opts: {
  moneda: string | null; cancelableOrden?: boolean | null; ahora: Date; fuente: string;
}): Politicas {
  const tramos = (Array.isArray(p?.policies) ? p!.policies! : []).map((t) => ({
    desde: isoUtc(t.start_at), hasta: isoUtc(t.end_at),
    monto: num(t.penalty?.amount ?? t.amount_charge), moneda: t.penalty?.currency_code ?? opts.moneda,
  }));
  const ahora = opts.ahora.getTime();
  const vigente = tramos.find((t) => (!t.desde || Date.parse(t.desde) <= ahora) && (!t.hasta || ahora < Date.parse(t.hasta)));
  const gratisHasta = isoUtc(p?.free_cancellation_before);
  return {
    // En la orden manda is_cancellable; en la tarifa, si hay tramos se puede cancelar (con o sin cargo).
    cancelable: opts.cancelableOrden ?? tramos.length > 0,
    gratis_hasta: gratisHasta,
    penalizacion_actual: gratisHasta && ahora < Date.parse(gratisHasta) ? 0 : vigente?.monto ?? null,
    tramos,
    cambiable: false,
    como_cambiar: "cancelar_y_reservar",
    moneda: opts.moneda,
    fuente: opts.fuente,
  };
}

type TipoPago = { type?: string; amount?: string; currency_code?: string; commission_info?: { charge?: { amount_net?: string; amount_gross?: string; amount_commission?: string } };
  recommended_price?: { amount?: string } | null; cancellation_penalties?: { free_cancellation_before?: string | null; policies?: Tramo[] } };

/** Tipo de pago que IATOS acepta: saldo de la agencia (deposit) o pago en el hotel. Nunca tarjeta. */
export function tipoPagoAgencia(tipos: TipoPago[] | null | undefined): TipoPago | null {
  const l = Array.isArray(tipos) ? tipos : [];
  return l.find((t) => t.type === "deposit") ?? l.find((t) => t.type === "hotel") ?? null;
}

// deno-lint-ignore no-explicit-any
export function ofertasDeHoteles(data: any, ahora: Date, fuente: string): Oferta[] {
  const out: Oferta[] = [];
  for (const h of Array.isArray(data?.hotels) ? data.hotels : []) {
    for (const r of Array.isArray(h?.rates) ? h.rates : []) {
      const pago = tipoPagoAgencia(r?.payment_options?.payment_types);
      const hash = String(r?.book_hash ?? r?.search_hash ?? r?.match_hash ?? "");
      if (!hash || !pago) continue;
      const moneda = pago.currency_code ?? null;
      out.push({
        proveedor: "ratehawk", producto: "hotel", id_oferta: hash,
        titulo: `${String(h?.id ?? h?.hid ?? "hotel")} · ${String(r?.room_name ?? "habitación")}`.slice(0, 200),
        neto: num(pago.commission_info?.charge?.amount_net ?? pago.amount),
        venta_sugerida: num(pago.recommended_price?.amount ?? pago.commission_info?.charge?.amount_gross),
        comision: num(pago.commission_info?.charge?.amount_commission),
        moneda,
        politicas: politicasRatehawk(pago.cancellation_penalties, { moneda, ahora, fuente }),
        fuente, consultado_at: ahora.toISOString(),
        extra: { hid: h?.hid ?? null, hotel_id: h?.id ?? null, comida: r?.meal ?? null, tipo_pago: pago.type },
      });
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export function reservaDeOrden(o: any, entorno: Entorno, ahora: Date): ReservaProveedor {
  const moneda = o?.amount_sell?.currency_code ?? o?.cancellation_info?.policies?.[0]?.penalty?.currency_code ?? null;
  const neto = num(o?.amount_sell?.amount);
  const venta = num(o?.amount_sell_b2b2c?.amount);
  return {
    proveedor: "ratehawk", entorno, producto: "hotel",
    id_proveedor: String(o?.partner_data?.order_id ?? o?.order_id ?? ""),
    localizador: o?.supplier_data?.confirmation_id ? String(o.supplier_data.confirmation_id) : o?.order_id ? String(o.order_id) : null,
    partner_order_id: o?.partner_data?.order_id ? String(o.partner_data.order_id) : null,
    estado: estadoRatehawk(o?.status), estado_proveedor: String(o?.status ?? ""),
    politicas: politicasRatehawk(o?.cancellation_info, { moneda, cancelableOrden: typeof o?.is_cancellable === "boolean" ? o.is_cancellable : null, ahora,
      fuente: "RateHawk hotel/order/info (cancellation_info)" }),
    neto, venta: venta && venta > 0 ? venta : null,
    comision: venta && venta > 0 && neto !== null ? Math.round((venta - neto) * 100) / 100 : null,
    moneda, inicio: isoUtc(o?.checkin_at), fin: isoUtc(o?.checkout_at),
    titulo: o?.hotel_data?.id ? `Hotel ${o.hotel_data.id}` : null,
    fuente: "RateHawk hotel/order/info",
  };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export async function firmaWebhookRatehawk(apiKey: string, timestamp: number | string, token: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(apiKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}${token}`)));
}
function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function crearRatehawk(d: RatehawkDeps): AdaptadorProveedor {
  const entorno: Entorno = d.entorno ?? "sandbox";
  const host = RATEHAWK_HOSTS[entorno];
  const configurado = !!(d.keyId && d.apiKey);
  const ahora = () => d.ahora?.() ?? new Date();
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sinConfig = falla("SIN_CONFIGURAR", "Faltan los secretos RATEHAWK_KEY_ID y RATEHAWK_API_KEY (llave de sandbox o de producción de ETG).");

  // deno-lint-ignore no-explicit-any
  async function llamar(ruta: string, body: unknown): Promise<{ ok: true; data: any } | FallaProveedor> {
    let res: Response;
    try {
      res = await d.fetchImpl(`${host}${ruta}`, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${d.keyId}:${d.apiKey}`)}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(d.timeoutMs ?? 30_000),
      });
    } catch (e) {
      return falla((e as Error)?.name === "TimeoutError" ? "TIEMPO_AGOTADO" : "PROVEEDOR_ERROR", "No se pudo hablar con RateHawk.", { detalle: String((e as Error)?.message ?? e).slice(0, 120) });
    }
    // deno-lint-ignore no-explicit-any
    const j: any = await res.json().catch(() => null);
    const err = typeof j?.error === "string" && j.error ? j.error : null;
    if (!res.ok || !j || err || (j.status && j.status !== "ok" && j.status !== "processing" && j.status !== "3ds")) {
      const code = err === "order_not_found" ? "NO_ENCONTRADA" : err === "order_not_cancellable" ? "NO_CANCELABLE"
        : res.status === 401 || res.status === 403 ? "SIN_CONFIGURAR" : "PROVEEDOR_ERROR";
      return falla(code, `RateHawk respondió ${err ?? `HTTP ${res.status}`}.`, { http: res.status, detalle: err });
    }
    return { ok: true, data: j };
  }

  async function consultar(idProveedor: string): Promise<Resultado<{ reserva: ReservaProveedor }>> {
    if (!configurado) return sinConfig;
    if (!idProveedor || idProveedor.length > 256) return falla("ENTRADA_INVALIDA", "partner_order_id inválido.");
    const r = await llamar("/api/b2b/v3/hotel/order/info/", {
      ordering: { ordering_type: "desc", ordering_by: "created_at" }, pagination: { page_size: 1, page_number: 1 },
      search: { partner_order_ids: [idProveedor] }, language: "en",
    });
    if (!r.ok) return r;
    const orden = Array.isArray(r.data?.data?.orders) ? r.data.data.orders[0] : null;
    if (!orden) return falla("NO_ENCONTRADA", "RateHawk no tiene esa orden.");
    return { ok: true, reserva: reservaDeOrden(orden, entorno, ahora()) };
  }

  return {
    id: "ratehawk", producto: "hotel", verificado: true, documentacion: RATEHAWK_DOCS, entorno, configurado,

    async buscar(q) {
      if (!configurado) return sinConfig;
      const hids = Array.isArray(q.hids) ? q.hids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 300) : [];
      const checkin = String(q.checkin ?? ""), checkout = String(q.checkout ?? "");
      if (!hids.length || !/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
        return falla("ENTRADA_INVALIDA", "Se necesitan hids, checkin y checkout (AAAA-MM-DD).");
      }
      const adultos = Math.max(1, Math.min(6, Number(q.adultos ?? 2) || 2));
      const r = await llamar("/api/b2b/v3/search/serp/hotels/", {
        checkin, checkout, residency: String(q.residencia ?? "mx").toLowerCase().slice(0, 2), language: "en",
        guests: [{ adults: adultos, children: [] }], hids, currency: String(q.moneda ?? "USD").toUpperCase().slice(0, 3),
      });
      if (!r.ok) return r;
      return { ok: true, ofertas: ofertasDeHoteles(r.data?.data, ahora(), "RateHawk search/serp/hotels") };
    },

    async cotizar(idOferta) {
      if (!configurado) return sinConfig;
      if (!idOferta) return falla("ENTRADA_INVALIDA", "Falta el hash de la tarifa.");
      const ruta = idOferta.startsWith("h-") ? "/api/b2b/v3/hotel/prebook/" : "/api/b2b/v3/serp/prebook/";
      // Sin subir el precio en silencio: si cambió, se dice (price_changed) y no se toma otra tarifa más cara.
      const r = await llamar(ruta, { hash: idOferta, price_increase_percent: 0 });
      if (!r.ok) return r;
      const oferta = ofertasDeHoteles(r.data?.data, ahora(), `RateHawk ${ruta.includes("serp") ? "serp/prebook" : "hotel/prebook"}`)[0];
      if (!oferta) return falla("NO_ENCONTRADA", "La tarifa ya no está disponible.");
      return { ok: true, oferta, cambio_precio: r.data?.data?.changes?.price_changed === true };
    },

    async reservar(s: SolicitudReserva, ctx: ContextoEscritura) {
      if (!configurado) return sinConfig;
      const bloqueo = puedeEscribir(entorno, ctx);
      if (bloqueo) return bloqueo;
      if (!s.id_oferta?.startsWith("p-") || !/^[A-Za-z0-9-]{3,256}$/.test(s.partner_order_id) || !s.huespedes?.length || !s.contacto?.email) {
        return falla("ENTRADA_INVALIDA", "Se necesita el book_hash (p-…) de prebook, un partner_order_id, huéspedes y contacto.");
      }
      const form = await llamar("/api/b2b/v3/hotel/order/booking/form/", {
        partner_order_id: s.partner_order_id, book_hash: s.id_oferta, language: "en", user_ip: s.ip_usuario ?? "127.0.0.1",
      });
      if (!form.ok) return form;
      const pago = tipoPagoAgencia(form.data?.data?.payment_types);
      if (!pago) return falla("NO_SOPORTADO", "La tarifa solo acepta pago con tarjeta en el momento; IATOS no maneja tarjetas: la hace una persona.");
      const fin = await llamar("/api/b2b/v3/hotel/order/booking/finish/", {
        user: { email: s.contacto.email, phone: s.contacto.telefono },
        partner: { partner_order_id: s.partner_order_id, ...(s.venta ? { amount_sell_b2b2c: String(s.venta) } : {}) },
        language: "en",
        rooms: [{ guests: s.huespedes.map((h) => ({ first_name: h.nombre, last_name: h.apellido, ...(h.nino ? { is_child: true, age: h.edad ?? 0 } : {}) })) }],
        payment_type: { type: pago.type, amount: pago.amount, currency_code: pago.currency_code },
      });
      if (!fin.ok) return fin;
      // finish/status: ok | processing | 3ds | error (cada 5 s, como recomienda la documentación).
      const intentos = Math.max(1, d.intentosEstado ?? 24);
      for (let i = 0; i < intentos; i++) {
        const st = await llamar("/api/b2b/v3/hotel/order/booking/finish/status/", { partner_order_id: s.partner_order_id });
        if (!st.ok) return st;
        const estado = String(st.data?.status ?? "");
        if (estado === "ok") {
          const c = await consultar(s.partner_order_id);
          return c.ok ? { ok: true, reserva: c.reserva } : c;
        }
        if (estado === "3ds") return falla("NO_SOPORTADO", "El proveedor pidió 3D Secure (pago con tarjeta): IATOS no lo maneja.");
        if (estado !== "processing") return falla("PROVEEDOR_ERROR", `La reserva terminó con estado ${estado || "desconocido"}.`);
        if (i < intentos - 1) await esperar(5_000);
      }
      return falla("TIEMPO_AGOTADO", "RateHawk sigue procesando: se consultará después con order/info (no se reintenta para no duplicar).");
    },

    consultar,

    async cancelar(idProveedor, ctx) {
      if (!configurado) return sinConfig;
      const bloqueo = puedeEscribir(entorno, ctx);
      if (bloqueo) return bloqueo;
      if (!idProveedor || idProveedor.length < 3 || idProveedor.length > 256) return falla("ENTRADA_INVALIDA", "partner_order_id inválido.");
      const r = await llamar("/api/b2b/v3/hotel/order/cancel/", { partner_order_id: idProveedor });
      if (!r.ok) return r;
      const d0 = r.data?.data ?? {};
      return {
        ok: true, estado: "cancelada" as EstadoGestionado,
        reembolso: num(d0?.amount_refunded?.amount), moneda: d0?.amount_refunded?.currency_code ?? d0?.amount_sell?.currency_code ?? null,
        detalle: { pagado: num(d0?.amount_payable?.amount), reembolsado: num(d0?.amount_refunded?.amount), venta: num(d0?.amount_sell?.amount) },
      };
    },

    cambiar() {
      return Promise.resolve(falla("NO_SOPORTADO",
        "La API de RateHawk no modifica órdenes: el cambio es cancelar (si la política lo permite) y reservar de nuevo, con una persona."));
    },

    async webhook(body: unknown): Promise<WebhookProveedor> {
      if (!d.apiKey) return { autentico: false, motivo: "sin_llave" };
      // deno-lint-ignore no-explicit-any
      const b = body as any;
      const sig = b?.signature ?? {};
      const ts = Number(sig?.timestamp);
      if (typeof sig?.signature !== "string" || typeof sig?.token !== "string" || !Number.isFinite(ts)) return { autentico: false, motivo: "sin_firma" };
      const esperada = await firmaWebhookRatehawk(d.apiKey, sig.timestamp, sig.token);
      if (!igualSeguro(esperada, sig.signature.toLowerCase())) return { autentico: false, motivo: "firma_invalida" };
      // Reintentos de ETG hasta 12 h entre sí: se acepta una firma de hasta 7 días; la repetición la frena el token.
      if (Math.abs(ahora().getTime() / 1000 - ts) > 7 * 24 * 3600) return { autentico: false, motivo: "vencido" };
      const data = b?.data ?? {};
      const id = typeof data.partner_order_id === "string" ? data.partner_order_id : undefined;
      // Webhook de estado de la reserva (completed | failed) o de midoffice (created | updated | cancelled).
      const estado = typeof data.status === "string" ? data.status : data.type === "cancelled" ? "cancelled" : typeof data.type === "string" ? `consultar:${data.type}` : undefined;
      return { autentico: true, id, estado_proveedor: estado, token: sig.token };
    },
  };
}
