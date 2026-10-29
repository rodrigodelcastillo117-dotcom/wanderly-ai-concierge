// reclamos-inbound — webhook de Resend Receiving (email.received) para reclamos+<token>@ y casos+<token>@
// reply.traveliatos.life. Es un SEGUNDO webhook sobre el mismo dominio que Reservas IA, con su propio
// secreto (RECLAMOS_INBOUND_SECRET): sin secreto → 503; sin firma o firma inválida → 401. Ignora los
// correos de reservas+ (los procesa reservations-inbound). Idempotente por evento y por Message-ID.
// verify_jwt = false: Resend no manda JWT. Lógica en _shared/derechos/servicio.ts (handleInbound).
import { safeErrorMessage } from "../_shared/redact.ts";
import { buildReclamosDeps } from "../_shared/derechos/runtime.ts";
import { handleInbound } from "../_shared/derechos/servicio.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  try {
    const raw = await req.text();
    if (raw.length > 256_000) return new Response(JSON.stringify({ ok: false, code: "TOO_LARGE" }), { status: 413 });
    const r = await handleInbound(buildReclamosDeps(), req.headers, raw);
    console.log("reclamos-inbound:", r.status, JSON.stringify({ code: r.body.code ?? null, resultado: r.body.resultado ?? null, ignored: r.body.ignored ?? null }));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("reclamos-inbound error:", safeErrorMessage(e));
    return new Response(JSON.stringify({ ok: false, code: "INTERNAL" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
