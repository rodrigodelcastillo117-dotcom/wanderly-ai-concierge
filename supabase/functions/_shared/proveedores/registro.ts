// Registro de adaptadores y la tarea de reservas gestionadas (ejecutar lo aprobado y sincronizar estados). Puro:
// la base (rpc) y el fetch llegan por parámetro; se prueba con dobles en src/test/reservasGestionadas.test.ts.
import { viatorConfig } from "../viator.ts";
import { crearRatehawk, ratehawkConfig } from "./ratehawk.ts";
import { crearTraslados } from "./traslados.ts";
import type { AdaptadorProveedor, Entorno } from "./tipos.ts";
import { crearViatorReservas } from "./viatorReservas.ts";

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type Adaptadores = {
  ratehawk: ReturnType<typeof crearRatehawk>;
  viator: ReturnType<typeof crearViatorReservas>;
  traslados: AdaptadorProveedor;
};

export function adaptadoresDesdeEnv(env: (k: string) => string | undefined, fetchImpl: typeof fetch): Adaptadores {
  const v = viatorConfig(env);
  return {
    ratehawk: crearRatehawk({ fetchImpl, ...ratehawkConfig(env) }),
    viator: crearViatorReservas({ fetchImpl, apiKey: v.apiKey, baseUrl: v.baseUrl }),
    traslados: crearTraslados(),
  };
}

/** Adaptador de una reserva guardada: mismo proveedor y mismo entorno (nunca se consulta producción con la llave de sandbox). */
export function adaptadorDe(a: Adaptadores, proveedor: string, entorno: Entorno): AdaptadorProveedor | null {
  const ad = proveedor === "ratehawk" ? a.ratehawk : proveedor === "viator" ? a.viator : proveedor === "traslados" ? a.traslados : null;
  return ad && ad.entorno === entorno ? ad : null;
}

type ReservaInterna = {
  id: string; ref_code: string; provider: string; environment: Entorno; provider_booking_id: string; partner_order_id: string | null; status: string;
};
type Solicitud = { id: string; kind: "cancelacion" | "cambio"; details: Record<string, unknown>; booking: ReservaInterna };

/** Id con el que el proveedor consulta/cancela: RateHawk usa nuestro partner_order_id; Viator su bookingRef. */
export const idParaProveedor = (b: ReservaInterna) => (b.provider === "ratehawk" ? b.partner_order_id ?? b.provider_booking_id : b.provider_booking_id);

export type TareaDeps = {
  rpc: Rpc;
  adaptadores: Adaptadores;
  /** app_flags.proveedores_reservas_enabled (escribir en producción). */
  reservasRealesPermitidas: () => Promise<boolean>;
  log?: (...a: unknown[]) => void;
};

/** Ejecuta las solicitudes que una persona aprobó (la base solo las entrega con la bandera de ejecución prendida). */
export async function ejecutarSolicitudes(d: TareaDeps): Promise<{ apagado: boolean; tomadas: number; hechas: number; fallidas: number }> {
  const r = await d.rpc("managed_requests_claim", { _limit: 5 });
  const data = (r.data ?? {}) as { apagado?: boolean; solicitudes?: Solicitud[] };
  if (r.error || data.apagado) return { apagado: true, tomadas: 0, hechas: 0, fallidas: 0 };
  const lista = Array.isArray(data.solicitudes) ? data.solicitudes : [];
  const ctx = { reservasRealesPermitidas: await d.reservasRealesPermitidas() };
  let hechas = 0, fallidas = 0;
  for (const s of lista) {
    const ad = adaptadorDe(d.adaptadores, s.booking.provider, s.booking.environment);
    const id = idParaProveedor(s.booking);
    const res = !ad
      ? { ok: false as const, code: "SIN_CONFIGURAR", motivo: `No hay adaptador de ${s.booking.provider} para ${s.booking.environment}.` }
      : s.kind === "cancelacion"
      ? await ad.cancelar(id, ctx, { motivo: typeof s.details?.motivo === "string" ? s.details.motivo : undefined })
      : await ad.cambiar(id, s.details ?? {}, ctx);
    // Se registra el resultado ANTES de tocar el estado: si algo falla después, nunca se vuelve a ejecutar sola.
    await d.rpc("managed_request_finish", { _id: s.id, _ok: res.ok, _result: res });
    if (res.ok) {
      hechas++;
      await d.rpc("managed_booking_apply_status", {
        _provider: s.booking.provider, _environment: s.booking.environment, _provider_booking_id: s.booking.provider_booking_id,
        _provider_status: s.kind === "cancelacion" ? "cancelled" : "amended", _kind: "ejecucion", _data: { request_id: s.id },
      });
    } else {
      fallidas++;
      d.log?.("reservas-gestionadas: solicitud", s.id, "falló:", (res as { code?: string }).code);
    }
  }
  return { apagado: false, tomadas: lista.length, hechas, fallidas };
}

/** Consulta el estado de las reservas activas con su proveedor y marca las que ya ocurrieron. Solo lecturas. */
export async function sincronizarReservas(d: TareaDeps): Promise<{ revisadas: number; cambios: number; errores: number; completadas: number }> {
  const r = await d.rpc("managed_bookings_due_sync", { _limit: 20 });
  const lista = Array.isArray(r.data) ? r.data as ReservaInterna[] : [];
  let cambios = 0, errores = 0;
  for (const b of lista) {
    const ad = adaptadorDe(d.adaptadores, b.provider, b.environment);
    if (!ad?.configurado) { errores++; continue; }
    const c = await ad.consultar(idParaProveedor(b));
    if (!c.ok) { errores++; continue; }
    const a = await d.rpc("managed_booking_apply_status", {
      _provider: b.provider, _environment: b.environment, _provider_booking_id: b.provider_booking_id,
      _provider_status: c.reserva.estado_proveedor, _kind: "sincronizacion", _data: { fuente: c.reserva.fuente },
    });
    if ((a.data as { unchanged?: boolean } | null)?.unchanged === false || (a.data as { from?: string } | null)?.from) cambios++;
  }
  const done = await d.rpc("managed_bookings_complete_past", {});
  return { revisadas: lista.length, cambios, errores, completadas: Number(done.data ?? 0) || 0 };
}
