#!/usr/bin/env node
// Genera UNA sola vez el inventario del avatar por capas: fondos (hasta 3 por país) y objetos (2 por
// lugar de souvenirs.ts), con el mismo estilo ilustrado del avatar, y los sube al bucket público
// avatar-assets (registro en la tabla avatar_assets). Ver supabase/functions/_shared/avatar-inventory.ts.
//
// Uso (Node ≥ 22.18, que entiende los .ts compartidos; o `npx tsx scripts/avatar-assets/generate.mjs`):
//   node scripts/avatar-assets/generate.mjs                 → plan y costo estimado; NO llama a la IA
//   node scripts/avatar-assets/generate.mjs --confirm       → genera lo que falta (pide OK del dueño)
// Opciones: --solo=fondos|objetos  --ids=mx-angel,c-paris-1  --limite=N  --forzar (regenera aunque exista)
//           --max-usd=60 (tope de seguridad)  --modelo=google/gemini-3-pro-image-preview
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOVABLE_API_KEY (las mismas de las funciones;
// el script no las guarda ni las imprime).
//
// Idempotente: se salta lo que ya está en avatar_assets con la misma huella del prompt. Si cambia el
// prompt de una imagen, solo esa se vuelve a generar. Costo: imágenes × precio por imagen del modelo.
// La generación vive en supabase/functions/_shared/avatar-assets-gen.ts (la misma que usa la Edge
// Function avatar-assets-gen, para generar con los secretos del servidor sin tenerlos en una máquina).
import { pathToFileURL } from "node:url";
import { planDeAssets, promptHash, ASSETS_BUCKET, FONDOS, OBJETOS } from "../../supabase/functions/_shared/avatar-inventory.ts";
import { generateImage, imageCostUsd, imageModels } from "../../supabase/functions/_shared/avatar-image.ts";
import { generarLote, processImage } from "../../supabase/functions/_shared/avatar-assets-gen.ts";
import { usageRow } from "../../supabase/functions/_shared/usage.ts";

export function parseArgs(argv) {
  const o = { confirm: false, solo: null, ids: null, limite: Infinity, forzar: false, maxUsd: 60, modelo: null };
  for (const a of argv) {
    if (a === "--confirm") o.confirm = true;
    else if (a === "--forzar") o.forzar = true;
    else if (a.startsWith("--solo=")) o.solo = a.slice(7) === "fondos" ? "fondo" : a.slice(7) === "objetos" ? "objeto" : "x";
    else if (a.startsWith("--ids=")) o.ids = new Set(a.slice(6).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith("--limite=")) o.limite = Math.max(0, Number(a.slice(9)) || 0);
    else if (a.startsWith("--max-usd=")) o.maxUsd = Math.max(0, Number(a.slice(10)) || 0);
    else if (a.startsWith("--modelo=")) o.modelo = a.slice(9);
  }
  return o;
}

/** Plan: qué falta generar y cuánto costaría. `existing` = Map id → prompt_hash ya registrado. */
export function buildPlan(opts, existing, usdPorImagen) {
  const all = planDeAssets().map((a) => ({ ...a, hash: promptHash(a.prompt) }));
  const scoped = all.filter((a) => (!opts.solo || a.kind === opts.solo) && (!opts.ids || opts.ids.has(a.id)));
  const pending = scoped.filter((a) => opts.forzar || existing.get(a.id) !== a.hash).slice(0, opts.limite);
  return {
    total: all.length,
    fondos: FONDOS.length,
    objetos: OBJETOS.length,
    enAlcance: scoped.length,
    yaGenerados: scoped.length - scoped.filter((a) => existing.get(a.id) !== a.hash).length,
    pendientes: pending,
    usdPorImagen,
    costoTotalInventario: Math.round(all.length * usdPorImagen * 1000) / 1000,
    costoEstimado: Math.round(pending.length * usdPorImagen * 1000) / 1000,
  };
}

/** Re-exporta el procesado compartido (lo usa también la función avatar-assets-gen). */
export { processImage };

/**
 * deps: { log, listAssets(): Promise<Array<{id, prompt_hash}>>, generate(prompt): Promise<ImageResult>,
 *         fetchBytes(url): Promise<Uint8Array|null>, upload(path, bytes): Promise<void>,
 *         upsertAsset(row): Promise<void>, logUsage(entry): void, models: string[] }
 */
export async function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.solo === "x") { deps.log("--solo debe ser fondos u objetos"); return { ok: false, code: 2 }; }
  const models = opts.modelo ? [opts.modelo] : deps.models;
  const usd = imageCostUsd(models[0]);
  const existing = new Map((await deps.listAssets()).map((r) => [r.id, r.prompt_hash]));
  const plan = buildPlan(opts, existing, usd);
  deps.log(`Inventario: ${plan.total} imágenes (${plan.fondos} fondos + ${plan.objetos} objetos) · ${usd} USD por imagen (${models[0]})`);
  deps.log(`Costo del inventario completo: ${plan.costoTotalInventario.toFixed(2)} USD`);
  deps.log(`En este alcance: ${plan.enAlcance} · ya generados: ${plan.yaGenerados} · por generar ahora: ${plan.pendientes.length}`);
  deps.log(`COSTO ESTIMADO DE ESTA CORRIDA: ${plan.costoEstimado.toFixed(2)} USD`);
  if (!plan.pendientes.length) { deps.log("Nada que generar."); return { ok: true, generados: 0, fallidos: 0, plan }; }
  if (!opts.confirm) {
    deps.log("Sin --confirm no se llama a la IA. Con el OK del dueño, vuelve a correr con --confirm.");
    return { ok: true, generados: 0, fallidos: 0, plan, dryRun: true };
  }
  if (plan.costoEstimado > opts.maxUsd) {
    deps.log(`El costo estimado rebasa --max-usd=${opts.maxUsd}. Sube el tope o usa --limite.`);
    return { ok: false, code: 3, plan };
  }
  const lote = await generarLote(plan.pendientes.map((x) => x.id), existing, { models, maxUsd: Infinity, forzar: opts.forzar }, deps);
  const generados = lote.resultados.filter((r) => r.estado === "generado").length;
  const fallidos = lote.resultados.filter((r) => r.estado === "error").length;
  deps.log(`Listo: ${generados} generados, ${fallidos} fallidos, ~${lote.gastado.toFixed(2)} USD.`);
  return { ok: fallidos === 0, generados, fallidos, gastado: lote.gastado, plan, resultados: lote.resultados };
}

