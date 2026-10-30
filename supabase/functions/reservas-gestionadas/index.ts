// reservas-gestionadas — tarea de las reservas que IATOS tiene "en la mano" (lógica en _shared/proveedores/registro.ts):
//   · pg_cron / llave de servicio (isAuthorizedCron): {tick: true}
//       1) ejecuta con el proveedor los cambios/cancelaciones que una PERSONA aprobó en el tablero (solo si
//          app_flags.reservas_gestionadas_cambios_enabled; en producción además proveedores_reservas_enabled);
//       2) consulta el estado de las reservas activas con su proveedor (solo lectura) y marca las ya ocurridas.
//   · un administrador con su sesión: {diagnostico: true} → qué adaptadores tienen secretos, su entorno, si están
//     verificados contra documentación pública y el nivel de la llave de Viator (dos GET de lectura, sin reservar).
// verify_jwt = false (pg_cron no manda sesión); la autorización se valida aquí y falla cerrada.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { getAuthUser } from "../_shared/verify-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { adaptadoresDesdeEnv, ejecutarSolicitudes, sincronizarReservas } from "../_shared/proveedores/registro.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({})) as { tick?: boolean; diagnostico?: boolean };
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const adaptadores = adaptadoresDesdeEnv((k) => Deno.env.get(k), fetch);
  try {
    if (await isAuthorizedCron(req)) {
      if (!body.tick) return json({ ok: false, code: "BAD_REQUEST" }, 400);
      const deps = {
        rpc: (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args),
        adaptadores,
        reservasRealesPermitidas: async () => (await admin.rpc("app_flag", { _key: "proveedores_reservas_enabled" })).data === true,
        log: (...a: unknown[]) => console.warn(...a),
      };
      const ejecucion = await ejecutarSolicitudes(deps);
      const sincronizacion = await sincronizarReservas(deps);
      console.log("reservas-gestionadas tick:", JSON.stringify({ ejecucion, sincronizacion }));
      return json({ ok: true, ejecucion, sincronizacion });
    }
    const user = await getAuthUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: esAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!esAdmin) return json({ error: "forbidden" }, 403);
    if (!body.diagnostico) return json({ ok: false, code: "BAD_REQUEST" }, 400);
    const viator = await adaptadores.viator.nivel();
    const resumen = (a: { id: string; verificado: boolean; configurado: boolean; entorno: string; documentacion: string[] }) =>
      ({ id: a.id, verificado: a.verificado, configurado: a.configurado, entorno: a.entorno, documentacion: a.documentacion });
    return json({
      ok: true,
      adaptadores: [resumen(adaptadores.ratehawk), { ...resumen(adaptadores.viator), nivel: viator.nivel, nivel_detalle: viator.detalle }, resumen(adaptadores.traslados)],
    });
  } catch (e) {
    console.error("reservas-gestionadas error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
