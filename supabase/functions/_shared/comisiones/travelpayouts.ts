// Libro de comisiones · sincronización con Travelpayouts (solo lectura). Puro: fetch, token y base por parámetro.
//
// Fuente oficial (consultada el 30-oct-2026, Help Center de Travelpayouts, artículo actualizado el 22-oct-2026):
// "API of affiliates balance and payment" https://support.travelpayouts.com/hc/en-us/articles/5169505760402
//   · Encabezado X-Access-Token: <TOKEN> (el TRAVELPAYOUTS_TOKEN que ya existe, Perfil → API token).
//   · GET https://api.travelpayouts.com/finance/v2/get_user_actions_affecting_balance
//       ?currency=usd&from=AAAA-MM-DD&until=AAAA-MM-DD&offset=0&limit=300 (máx. 300)
//     → {actions:[{action_id:"100:14358982146", campaign_id:100, action_state:"paid"|"processing"|"cancelled",
//        price:"60.83", profit:"1.52", description, booked_at:"2021-05-12 06:26:54", updated_at}], count, …}
//     from/until filtran por fecha de creación de la acción.
//   · GET …/finance/v2/get_user_payments → [{paid_at, payment_uuid, amount, currency, …}]
//   · GET …/finance/v2/get_user_actions_affecting_payment?payment_uuid=…&limit=300 → {actions:[{campaign_id, action_id,
//     finished_amount, booked_at}], currency, count}
// Significado de action_state (artículo "API of affiliate programs booking statistics", id 360019864079):
// paid = confirmada (ganancia confirmada), processing = en proceso, canceled/cancelled = cancelada. "Pagada" en
// nuestro libro = la acción entró en un pago de Travelpayouts a IATOS (get_user_actions_affecting_payment).
// Límites: https://support.travelpayouts.com/hc/en-us/articles/4402565416594 (429 si se excede; aquí ≤ ~15 llamadas).
//
// NO VERIFICADO EN VIVO: este entorno no tiene el token; los formatos salen de los ejemplos oficiales (pruebas en
// src/test/comisionesTravelpayouts.test.ts). Zona horaria de booked_at: la documentación no la dice; se toma UTC.

export const TP_FINANCE = "https://api.travelpayouts.com/finance/v2";
export const TP_FUENTES = [
  "https://support.travelpayouts.com/hc/en-us/articles/5169505760402-API-of-affiliates-balance-and-payment",
  "https://support.travelpayouts.com/hc/en-us/articles/360019864079-API-of-affiliate-programs-booking-statistics",
];

/** Programas cuyo id está en la documentación oficial (100 = Aviasales, 84 = Booking.com). Los demás: "Programa N". */
export const TP_PROGRAMAS: Record<number, { nombre: string; producto: string }> = {
  100: { nombre: "Aviasales", producto: "vuelo" },
  84: { nombre: "Booking.com", producto: "hotel" },
};

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export function estadoTravelpayouts(s: unknown): "pendiente" | "confirmada" | "rechazada" | null {
  switch (String(s ?? "").toLowerCase()) {
    case "processing": return "pendiente";
    case "paid": return "confirmada";
    case "cancelled": case "canceled": return "rechazada";
    default: return null;
  }
}

