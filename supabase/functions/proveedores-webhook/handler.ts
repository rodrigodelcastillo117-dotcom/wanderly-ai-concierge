// proveedores-webhook (lógica, sin Deno.serve: se prueba con Vitest). Avisos de estado de los proveedores:
//   · RateHawk (?p=ratehawk): firma HMAC-SHA256(API key, timestamp+token) verificada en _shared/proveedores/ratehawk.ts;
//     cada token se acepta una sola vez (provider_webhook_token_once). Estado completed|failed se aplica directo;
//     los avisos de midoffice (created|updated) se confirman consultando la orden con la API (no se confía en el aviso).
//   · Viator no manda webhooks (se consulta /bookings/modified-since en la tarea reservas-gestionadas).
//   · Traslados: NO VERIFICADO → 404.
// Respuestas: 200 cuando se procesó o se ignoró a propósito (para que el proveedor no reintente sin fin);
// 401 si la firma no es válida; 500 solo si falló la base (el proveedor reintenta).
import type { Adaptadores, Rpc } from "../_shared/proveedores/registro.ts";

export type WebhookDeps = { rpc: Rpc; adaptadores: Adaptadores };
export type WebhookOut = { status: number; body: Record<string, unknown> };

export async function manejarWebhook(proveedor: string | null, body: unknown, d: WebhookDeps): Promise<WebhookOut> {
  if (proveedor !== "ratehawk") return { status: 404, body: { ok: false, code: proveedor === "traslados" ? "NO_VERIFICADO" : "PROVEEDOR_DESCONOCIDO" } };
  const ad = d.adaptadores.ratehawk;
  if (!ad.configurado || !ad.webhook) return { status: 503, body: { ok: false, code: "SIN_CONFIGURAR" } };
  const w = await ad.webhook(body);
  if (!w.autentico) return { status: 401, body: { ok: false, code: "FIRMA_INVALIDA", motivo: w.motivo } };
  const once = await d.rpc("provider_webhook_token_once", { _provider: "ratehawk", _token: w.token });
  if (once.error) return { status: 500, body: { ok: false, code: "BASE" } };
  if (once.data !== true) return { status: 200, body: { ok: true, repetido: true } };
  if (!w.id || !w.estado_proveedor) return { status: 200, body: { ok: true, ignorado: "sin_orden" } };
  let estado = w.estado_proveedor;
  if (estado.startsWith("consultar:")) {
    const c = await ad.consultar(w.id);
    if (c.ok === false) return { status: 200, body: { ok: true, ignorado: c.code } };
    estado = c.reserva.estado_proveedor;
  }
  const r = await d.rpc("managed_booking_apply_status", {
    _provider: "ratehawk", _environment: ad.entorno, _provider_booking_id: w.id, _provider_status: estado, _kind: "webhook", _data: { aviso: w.estado_proveedor },
  });
  if (r.error) return { status: 500, body: { ok: false, code: "BASE" } };
  return { status: 200, body: { ok: true, resultado: r.data } };
}
