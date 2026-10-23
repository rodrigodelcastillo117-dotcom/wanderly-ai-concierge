// Conexión real (service_role, storage, IA) del avatar. La lógica vive en avatar-flow.ts,
// avatar-image.ts, avatar-prompts.ts y souvenirs.ts (probadas con Vitest); aquí solo se conecta.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { aiFetchDetailed } from "./ai.ts";
import { checkLikeness, generateImage, imageModels, type ImageDeps } from "./avatar-image.ts";
import { decodeDataUrl, toDataUrl } from "./avatar-prompts.ts";
import { rebuildAvatar, type CoreDeps, type EvolutionDeps, type OwnedSouvenir, type SouvenirStatus } from "./avatar-flow.ts";
import { resolveSouvenir, type Souvenir, type SouvenirSlot } from "./souvenirs.ts";
import { type UsageEntry, usageRow } from "./usage.ts";
import { decodePng, encodePng, isPng, makeRaster, resize, drawOver, type Raster } from "./avatar-png.ts";
import { chromaCutout } from "./avatar-cutout.ts";
import { composeAvatar, crop, faceRectFromAlpha, type FaceRect, type HandPoint } from "./avatar-layers.ts";
import {
  ASSETS_BUCKET, objetosIniciales, paisDesdePerfil, recuerdosDeObjetos, resolverFondo,
} from "./avatar-inventory.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";

export const PRIVATE_BUCKET = "avatar-private";
export const PUBLIC_BUCKET = "travel-moments";

/** Cupos diarios de imágenes por persona (variables de entorno opcionales). */
export const DAILY = {
  crear: Number(Deno.env.get("AVATAR_DAILY_IMAGES") ?? "") || 8,
  evolucion: Number(Deno.env.get("AVATAR_DAILY_EVOLUTION_IMAGES") ?? "") || 4,
};

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function imageDeps(): ImageDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    lovableKey: Deno.env.get("LOVABLE_API_KEY") ?? "",
    models: imageModels(Deno.env.get("AVATAR_IMAGE_MODELS")),
    chat: (init) => aiFetchDetailed(init),
  };
}

/** Registra en ai_usage_log sin detener nada si falla. */
export function usageLogger(db: SupabaseClient): (u: UsageEntry) => void {
  return (u) => {
    db.from("ai_usage_log").insert(usageRow(u)).then(({ error }) => {
      if (error) console.warn("ai_usage_log insert:", error.message);
    }, (e) => console.warn("ai_usage_log exception:", (e as Error)?.message));
  };
}

export function coreDeps(db: SupabaseClient, userId: string, kind: "crear" | "evolucion", fn: string): CoreDeps {
  const img = imageDeps();
  return {
    generate: (prompt, images) => generateImage(img, { prompt, images, fn, userId }),
    check: (reference, candidate, mode, full) => checkLikeness(img, { reference, candidate, mode, fn, userId, full }),
    prepare: prepareVariant,
    take: async (n) => {
      const { data, error } = await db.rpc("avatar_take_images", { p_user: userId, p_kind: kind, p_n: n, p_max: DAILY[kind] });
      if (error) { console.warn("avatar_take_images:", error.message); return 0; }
      return Number(data) || 0;
    },
    logUsage: usageLogger(db),
  };
}

/**
 * Bandera app_flags.avatar_capas_enabled (false | true | "founders"), decidida en la base de datos
 * (avatar_capas_para). Si la función aún no existe o falla: apagada (todo como antes).
 */