async function realDeps() {
  const env = process.env;
  const { createClient } = await import("@supabase/supabase-js");
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return {
    log: (m) => console.log(m),
    models: imageModels(env.AVATAR_ASSET_MODELS ?? env.AVATAR_IMAGE_MODELS),
    listAssets: async () => {
      if (!db) { console.log("(sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: se asume que falta todo)"); return []; }
      const { data, error } = await db.from("avatar_assets").select("id, prompt_hash");
      if (error) throw new Error(`avatar_assets: ${error.message}`);
      return data ?? [];
    },
    generate: (prompt, models) => {
      if (!env.LOVABLE_API_KEY) throw new Error("falta LOVABLE_API_KEY");
      return generateImage({ fetch: (u, i) => fetch(u, i), lovableKey: env.LOVABLE_API_KEY, models, chat: async () => { throw new Error("sin juez"); } },
        { prompt, images: [], fn: "avatar-assets", userId: null });
    },
    fetchBytes: async (u) => { const r = await fetch(u); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; },
    upload: async (path, bytes) => {
      if (!db) throw new Error("sin conexión a Supabase");
      const { error } = await db.storage.from(ASSETS_BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`upload: ${error.message}`);
    },
    upsertAsset: async (row) => {
      const { error } = await db.from("avatar_assets").upsert(row, { onConflict: "id" });
      if (error) throw new Error(`avatar_assets: ${error.message}`);
    },
    logUsage: (u) => { if (db) db.from("ai_usage_log").insert(usageRow(u)).then(() => {}, () => {}); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const res = await run(process.argv.slice(2), await realDeps());
  process.exit(res.ok ? 0 : res.code ?? 1);
}
