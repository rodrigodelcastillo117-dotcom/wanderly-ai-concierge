// reservations-inbound — webhook de Resend Receiving (evento email.received) para las respuestas de
// los restaurantes a reservas+<token>@reply.traveliatos.life.
// verify_jwt = false: Resend no manda JWT. Se exige la firma Svix con RESEND_INBOUND_SECRET (sin
// secreto configurado → 503; sin firma o firma inválida → 401). Idempotente: el mismo evento dos veces
// no se procesa dos veces (ai_reservation_inbound). Lógica en _shared/ai-reservations/service.ts.
import { safeErrorMessage } from "../_shared/redact.ts";
import { buildServiceDeps } from "../_shared/ai-reservations/runtime.ts";
import { handleInbound } from "../_shared/ai-reservations/service.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  try {
    const raw = await req.text(); // crudo: la firma se calcula sobre el cuerpo exacto
    if (raw.length > 256_000) return new Response(JSON.stringify({ ok: false, code: "TOO_LARGE" }), { status: 413 });
    const r = await handleInbound(buildServiceDeps(), req.headers, raw);
    // Solo el resultado, nunca contenido del correo.
    console.log("reservations-inbound:", r.status, JSON.stringify({ code: r.body.code ?? null, outcome: r.body.outcome ?? null }));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("reservations-inbound error:", safeErrorMessage(e));
    return new Response(JSON.stringify({ ok: false, code: "INTERNAL" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
