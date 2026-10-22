// "Borrar mi avatar" (T-P2-5): lo que promete el Aviso de Privacidad (Legal.tsx). Lógica pura (Vitest);
// la conexión con Supabase está en generate-avatar (acción "eliminar", llave de servicio).
//
// Borra:
//   · storage: la copia PÚBLICA (travel-moments/avatars/{uid}/…) y lo PRIVADO (avatar-private/{uid}/…:
//     imagen base y variantes), listando las carpetas además de las rutas que guardan las tablas;
//   · base de datos: profiles.avatar_url = NULL, avatar_profiles, avatar_variants, avatar_souvenirs
//     (los recuerdos dibujados en el avatar) y las llaves avatar_url/avatar_meta de perfil_ia.
// No toca el cupo diario (avatar_image_usage): no guarda imágenes y evita regenerar sin límite.

export const AVATAR_PUBLIC_BUCKET = "travel-moments";
export const AVATAR_PRIVATE_BUCKET = "avatar-private";

export type AvatarDeleteDeps = {
  /** Rutas guardadas en avatar_profiles (current_path, base_path) y avatar_variants (storage_path). */
  knownPaths: (userId: string) => Promise<{ public: string[]; private: string[] }>;
  /** Archivos (no carpetas) directamente dentro de `prefix` en el bucket. */
  list: (bucket: string, prefix: string) => Promise<{ files: string[]; folders: string[] }>;
  remove: (bucket: string, paths: string[]) => Promise<{ error: string | null }>;
  /** profiles.avatar_url = NULL y borra avatar_profiles/avatar_variants/avatar_souvenirs y perfil_ia.avatar_*. */
  clearRows: (userId: string) => Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La ruta es del avatar de esa persona (nunca se borra nada fuera de sus carpetas). */
export function ownsAvatarPath(bucket: string, path: string, userId: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/") || path.includes("//")) return false;
  if (bucket === AVATAR_PUBLIC_BUCKET) return path.startsWith(`avatars/${userId}/`);
  if (bucket === AVATAR_PRIVATE_BUCKET) return path.startsWith(`${userId}/`);
  return false;
}

async function collect(deps: AvatarDeleteDeps, bucket: string, prefix: string, depth: number, out: Set<string>): Promise<void> {
  const { files, folders } = await deps.list(bucket, prefix);
  for (const f of files) out.add(`${prefix}/${f}`);
  if (depth <= 0) return;
  for (const d of folders) await collect(deps, bucket, `${prefix}/${d}`, depth - 1, out);
}

export type AvatarDeleteResult = { ok: boolean; removed: number; error?: string };

export async function deleteAvatar(deps: AvatarDeleteDeps, userId: string): Promise<AvatarDeleteResult> {
  if (!UUID.test(userId)) return { ok: false, removed: 0, error: "usuario_invalido" };
  const known = await deps.knownPaths(userId);
  const pub = new Set(known.public);
  const priv = new Set(known.private);
  await collect(deps, AVATAR_PUBLIC_BUCKET, `avatars/${userId}`, 1, pub);
  await collect(deps, AVATAR_PRIVATE_BUCKET, userId, 2, priv);

  let removed = 0;
  for (const [bucket, set] of [[AVATAR_PUBLIC_BUCKET, pub], [AVATAR_PRIVATE_BUCKET, priv]] as const) {
    const paths = [...set].filter((p) => ownsAvatarPath(bucket, p, userId));
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await deps.remove(bucket, chunk);
      // Si storage falla no se limpian las filas: la persona puede reintentar y nada queda a medias.
      if (error) return { ok: false, removed, error: "storage" };
      removed += chunk.length;
    }
  }
  await deps.clearRows(userId);
  return { ok: true, removed };
}
