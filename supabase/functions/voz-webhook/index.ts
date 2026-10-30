// voz-webhook — fin de una llamada con voz IA a un proveedor (Vapi "end-of-call-report"). PREPARADO y APAGADO: sin
// VOZ_WEBHOOK_SECRET responde 503 y no hace nada (y no hay llamadas reales sin VOZ_LLAMADAS_REALES=true,
// channels/voz.ts). verify_jwt = false (Vapi no manda JWT; para un servidor dado en la llamada tampoco manda
// credenciales): cada llamada trae el encabezado x-iatos-voz que pusimos al crearla, firmado con VOZ_WEBHOOK_SECRET y
// atado al caso (verificarFirmaLlamada); si no, 401. El resultado estructurado va a la bitácora del caso marcado
// "dicho por teléfono, sin comprobante" (idempotente por id de llamada) y despierta al operador.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { safeErrorMessage } from "../_shared/redact.ts";
import { leerFinDeLlamada, registrarLlamada, verificarFirmaLlamada } from "../_shared/channels/voz.ts";
import { dbCanales } from "../_shared/channels/runtime.ts";
import { despertarOperador } from "../_shared/operador/runtime.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("VOZ_WEBHOOK_SECRET") ?? "";
  if (!secret) return json({ ok: false, code: "VOZ_OFF" }, 503);
  const incidentId = await verificarFirmaLlamada(req.headers.get("x-iatos-voz"), secret);
  if (!incidentId) return json({ ok: false, code: "INVALID_SIGNATURE" }, 401);
  try {
    const fin = leerFinDeLlamada(await req.json().catch(() => null));
    if (!fin) return json({ ok: true, ignored: true });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await registrarLlamada(dbCanales(admin), incidentId, fin);
    if (r.ok && !r.duplicate) await despertarOperador(incidentId, "mensaje");
    return json({ ok: r.ok });
  } catch (e) {
    console.error("voz-webhook error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
