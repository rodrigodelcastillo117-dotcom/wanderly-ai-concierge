// Nombre y avatar de la persona (profiles.full_name, profiles.avatar_url) en UNA consulta.
//
// Al entrar al inicio se pedía profiles tres veces a la vez (full_name desde el inicio, full_name
// desde el menú y avatar_url desde useMyAvatar) — E2E 28-oct-2026. Ahora las pantallas montadas a la
// vez comparten una sola petición. Al iniciar sesión, /auth la "calienta" (warmProfileBasics) mientras
// decide a dónde ir, y el inicio la encuentra lista unos segundos.
// profiles.active_trip_id sigue aparte (profileActiveTrip.ts): su lectura tolera que falte la columna.
import { supabase } from "@/integrations/supabase/client";

export type ProfileBasics = { full_name: string | null; avatar_url: string | null };

const inflight = new Map<string, Promise<ProfileBasics | null>>();
/** Solo lo que calentó /auth al iniciar sesión, y por poco tiempo (no es una caché de la sesión). */
const warm = new Map<string, { at: number; p: Promise<ProfileBasics | null> }>();
const WARM_MS = 15_000;

async function fetchBasics(uid: string): Promise<ProfileBasics | null> {
  try {
    const { data, error } = await supabase.from("profiles").select("full_name, avatar_url").eq("id", uid).maybeSingle();
    if (error || !data) return null;
    const row = data as { full_name?: unknown; avatar_url?: unknown };
    return {
      full_name: typeof row.full_name === "string" ? row.full_name : null,
      avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null,
    };
  } catch {
    return null;
  }
}

/** Nombre y avatar. Nunca lanza (null si no se pudo leer). Peticiones simultáneas comparten una. */
export function loadProfileBasics(uid: string): Promise<ProfileBasics | null> {
  const w = warm.get(uid);
  if (w && Date.now() - w.at < WARM_MS) return w.p;
  if (w) warm.delete(uid);
  let p = inflight.get(uid);
  if (!p) {
    p = fetchBasics(uid).finally(() => inflight.delete(uid));
    inflight.set(uid, p);
  }
  return p;
}

/** /auth, al iniciar sesión: se pide ya, en paralelo con la decisión de a dónde ir. */
export function warmProfileBasics(uid: string): void {
  if (warm.has(uid) && Date.now() - warm.get(uid)!.at < WARM_MS) return;
  warm.set(uid, { at: Date.now(), p: loadProfileBasics(uid) });
}

/** Cambió el nombre o el avatar: la próxima lectura va al servidor. También para pruebas. */
export function invalidateProfileBasics(): void {
  warm.clear();
  inflight.clear();
}
