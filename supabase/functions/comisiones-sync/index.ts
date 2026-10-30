// comisiones-sync — libro de comisiones: lee las ventas afiliadas y los pagos de Travelpayouts (API de finanzas, solo
// lectura) y los guarda en public.commissions (pendiente/confirmada/pagada/rechazada). La lógica y las fuentes oficiales
// están en _shared/comisiones/travelpayouts.ts (probada con Vitest).
// verify_jwt = false: lo dispara pg_cron (docs/ops/programar-comisiones.sql) con el secreto de Vault; se valida con
// isAuthorizedCron (falla cerrada). Con app_flags.comisiones_sync_enabled = false no llama a Travelpayouts.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { sincronizarTravelpayouts } from "../_shared/comisiones/travelpayouts.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const r = await sincronizarTravelpayouts({
      fetchImpl: fetch,
      token: Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? undefined,
      rpc: (fn, args) => admin.rpc(fn, args),
      prendido: async () => {
        const { data } = await admin.rpc("app_flag", { _key: "comisiones_sync_enabled" });
        return data === true;
      },
    });
    console.log("comisiones-sync:", JSON.stringify(r));
    return json(r, r.ok || r.apagado ? 200 : 502);
  } catch (e) {
    console.error("comisiones-sync error:", safeErrorMessage(e));
    return json({ ok: false, code: "INTERNAL" }, 500);
  }
});
