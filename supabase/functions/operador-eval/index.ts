// operador-eval — evaluación del Operador IATOS con IA REAL desde el servidor: la llave de Anthropic no sale de aquí.
// Solo administradores (verify_jwt = true + public.admins). Corre una tanda corta de escenarios (máx. 4) sobre memoria
// simulada: NO escribe en la base real, NO manda correos, mensajes ni push, NO busca vuelos reales (todo en memoria;
// lo único real son las llamadas a Claude). Tope de gasto por llamada (tope_usd, 1 USD por omisión, máx. 5) y una
// evaluación a la vez. Uso: POST { desde?: number, cantidad?: 1–4, solo?: ["V01"], tope_usd?: number } →
// { escenarios, resumen, gasto_usd, siguiente }. Guía: docs/ops/DIA_DE_LOVABLE.md, paso g.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { modeloOperadorReal } from "../_shared/operador/runtime.ts";
import { relojFijo } from "../_shared/operador/eval/reloj.ts";
import { correrTandaEval, leerPedidoEval } from "../_shared/operador/eval/servidor.ts";
import { safeErrorMessage } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Una evaluación a la vez por instancia (el reloj fijo de la evaluación es global mientras corre).
let corriendo = false;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!isAdmin) return json({ code: "FORBIDDEN", error: "solo administradores" }, 403);
  const rl = await enforceRateLimit(req, "operador-eval", user.id, { perMinute: 6, perHour: 60, ipPerMinute: 10 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const pedido = leerPedidoEval(await req.json().catch(() => null));
  if (!pedido.ok) return json({ code: "BAD_REQUEST", error: pedido.error }, 400);
  const modelo = modeloOperadorReal();
  if (!modelo) return json({ code: "SIN_LLAVE", error: "falta ANTHROPIC_API_KEY en los secretos de las funciones" }, 503);
  if (corriendo) return json({ code: "OCUPADO", error: "ya hay una evaluación corriendo; intenta en un minuto" }, 409);
  corriendo = true;
  try {
    const r = await correrTandaEval(pedido.pedido, { modelo, reloj: relojFijo() });
    console.log("operador-eval:", JSON.stringify({ admin: user.id, ...r.resumen, gasto_usd: r.gasto_usd, siguiente: r.siguiente }));
    return json(r);
  } catch (e) {
    console.error("operador-eval error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  } finally {
    corriendo = false;
  }
});
