// ai-reservations — API de Reservas IA (canal correo) para la app, Concierge 2.0 y el Booking Bridge.
// POST (JWT del usuario) {action: create_intent | confirm_send | choose_alternative | cancel | status, ...}
// GET  ?ics=<id>&u=<user>&sig=<firma> → .ics de una reserva CONFIRMADA (enlace firmado del correo).
// verify_jwt = false SOLO para que el enlace .ics del correo funcione sin sesión; todo POST valida el
// JWT aquí (getAuthUser) y falla cerrado. Contrato: docs/iatos/IATOS_RESERVAS_IA.md §API.
// Apagado por defecto: app_flags.ai_reservations_enabled = false → FEATURE_DISABLED, nada sale.
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { buildServiceDeps } from "../_shared/ai-reservations/runtime.ts";
import {
  cancelReservation, chooseAlternative, confirmSend, createIntent, icsForLink, reservationStatus,
} from "../_shared/ai-reservations/service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      const id = u.searchParams.get("ics") ?? "";
      const user = u.searchParams.get("u") ?? "";
      if (!UUID.test(id) || !UUID.test(user)) return new Response("not_found", { status: 404 });
      const r = await icsForLink(buildServiceDeps(), id, user, u.searchParams.get("sig"));
      return new Response(r.body, {
        status: r.status,
        headers: { "Content-Type": r.type, ...(r.status === 200 ? { "Content-Disposition": `attachment; filename="reserva-${id.slice(0, 8)}.ics"` } : {}) },
      });
    }
    if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);

    const user = await getAuthUser(req);
    if (!user) return unauthorizedResponse(corsHeaders);
    const rl = await enforceRateLimit(req, "ai-reservations", user.id, { perMinute: 10, perHour: 60, ipPerMinute: 30 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = (await req.json().catch(() => null)) as Record<string, any> | null;
    if (!body || typeof body.action !== "string") return json({ ok: false, code: "BAD_REQUEST" }, 400);
    if (body.id !== undefined && !UUID.test(String(body.id))) return json({ ok: false, code: "BAD_REQUEST" }, 400);
    const deps = buildServiceDeps();
    const r = body.action === "create_intent" ? await createIntent(deps, user.id, body as never)
      : body.action === "confirm_send" ? await confirmSend(deps, user.id, body)
      : body.action === "choose_alternative" ? await chooseAlternative(deps, user.id, body)
      : body.action === "cancel" ? await cancelReservation(deps, user.id, body)
      : body.action === "status" ? await reservationStatus(deps, user.id, body)
      : { status: 400, body: { ok: false, code: "UNKNOWN_ACTION" } };
    return json(r.body, r.status);
  } catch (e) {
    console.error("ai-reservations error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL", message: "No se pudo completar. No se envió nada." }, 500);
  }
});
