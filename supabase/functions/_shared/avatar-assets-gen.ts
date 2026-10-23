// Generación del inventario del avatar (fondos y objetos), una imagen a la vez. Lógica pura con las
// dependencias inyectadas: la usan la Edge Function avatar-assets-gen (secretos del servidor) y el
// script scripts/avatar-assets/generate.mjs. Pruebas con dobles en Vitest (nunca IA real).
//
// Idempotente por huella del prompt (avatar_assets.prompt_hash): si ya existe con la misma huella, se
// salta. Tope de gasto: si el costo estimado de lo pendiente rebasa el tope, no se genera nada.
import { FONDOS, OBJETOS, planDeAssets, promptHash, type AssetPlan } from "./avatar-inventory.ts";
import { imageCostUsd, type ImageResult } from "./avatar-image.ts";
import { decodeDataUrl } from "./avatar-prompts.ts";
import { decodePng, encodePng, resize } from "./avatar-png.ts";
import { chromaCutout, trimToContent } from "./avatar-cutout.ts";
import { CANVAS, cover } from "./avatar-layers.ts";
import type { UsageEntry } from "./usage.ts";

export const OBJETO_MAX_PX = 512;
export const ASSETS_FN = "avatar-assets";

export type AssetRow = {
  id: string; kind: "fondo" | "objeto"; pais: string | null; souvenir_key: string | null; path: string; prompt_hash: string;
  width: number; height: number; bytes: number; model: string | null; updated_at: string;
};

export type AssetGenDeps = {
  generate: (prompt: string, models: string[]) => Promise<ImageResult>;
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  upsertAsset: (row: AssetRow) => Promise<void>;
  logUsage: (u: UsageEntry) => void;
  log?: (m: string) => void;
};

export type AssetPlanItem = AssetPlan & { hash: string };
export type AssetOutcome = { id: string; estado: "generado" | "saltado" | "error"; detalle?: string; kb?: number };

/** Plan con huella de cada imagen. */
export function planConHuella(): AssetPlanItem[] {
  return planDeAssets().map((a) => ({ ...a, hash: promptHash(a.prompt) }));
}

/** Pendientes de una lista de ids: desconocidos, ya generados (misma huella) y por generar. */
export function clasificar(ids: string[], existing: Map<string, string>, forzar = false) {
  const plan = new Map(planConHuella().map((a) => [a.id, a]));
  const desconocidos: string[] = [], saltados: string[] = [];
  const pendientes: AssetPlanItem[] = [];
  for (const id of [...new Set(ids)]) {
    const a = plan.get(id);
    if (!a) desconocidos.push(id);
    else if (!forzar && existing.get(id) === a.hash) saltados.push(id);
    else pendientes.push(a);
  }
  return { desconocidos, saltados, pendientes };
}

/** Bytes PNG listos para subir: fondo 4:5 opaco u objeto recortado (transparente, máx. 512 px). */
export async function processImage(kind: "fondo" | "objeto", pngBytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const raster = await decodePng(pngBytes);
  if (kind === "fondo") {
    const out = cover(raster, CANVAS.w, CANVAS.h);
    return { bytes: await encodePng(out), width: out.width, height: out.height };
  }
  const { image, report } = chromaCutout(raster);
  if (!report.ok) throw new Error(`recorte: ${report.motivo}`);
  let obj = trimToContent(image);
  const k = Math.min(1, OBJETO_MAX_PX / Math.max(obj.width, obj.height));
  if (k < 1) obj = resize(obj, obj.width * k, obj.height * k);
  return { bytes: await encodePng(obj), width: obj.width, height: obj.height };
}

export type GenOneResult = { ok: true; kb: number; usd: number } | { ok: false; detalle: string; usd: number; detener?: boolean };