const fechaUtc = (v: unknown): string | null => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(/[zZ+]/.test(v.slice(10)) ? v : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Acción de Travelpayouts → fila de public.commissions_upsert. null si no trae lo mínimo. */
// deno-lint-ignore no-explicit-any
export function filaDeAccion(a: any, moneda: string): Record<string, unknown> | null {
  const estado = estadoTravelpayouts(a?.action_state);
  const id = typeof a?.action_id === "string" ? a.action_id.trim() : "";
  const profit = Number(a?.profit);
  if (!id || !estado || !Number.isFinite(profit)) return null;
  const camp = Number.isInteger(a?.campaign_id) ? a.campaign_id : Number(String(id).split(":")[0]);
  const prog = Number.isInteger(camp) ? TP_PROGRAMAS[camp] : undefined;
  return {
    external_id: id.slice(0, 200), campaign_id: Number.isInteger(camp) ? camp : null,
    proveedor: prog?.nombre ?? (Number.isInteger(camp) ? `Programa ${camp}` : "Travelpayouts"),
    producto: prog?.producto ?? String(a?.description ?? ""),
    status: estado, provider_state: String(a.action_state).slice(0, 40),
    booked_at: fechaUtc(a?.booked_at), provider_updated_at: fechaUtc(a?.updated_at),
    sale_amount: Number.isFinite(Number(a?.price)) ? Number(a.price) : null, commission_amount: profit,
    currency: moneda.toUpperCase(), description: typeof a?.description === "string" ? a.description.slice(0, 300) : null,
    raw: { action_id: id, campaign_id: camp, action_state: a.action_state, fuente: "travelpayouts finance/v2" },
  };
}

export type SyncTpDeps = {
  fetchImpl: typeof fetch;
  token?: string;
  rpc: Rpc;
  /** app_flags.comisiones_sync_enabled */
  prendido: () => Promise<boolean>;
  ahora?: () => Date;
  /** Días hacia atrás (las reservas de hotel se confirman al terminar la estancia: meses). */
  dias?: number;
  maxPaginas?: number;
};

export type SyncTpResultado = {
  ok: boolean; apagado?: boolean; code?: string; motivo?: string;
  acciones: number; nuevas: number; actualizadas: number; ignoradas: number; invalidas: number; pagos: number; pagadas: number;
};

const vacio = (): SyncTpResultado => ({ ok: true, acciones: 0, nuevas: 0, actualizadas: 0, ignoradas: 0, invalidas: 0, pagos: 0, pagadas: 0 });

export async function sincronizarTravelpayouts(d: SyncTpDeps): Promise<SyncTpResultado> {
  const out = vacio();
  if (!(await d.prendido())) return { ...out, apagado: true };
  if (!d.token) {
    const r = { ...out, ok: false, code: "SIN_TOKEN", motivo: "Falta el secreto TRAVELPAYOUTS_TOKEN." };
    await d.rpc("commission_sync_log", { _source: "travelpayouts", _ok: false, _stats: r, _error: r.motivo });
    return r;
  }
  const ahora = d.ahora?.() ?? new Date();
  const desde = new Date(ahora.getTime() - (d.dias ?? 180) * 86_400_000).toISOString().slice(0, 10);
  const hasta = ahora.toISOString().slice(0, 10);
  // deno-lint-ignore no-explicit-any
  const get = async (ruta: string): Promise<{ ok: true; j: any } | { ok: false; code: string; motivo: string }> => {
    try {
      const res = await d.fetchImpl(`${TP_FINANCE}${ruta}`, { headers: { "X-Access-Token": d.token!, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, code: "TOKEN_RECHAZADO", motivo: `Travelpayouts respondió ${res.status} (token).` };
      if (res.status === 429) return { ok: false, code: "LIMITE", motivo: "Travelpayouts: límite de peticiones (429)." };
      if (res.ok === false) return { ok: false, code: "HTTP", motivo: `Travelpayouts respondió HTTP ${res.status}.` };
      return { ok: true, j: await res.json() };
    } catch (e) {
      return { ok: false, code: "RED", motivo: String((e as Error)?.message ?? e).slice(0, 120) };
    }
  };
  const fallar = async (code: string, motivo: string) => {
    const r = { ...out, ok: false, code, motivo };
    await d.rpc("commission_sync_log", { _source: "travelpayouts", _ok: false, _stats: r, _error: motivo });
    return r;
  };

  // 1) Acciones (ventas) de los últimos meses, paginadas de 300 en 300.
  const filas: Record<string, unknown>[] = [];
  const maxPag = d.maxPaginas ?? 10;
  for (let p = 0, offset = 0; p < maxPag; p++, offset += 300) {
    const r = await get(`/get_user_actions_affecting_balance?currency=usd&from=${desde}&until=${hasta}&offset=${offset}&limit=300`);
    if (r.ok === false) return fallar(r.code, r.motivo);
    if (!Array.isArray(r.j?.actions)) return fallar("FORMATO_INESPERADO", "La respuesta no trae 'actions' (¿cambió la API?).");
    out.acciones += r.j.actions.length;
    for (const a of r.j.actions) {
      const f = filaDeAccion(a, "USD");
      if (f) filas.push(f); else out.invalidas++;
    }
    const total = Number(r.j?.count);
    if (r.j.actions.length < 300 || (Number.isFinite(total) && offset + 300 >= total)) break;
  }
  for (let i = 0; i < filas.length; i += 300) {
    const u = await d.rpc("commissions_upsert", { _source: "travelpayouts", _rows: filas.slice(i, i + 300) });
    if (u.error) return fallar("BASE", u.error.message.slice(0, 200));
    const s = (u.data ?? {}) as Record<string, number>;
    out.nuevas += s.nuevas ?? 0; out.actualizadas += s.actualizadas ?? 0; out.ignoradas += s.ignoradas ?? 0; out.invalidas += s.invalidas ?? 0;
  }

  // 2) Pagos de Travelpayouts a IATOS: sus acciones pasan a "pagada".
  const pagos = await get("/get_user_payments");
  if (pagos.ok && Array.isArray(pagos.j)) {
    const recientes = pagos.j
      .filter((x: { paid_at?: string; payment_uuid?: string }) => typeof x?.payment_uuid === "string" && (fechaUtc(x.paid_at) ?? "") >= `${desde}T`)
      .slice(0, 6);
    for (const pg of recientes) {
      const ids: string[] = [];
      for (let p = 0, offset = 0; p < 3; p++, offset += 300) {
        const r = await get(`/get_user_actions_affecting_payment?payment_uuid=${encodeURIComponent(pg.payment_uuid)}&offset=${offset}&limit=300`);
        if (r.ok === false || !Array.isArray(r.j?.actions)) break;
        for (const a of r.j.actions) if (typeof a?.action_id === "string") ids.push(a.action_id);
        if (r.j.actions.length < 300) break;
      }
      if (!ids.length) continue;
      const m = await d.rpc("commissions_mark_paid", { _source: "travelpayouts", _payout_ref: String(pg.payment_uuid).slice(0, 80), _paid_at: fechaUtc(pg.paid_at), _external_ids: ids });
      out.pagos++;
      out.pagadas += Number((m.data as { pagadas?: number } | null)?.pagadas ?? 0);
    }
  }
  await d.rpc("commission_sync_log", { _source: "travelpayouts", _ok: true, _stats: out, _error: null });
  return out;
}
