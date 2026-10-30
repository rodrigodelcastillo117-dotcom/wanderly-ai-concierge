// proveedores-webhook — avisos de estado de reservas de proveedores (lógica en handler.ts). verify_jwt = false: el
// proveedor no manda sesión; la autenticidad es su firma (RateHawk: HMAC con la llave de API). URL para el soporte de
// ETG: https://<proyecto>.supabase.co/functions/v1/proveedores-webhook?p=ratehawk
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { safeErrorMessage } from "../_shared/redact.ts";
import { adaptadoresDesdeEnv } from "../_shared/proveedores/registro.ts";
import { manejarWebhook } from "./handler.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const texto = await req.text();
  if (texto.length > 32_000) return new Response(JSON.stringify({ ok: false, code: "DEMASIADO_GRANDE" }), { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(texto); } catch { return new Response(JSON.stringify({ ok: false, code: "JSON" }), { status: 400 }); }
  try {
    const r = await manejarWebhook(new URL(req.url).searchParams.get("p"), body, {
      rpc: (fn, args) => admin.rpc(fn, args),
      adaptadores: adaptadoresDesdeEnv((k) => Deno.env.get(k), fetch),
    });
    if (r.status !== 200) console.warn("proveedores-webhook:", r.status, JSON.stringify(r.body));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("proveedores-webhook error:", safeErrorMessage(e));
    return new Response(JSON.stringify({ ok: false, code: "INTERNAL" }), { status: 500 });
  }
});