export async function capasHabilitado(db: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("avatar_capas_para", { p_user: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Bytes de una imagen del modelo (data URL o https). */
export async function imageBytes(url: string): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  if (url.startsWith("data:")) return decodeDataUrl(url);
  const res = await fetch(url);
  if (!res.ok) return null;
  const mime = (res.headers.get("content-type") ?? "image/png").split(";")[0];
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mime, ext: mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png" };
}

/** Imagen privada → data URL (para mandarla como referencia al modelo). */
export async function loadPrivate(db: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(PRIVATE_BUCKET).download(path);
  if (error || !data) return null;
  const mime = data.type && /^image\//.test(data.type) ? data.type : "image/png";
  return toDataUrl(new Uint8Array(await data.arrayBuffer()), mime);
}

type Img = { bytes: Uint8Array; mime: string; ext: string };

/**
 * Publica una imagen como avatar actual: copia pública en travel-moments/avatars/{uid}/{uuid}
 * (Social y el menú la muestran), avatar_profiles, y profiles.avatar_url = ÚNICA fuente que lee la
 * app. Se conserva perfil_ia.avatar_url/avatar_meta por compatibilidad. Borra la copia pública anterior.
 */
export async function publishAvatar(
  db: SupabaseClient,
  userId: string,
  imageUrl: string,
  meta: { visibleKeys: string[]; model: string | null; score: number | null; basePath?: string },
): Promise<string> {
  const img = await imageBytes(imageUrl);
  if (!img) throw new Error("imagen_invalida");
  return publishImages(db, userId, { face: img }, meta);
}

/**
 * Publica `face` como avatar (profiles.avatar_url, current_url: lo que muestran los círculos) y, en el
 * avatar por capas, `full` como cuerpo completo ({uuid}-cuerpo.png → avatar_profiles.cuerpo_url).
 */
export async function publishImages(
  db: SupabaseClient,
  userId: string,
  imgs: { face: Img; full?: Img },
  meta: { visibleKeys: string[]; model: string | null; score: number | null; basePath?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const upload = async (img: Img, suffix: string) => {
    const path = `avatars/${userId}/${id}${suffix}.${img.ext}`;
    const up = await db.storage.from(PUBLIC_BUCKET).upload(path, img.bytes, { contentType: img.mime, upsert: false });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    return { path, url: db.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl };
  };
  const face = await upload(imgs.face, "");
  const full = imgs.full ? await upload(imgs.full, "-cuerpo") : null;
  // profiles.avatar_url = la imagen de los círculos (en el avatar por capas, el recorte de la cara).
  const url = face.url;

  // select("*"): con la bandera apagada esto corre igual aunque la migración de capas no esté aplicada.
  const { data: prev } = await db.from("avatar_profiles").select("*").eq("user_id", userId).maybeSingle();
  const version = Number(prev?.version ?? 0) + 1;
  const row: Record<string, unknown> = {
    user_id: userId, current_url: url, current_path: face.path, version, visible_keys: meta.visibleKeys,
    updated_at: new Date().toISOString(),
  };
  // Cuerpo completo solo en el avatar por capas (o para limpiar el de un avatar por capas anterior).
  if (full || prev?.cuerpo_path) Object.assign(row, { cuerpo_url: full?.url ?? null, cuerpo_path: full?.path ?? null });
  if (meta.basePath) Object.assign(row, { base_path: meta.basePath, likeness_score: meta.score, model: meta.model });
  const { error: apErr } = await db.from("avatar_profiles").upsert(row, { onConflict: "user_id" });
  if (apErr) throw new Error(`avatar_profiles: ${apErr.message}`);
  await db.from("profiles").update({ avatar_url: url }).eq("id", userId);

  // Compatibilidad: quien aún lea perfil_ia ve el mismo avatar (merge, no reemplazo).
  const { data: prefs } = await db.from("ai_user_preferences").select("perfil_ia").eq("user_id", userId).maybeSingle();
  if (prefs) {
    const perfil = { ...((prefs.perfil_ia as Record<string, unknown>) ?? {}), avatar_url: url, avatar_meta: { version, generated_at: new Date().toISOString(), souvenirs: meta.visibleKeys } };
    await db.from("ai_user_preferences").update({ perfil_ia: perfil }).eq("user_id", userId);
  }
  const old = [prev?.current_path, prev?.cuerpo_path].filter((p): p is string => !!p && p !== face.path && p !== full?.path);
  if (old.length) await db.storage.from(PUBLIC_BUCKET).remove(old).catch(() => null);
  return url;
}

// ───────────── avatar por capas (sin IA) ─────────────

const pngImg = (bytes: Uint8Array): Img => ({ bytes, mime: "image/png", ext: "png" });

async function rasterFrom(bytes: Uint8Array | null): Promise<Raster | null> {
  if (!bytes || !isPng(bytes)) return null;
  try { return await decodePng(bytes); } catch { return null; }
}

async function downloadRaster(db: SupabaseClient, bucket: string, path: string): Promise<Raster | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  return rasterFrom(new Uint8Array(await data.arrayBuffer()));
}

/** Recorte de la cara de la persona sobre gris cálido (lo que ve el juez de parecido). */
function faceView(persona: Raster, cara: FaceRect): Raster {
  const side = Math.max(32, Math.min(persona.height, cara.side * persona.height));
  const x = Math.max(0, Math.min(persona.width - side, cara.cx * persona.width - side / 2));
  const y = Math.max(0, Math.min(persona.height - side, cara.cy * persona.height - side / 2));
  const c = crop(persona, x, y, side, side);
  const bg = makeRaster(c.width, c.height);
  for (let i = 0; i < bg.data.length; i += 4) { bg.data[i] = 214; bg.data[i + 1] = 206; bg.data[i + 2] = 196; bg.data[i + 3] = 255; }
  drawOver(bg, c, c.width / 2, c.height / 2);
  return resize(bg, 512, 512);
}

/**
 * Variante generada sobre verde croma → persona recortada (PNG transparente), rectángulo de la cara y
 * recorte de la cara para el juez. null si no es PNG o el modelo no respetó el fondo plano.
 */
export async function prepareVariant(url: string): Promise<{ persona: string; faceView: string; cara: FaceRect } | null> {
  const img = await imageBytes(url);
  const raster = await rasterFrom(img?.bytes ?? null);
  if (!raster) return null;
  const { image, report } = chromaCutout(raster);
  if (!report.ok) { console.warn("avatar recorte:", report.motivo, report.bordeVerde.toFixed(2)); return null; }
  const cara = faceRectFromAlpha(image);
  return {
    persona: toDataUrl(await encodePng(image), "image/png"),
    faceView: toDataUrl(await encodePng(faceView(image, cara)), "image/png"),
    cara,
  };
}

/** País del fondo: el que confirmó la persona; si no, el que dice su perfil. */
export async function paisDeFondo(db: SupabaseClient, userId: string, confirmado: string | null | undefined): Promise<string | null> {
  if (confirmado) return confirmado;
  const { data } = await db.from("profiles").select("pais_origen, nationality, ciudad_origen").eq("id", userId).maybeSingle();
  return data ? paisDesdePerfil(data) : null;
}

const asFace = (v: unknown): FaceRect | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number") ? { cx: v[0], cy: v[1], side: v[2] } : null;
const asHand = (v: unknown): HandPoint =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number") ? [v[0], v[1]] : null;

/**
 * Compone fondo + persona + objetos (sin IA, 0 USD), publica cuerpo completo y recorte de cara, y
 * guarda la selección. Si no se pasa algo, usa lo guardado. Lanza error si su avatar no es por capas.
 */
export async function composeAndPublish(
  db: SupabaseClient,
  userId: string,
  opts: { objetos?: string[]; fondoId?: string | null; pais?: string | null } = {},
): Promise<string> {
  const { data: ap } = await db.from("avatar_profiles")
    .select("base_path, capas, pais_fondo, fondo_id, objetos, cara, mano").eq("user_id", userId).maybeSingle();
  if (!ap?.base_path || !ap.capas) throw new Error("sin_capas");
  const pais = opts.pais ?? (await paisDeFondo(db, userId, ap.pais_fondo));
  const fondo = resolverFondo(pais, opts.fondoId !== undefined ? opts.fondoId : ap.fondo_id);
  const objetos = opts.objetos ?? ((ap.objetos as string[] | null) ?? []);
  const persona = await downloadRaster(db, PRIVATE_BUCKET, ap.base_path);
  if (!persona) throw new Error("persona");
  const [fondoR, ...stickers] = await Promise.all([
    fondo ? downloadRaster(db, ASSETS_BUCKET, `fondos/${fondo.id}.png`) : Promise.resolve(null),
    ...objetos.map((id) => downloadRaster(db, ASSETS_BUCKET, `objetos/${id}.png`)),
  ]);
  const out = composeAvatar({
    fondo: fondoR, persona, objetos: stickers.filter((r): r is Raster => !!r),
    cara: asFace(ap.cara), mano: asHand(ap.mano),
  });
  const url = await publishImages(db, userId, { face: pngImg(await encodePng(out.face)), full: pngImg(await encodePng(out.full)) }, {
    visibleKeys: recuerdosDeObjetos(objetos), model: "capas", score: null,
  });
  const patch: Record<string, unknown> = { objetos, fondo_id: fondo?.id ?? null, updated_at: new Date().toISOString() };
  if (opts.pais !== undefined) patch.pais_fondo = opts.pais;
  // Sin país confirmado el fondo sale del perfil y no se guarda (fondo_id exige pais_fondo).
  if (!(opts.pais ?? ap.pais_fondo)) patch.fondo_id = null;
  if (!ap.cara) patch.cara = [out.cara.cx, out.cara.cy, out.cara.side];
  const { error } = await db.from("avatar_profiles").update(patch).eq("user_id", userId);
  if (error) console.warn("avatar_profiles capas:", error.message);
  return url;
}

type SouvenirRow = {
  id: string; souvenir_key: string; prompt: string; slot: SouvenirSlot; status: SouvenirStatus; visible: boolean;
  trip_end: string | null; unlocked_at: string;
};

/** Colección de la persona, de la más vieja a la más nueva (por fin del viaje). */
export async function ownedSouvenirs(db: SupabaseClient, userId: string): Promise<OwnedSouvenir[]> {
  const { data } = await db.from("avatar_souvenirs")
    .select("id, souvenir_key, prompt, slot, status, visible, trip_end, unlocked_at")
    .eq("user_id", userId);
  return ((data ?? []) as SouvenirRow[])
    .sort((a, b) => String(a.trip_end ?? a.unlocked_at).localeCompare(String(b.trip_end ?? b.unlocked_at)))
    .map((r) => ({ key: r.souvenir_key, prompt: r.prompt, slot: r.slot, status: r.status, visible: r.visible }));
}

export async function setVisibleKeys(db: SupabaseClient, userId: string, keys: string[]): Promise<void> {
  await db.from("avatar_souvenirs").update({ visible: false }).eq("user_id", userId).eq("visible", true);
  if (keys.length) {
    await db.from("avatar_souvenirs").update({ visible: true }).eq("user_id", userId).eq("status", "aplicado").in("souvenir_key", keys);
  }
}

/** Dependencias de processTripEvolution para un viaje concreto. */
export function evolutionDeps(db: SupabaseClient, userId: string, tripId: string, fuente: string, opts: { silent?: boolean } = {}): EvolutionDeps {
  const core = coreDeps(db, userId, "evolucion", "avatar-evolve");
  return {
    ...core,
    claim: async (s: Souvenir) => {
      const { data, error } = await db.rpc("avatar_claim_trip", { p_user: userId, p_trip: tripId, p_fuente: fuente, p_souvenir: s });
      if (error) throw new Error(`claim: ${error.message}`);
      return data ? { id: String(data) } : null;
    },
    loadBase: async () => {
      const { data } = await db.from("avatar_profiles").select("base_path").eq("user_id", userId).maybeSingle();
      return data?.base_path ? loadPrivate(db, data.base_path) : null;
    },
    publish: (imageUrl, meta) => publishAvatar(db, userId, imageUrl, meta),
    finish: async (id, patch) => {
      await db.from("avatar_souvenirs").update({
        status: patch.status, ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
        likeness_score: patch.score ?? null, model: patch.model ?? null, error: patch.error ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
    },
    setVisible: (keys) => setVisibleKeys(db, userId, keys),
    loadLayers: async () => {
      const { data } = await db.from("avatar_profiles").select("*").eq("user_id", userId).maybeSingle();
      return data?.capas && data.base_path ? { objetos: (data.objetos as string[] | null) ?? [] } : null;
    },
    publishLayers: (objetos) => composeAndPublish(db, userId, { objetos }),
    notify: async (title, body) => {
      if (opts.silent) return;
      const { error } = await db.rpc("notify_once", {
        p_user_id: userId, p_type: "avatar", p_title: title, p_body: body, p_related_id: tripId,
        p_dedup_key: `avatar-souvenir:${tripId}`,
      });
      if (error) console.warn("notify_once avatar:", error.message);
    },
  };
}

export function runInBackground(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const safe = p.catch((e) => console.error("avatar background:", (e as Error)?.message));
  if (rt?.waitUntil) rt.waitUntil(safe);
}

type TripRow = {
  id: string; destino: string | null; pais_destino: string | null; ciudad_origen: string | null;
  itinerario_json: unknown; vuelos_json: unknown; fecha_salida: string | null; fecha_regreso: string | null; fuente?: string | null;
};

export const TRIP_COLUMNS = "id, user_id, destino, pais_destino, ciudad_origen, itinerario_json, vuelos_json, fecha_salida, fecha_regreso, fuente";

export const tripEnd = (t: { fecha_salida?: string | null; fecha_regreso?: string | null }) => t.fecha_regreso || t.fecha_salida || null;

/**
 * Al estrenar avatar: los recuerdos que se ganaron sin avatar (sin_avatar) y los de viajes pasados
 * sin recuerdo (hasta 12, los más recientes) entran a la colección, y se dibujan los últimos 3 en
 * UNA sola imagen. Sin avisos por viaje (ya se avisó o son viajes viejos).
 */
export async function rebuildWithHistory(db: SupabaseClient, userId: string): Promise<{ ok: boolean; url?: string }> {
  await db.from("avatar_souvenirs").update({ status: "aplicado", updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("status", "sin_avatar");

  const today = new Date().toISOString().slice(0, 10);
  const { data: trips } = await db.from("trips").select(TRIP_COLUMNS).eq("user_id", userId).limit(200);
  const { data: rows } = await db.from("avatar_souvenirs").select("trip_key").eq("user_id", userId);
  const done = new Set((rows ?? []).map((r: { trip_key: string }) => r.trip_key));
  const ended = ((trips ?? []) as TripRow[])
    .filter((t) => { const e = tripEnd(t); return !!e && e < today && !done.has(t.id); })
    .sort((a, b) => String(tripEnd(b)).localeCompare(String(tripEnd(a))))
    .slice(0, 12)
    .reverse();
  for (const t of ended) {
    const owned = await ownedSouvenirs(db, userId);
    const ownedKeys = owned.filter((o) => o.status === "aplicado" || o.status === "sin_avatar").map((o) => o.key);
    const s = resolveSouvenir(t, ownedKeys);
    const { data: id, error } = await db.rpc("avatar_claim_trip", {
      p_user: userId, p_trip: t.id, p_fuente: t.fuente === "documento" ? "documento" : "retroactivo", p_souvenir: s,
    });
    if (error || !id) continue;
    await db.from("avatar_souvenirs").update({
      status: ownedKeys.includes(s.key) ? "repetido" : "aplicado", visible: false, updated_at: new Date().toISOString(),
    }).eq("id", id);
  }

  const { data: ap } = await db.from("avatar_profiles").select("*").eq("user_id", userId).maybeSingle();
  const applied = (await ownedSouvenirs(db, userId)).filter((o) => o.status === "aplicado");
  if (ap?.capas && ap.base_path) {
    // Por capas: sin IA. El primer objeto de cada uno de los últimos 3 recuerdos.
    const objetos = objetosIniciales(applied.map((a) => a.key));
    if (!objetos.length) return { ok: true };
    const url = await composeAndPublish(db, userId, { objetos });
    await setVisibleKeys(db, userId, recuerdosDeObjetos(objetos));
    return { ok: true, url };
  }
  const base = ap?.base_path ? await loadPrivate(db, ap.base_path) : null;
  if (!base) return { ok: false };
  const core = coreDeps(db, userId, "evolucion", "avatar-evolve");
  return rebuildAvatar({
    ...core,
    publish: (imageUrl, meta) => publishAvatar(db, userId, imageUrl, meta),
    setVisible: (keys) => setVisibleKeys(db, userId, keys),
  }, base, applied);
}