/** Genera, procesa, sube y registra UNA imagen del inventario. */
export async function generarUno(a: AssetPlanItem, models: string[], deps: AssetGenDeps): Promise<GenOneResult> {
  let usd = 0;
  try {
    const res = await deps.generate(a.prompt, models);
    const usage = Array.isArray(res.usage) ? res.usage : [res.usage];
    for (const u of usage) if (u) { deps.logUsage({ ...u, function: ASSETS_FN }); usd += Number(u.cost_estimate_usd) || 0; }
    if (!res.ok) {
      const code = (res as Extract<ImageResult, { ok: false }>).code;
      return { ok: false, detalle: code, usd, detener: code === "sin_creditos" || code === "saturado" };
    }
    const raw = res.url.startsWith("data:") ? decodeDataUrl(res.url)?.bytes ?? null : await deps.fetchBytes(res.url);
    if (!raw) return { ok: false, detalle: "imagen ilegible", usd };
    const out = await processImage(a.kind, raw);
    await deps.upload(a.path, out.bytes);
    await deps.upsertAsset({
      id: a.id, kind: a.kind,
      pais: a.kind === "fondo" ? FONDOS.find((f) => f.id === a.id)?.pais ?? null : null,
      souvenir_key: a.kind === "objeto" ? OBJETOS.find((o) => o.id === a.id)?.souvenir ?? null : null,
      path: a.path, prompt_hash: a.hash, width: out.width, height: out.height, bytes: out.bytes.length,
      model: res.model, updated_at: new Date().toISOString(),
    });
    return { ok: true, kb: Math.round(out.bytes.length / 1024), usd };
  } catch (e) {
    return { ok: false, detalle: String((e as Error)?.message ?? e).slice(0, 200), usd };
  }
}

export type LoteOpts = {
  models: string[];
  /** Tope de esta llamada (USD) sobre el costo ESTIMADO de lo pendiente. */
  maxUsd: number;
  /** Ya gastado antes en el inventario (ai_usage_log) y tope acumulado. */
  gastadoPrevio?: number;
  topeTotalUsd?: number;
  forzar?: boolean;
  /** En paralelo (la función, para no pasar el tiempo límite) o en serie (el script). */
  paralelo?: boolean;
};

/** Un lote de ids: respuesta por id (generado, saltado o error), sin rebasar los topes. */
export async function generarLote(ids: string[], existing: Map<string, string>, opts: LoteOpts, deps: AssetGenDeps) {
  const { desconocidos, saltados, pendientes } = clasificar(ids, existing, opts.forzar);
  const usdPorImagen = imageCostUsd(opts.models[0] ?? "");
  const estimado = Math.round(pendientes.length * usdPorImagen * 1000) / 1000;
  const resultados: AssetOutcome[] = [
    ...saltados.map((id) => ({ id, estado: "saltado" as const, detalle: "ya generado (misma huella)" })),
    ...desconocidos.map((id) => ({ id, estado: "error" as const, detalle: "id desconocido" })),
  ];
  const total = (opts.gastadoPrevio ?? 0) + estimado;
  if (pendientes.length && (estimado > opts.maxUsd || (opts.topeTotalUsd !== undefined && total > opts.topeTotalUsd))) {
    for (const a of pendientes) resultados.push({ id: a.id, estado: "error", detalle: `tope de gasto: estimado ${estimado} USD` });
    return { ok: false, resultados, estimado, gastado: 0, tope: true };
  }
  let gastado = 0;
  const uno = async (a: AssetPlanItem): Promise<AssetOutcome> => {
    const r = await generarUno(a, opts.models, deps);
    gastado += r.usd;
    deps.log?.(r.ok ? `✓ ${a.id} (${r.kb} KB)` : `✗ ${a.id}: ${(r as Extract<GenOneResult, { ok: false }>).detalle}`);
    return r.ok ? { id: a.id, estado: "generado", kb: r.kb } : { id: a.id, estado: "error", detalle: (r as Extract<GenOneResult, { ok: false }>).detalle };
  };
  if (opts.paralelo) {
    resultados.push(...(await Promise.all(pendientes.map(uno))));
  } else {
    for (const a of pendientes) {
      const out = await uno(a);
      resultados.push(out);
      if (out.estado === "error" && (out.detalle === "sin_creditos" || out.detalle === "saturado")) {
        deps.log?.("Se detiene: el servicio de imágenes no está disponible.");
        break;
      }
    }
  }
  const orden = new Map(ids.map((id, i) => [id, i]));
  resultados.sort((x, y) => (orden.get(x.id) ?? 0) - (orden.get(y.id) ?? 0));
  return { ok: resultados.every((r) => r.estado !== "error"), resultados, estimado, gastado: Math.round(gastado * 1000) / 1000, tope: false };
}

/** Los 12 de la prueba piloto (4 llamadas de 3). */
export const PILOTO_IDS: string[][] = [
  ["mx-angel", "mx-bellas-artes", "mx-teotihuacan"],
  ["c-paris-1", "c-paris-2", "p-us-1"],
  ["c-nueva-york-1", "p-ar-1", "p-ar-2"],
  ["p-gr-1", "p-gr-2", "g-viajero-1"],
];
