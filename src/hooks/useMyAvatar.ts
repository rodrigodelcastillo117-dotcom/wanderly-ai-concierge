// Avatar de la persona: UNA sola fuente para toda la app (encabezado del perfil, menú lateral,
// barra móvil, tarjeta del Travel DNA). Antes cada pantalla leía de un lugar distinto
// (profiles.avatar_url vs ai_user_preferences.perfil_ia.avatar_url) y el perfil mostraba la "R"
// mientras la tarjeta del DNA mostraba la imagen.
//
// Fuente: profiles.avatar_url (la escribe el servidor al elegir/evolucionar el avatar; Social la lee
// para los amigos). perfil_ia.avatar_url solo como respaldo para cuentas que aún no pasan por la
// migración 20261024200000 (que copia ese valor a profiles).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invalidateProfileBasics, loadProfileBasics } from "@/lib/profileBasics";

export const AVATAR_UPDATED_EVENT = "iatos:avatar-updated";

export function pickAvatarUrl(profileUrl: unknown, perfilIa: unknown): string | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v.trim());
  if (ok(profileUrl)) return profileUrl.trim();
  const legacy = (perfilIa as { avatar_url?: unknown } | null)?.avatar_url;
  return ok(legacy) ? legacy.trim() : null;
}

const cache = new Map<string, Promise<string | null>>();

async function load(uid: string): Promise<string | null> {
  // profiles.avatar_url sale de la misma consulta que el nombre (profileBasics: una sola a profiles al
  // entrar). perfil_ia solo se pide si profiles no trae avatar (cuentas viejas), no en cada carga.
  const prof = await loadProfileBasics(uid);
  const direct = pickAvatarUrl(prof?.avatar_url, null);
  if (direct) return direct;
  const { data: prefs } = await supabase.from("ai_user_preferences").select("perfil_ia").eq("user_id", uid).maybeSingle();
  return pickAvatarUrl(null, prefs?.perfil_ia ?? null);
}

/** Avisa a todas las pantallas que el avatar cambió (tras elegir una variante o evolucionar). */
export function notifyAvatarUpdated(url: string | null): void {
  cache.clear();
  invalidateProfileBasics();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT, { detail: { url } }));
}

export function useMyAvatar(): { url: string | null; loading: boolean; refresh: () => void } {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    let cancelled = false;
    let p = cache.get(uid);
    if (!p) { p = load(uid).catch(() => null); cache.set(uid, p); }
    p.then((u) => { if (!cancelled) { setUrl(u); setLoading(false); } });
    return () => { cancelled = true; };
  }, [uid, tick]);

  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<{ url: string | null }>).detail?.url;
      if (next) setUrl(next); else setTick((t) => t + 1);
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, on);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, on);
  }, []);

  const refresh = useCallback(() => { if (uid) cache.delete(uid); invalidateProfileBasics(); setTick((t) => t + 1); }, [uid]);
  return { url, loading, refresh };
}
