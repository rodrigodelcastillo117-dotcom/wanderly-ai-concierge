// T-P2-2: fotos que ya estaban subidas antes de la corrección. NO se corre sola: requiere
// autorización (usa la llave de servicio de producción). Por omisión solo cuenta (sin cambios).
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx vite-node scripts/privacidad/migrar_fotos_privadas.ts [--apply]
//
// 1) "Mejores momentos" viejos (travel-moments, PÚBLICO): se descarga cada foto, se le quitan EXIF/GPS
//    (misma función que la Bóveda), se sube a travel-moments-private/{uid}/{uuid}.jpg, la fila queda
//    con image_path (image_url = null) y se borra la copia pública.
// 2) Diario (journal-photos, ya PRIVADO por la migración 20261026120000): cada JPEG con metadatos se
//    reescribe limpio en la misma ruta.
// Lo que no es JPEG (PNG/WEBP/HEIC/GIF) no se puede reescribir sin un navegador: se cuenta y se
// reporta para revisión manual. No imprime rutas, nombres ni ids: solo conteos.
import { createClient } from "@supabase/supabase-js";
import { isJpeg, jpegHasMetadata, stripJpegMetadata } from "@/lib/boveda/files";

const APPLY = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) { console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const count: Record<string, number> = {};
const inc = (k: string) => { count[k] = (count[k] ?? 0) + 1; };

function publicPath(u: string | null, bucket: string): string | null {
  const i = (u ?? "").indexOf(`/${bucket}/`);
  if (i < 0) return null;
  return decodeURIComponent((u as string).slice(i + bucket.length + 2).split(/[?#]/)[0]) || null;
}

async function bytes(bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
}

async function moments() {
  for (;;) {
    const { data, error } = await db.from("travel_moments").select("id, user_id, image_url")
      .is("image_path", null).like("image_url", "%/travel-moments/%").limit(100);
    if (error) throw new Error(error.message);
    if (!data?.length) return;
    let progressed = 0;
    for (const m of data as Array<{ id: string; user_id: string; image_url: string }>) {
      const path = publicPath(m.image_url, "travel-moments");
      if (!path || !path.startsWith(`${m.user_id}/`)) { inc("momentos_ruta_ajena"); continue; }
      const src = await bytes("travel-moments", path);
      if (!src) { inc("momentos_sin_archivo"); continue; }
      if (!isJpeg(src)) { inc("momentos_no_jpeg_revision_manual"); continue; }
      inc("momentos_a_mover");
      if (!APPLY) continue;
      const dest = `${m.user_id}/${crypto.randomUUID()}.jpg`;
      const up = await db.storage.from("travel-moments-private").upload(dest, stripJpegMetadata(src), { contentType: "image/jpeg", upsert: false });
      if (up.error) { inc("momentos_error_subida"); continue; }
      const { error: rowErr } = await db.from("travel_moments").update({ image_path: dest, image_url: null }).eq("id", m.id);
      if (rowErr) { await db.storage.from("travel-moments-private").remove([dest]); inc("momentos_error_fila"); continue; }
      await db.storage.from("travel-moments").remove([path]);
      inc("momentos_movidos");
      progressed++;
    }
    if (!APPLY || progressed === 0) return; // en modo conteo (o sin avance) basta una pasada
  }
}

async function journal() {
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("trip_journal_entries").select("photo_path")
      .not("photo_path", "is", null).order("created_at").range(from, from + 499);
    if (error) throw new Error(error.message);
    if (!data?.length) return;
    for (const e of data as Array<{ photo_path: string }>) {
      const src = await bytes("journal-photos", e.photo_path);
      if (!src) { inc("diario_sin_archivo"); continue; }
      if (!isJpeg(src)) { inc("diario_no_jpeg_revision_manual"); continue; }
      if (!jpegHasMetadata(src)) { inc("diario_ya_limpias"); continue; }
      inc("diario_a_limpiar");
      if (!APPLY) continue;
      const up = await db.storage.from("journal-photos").update(e.photo_path, stripJpegMetadata(src), { contentType: "image/jpeg", upsert: true });
      inc(up.error ? "diario_error" : "diario_limpiadas");
    }
  }
}

await moments();
await journal();
console.log(JSON.stringify({ modo: APPLY ? "aplicado" : "solo_conteo", ...count }, null, 2));
