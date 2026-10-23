// supabase/functions/avatar-assets-gen/index.ts
// Genera imágenes del inventario del avatar (fondos y objetos) con los secretos del SERVIDOR, para que
// nadie tenga SUPABASE_SERVICE_ROLE_KEY ni LOVABLE_API_KEY en su máquina (grupo avatar-inventario).
//
//   POST {ids: string[] (1-3), max_usd?: number, forzar?: boolean}
//   Puerta: header x-cron-secret (o llave de servicio), igual que las demás funciones programadas
//   (_shared/cron-auth.ts). verify_jwt = false en config.toml.
//
// Máximo 3 ids por llamada (en paralelo) para no pasar el tiempo límite de la función. Idempotente por
// huella del prompt; sube a avatar-assets y registra en avatar_assets. Tope por llamada (max_usd, por
// defecto 1 USD, sobre el costo estimado) y tope acumulado del inventario (TOPE_TOTAL_USD) contra lo ya
// registrado en ai_usage_log. Responde por id: generado, saltado o error. La lógica vive en
// _shared/avatar-assets-gen.ts (la misma del script scripts/avatar-assets/generate.mjs).
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { admin, imageDeps, usageLogger } from "../_shared/avatar-runtime.ts";
import { generateImage } from "../_shared/avatar-image.ts";
import { ASSETS_BUCKET } from "../_shared/avatar-inventory.ts";
import { ASSETS_FN, generarLote } from "../_shared/avatar-assets-gen.ts";
import { parseGenBody, TOPE_TOTAL_USD } from "../_shared/avatar-assets-gen-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  if (!(await isAuthorizedCron(req))) return json({ ok: false, error: "No autorizado" }, 401);
  try {
    const parsed = parseGenBody(await req.json().catch(() => null));
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
    if (!Deno.env.get("LOVABLE_API_KEY")) return json({ ok: false, error: "LOVABLE_API_KEY" }, 503);
    const db = admin();
    const img = imageDeps();

    const { data: rows, error } = await db.from("avatar_assets").select("id, prompt_hash").in("id", parsed.ids);
    if (error) return json({ ok: false, error: `avatar_assets: ${error.message}` }, 500);
    const existing = new Map(((rows ?? []) as Array<{ id: string; prompt_hash: string }>).map((r) => [r.id, r.prompt_hash]));

    // Lo ya gastado en el inventario (todas las corridas) para el tope acumulado.
    const { data: spent } = await db.from("ai_usage_log").select("cost_estimate_usd").eq("function", ASSETS_FN).limit(5000);
    const gastadoPrevio = ((spent ?? []) as Array<{ cost_estimate_usd: number | null }>).reduce((n, r) => n + (Number(r.cost_estimate_usd) || 0), 0);

    const log = usageLogger(db);
    const out = await generarLote(parsed.ids, existing, {
      models: img.models, maxUsd: parsed.maxUsd, gastadoPrevio, topeTotalUsd: TOPE_TOTAL_USD, forzar: parsed.forzar, paralelo: true,
    }, {
      generate: (prompt, models) => generateImage({ ...img, models }, { prompt, images: [], fn: ASSETS_FN, userId: null }),
      fetchBytes: async (u) => { const r = await fetch(u); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; },
      upload: async (path, bytes) => {
        const { error: upErr } = await db.storage.from(ASSETS_BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
        if (upErr) throw new Error(`upload: ${upErr.message}`);
      },
      upsertAsset: async (row) => {
        const { error: rowErr } = await db.from("avatar_assets").upsert(row, { onConflict: "id" });
        if (rowErr) throw new Error(`avatar_assets: ${rowErr.message}`);
      },
      logUsage: log,
      log: (m) => console.log("avatar-assets-gen", m),
    });
    return json({
      ok: out.ok, resultados: out.resultados, costo_estimado_usd: out.estimado, gastado_usd: out.gastado,
      gastado_inventario_usd: Math.round((gastadoPrevio + out.gastado) * 1000) / 1000, tope: out.tope,
    }, out.tope ? 402 : 200);
  } catch (e) {
    console.error("avatar-assets-gen error:", e);
    return json({ ok: false, error: "No se pudo generar" }, 500);
  }
});
