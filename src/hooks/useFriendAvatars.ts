// Avatar de los amigos con enlace FIRMADO (migración 20261027090000_social_amigos.sql).
//
// amigos_avatares() devuelve la ruta del avatar ACTUAL de cada amigo aceptado que no apagó "Mi avatar";
// el enlace se pide con la sesión de quien mira (la política de storage solo deja firmar a amigos). Así
// también se ve el avatar de quien tiene profiles.avatar_url vacío pero sí tiene avatar (el caso de la "C"
// dorada). Si algo falla, cada pantalla usa la URL que ya traía (o la inicial).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const TTL_S = 3600;
type Entry = { url: string; exp: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();

type Client = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  storage?: { from: (b: string) => { createSignedUrls?: (paths: string[], ttl: number) => PromiseLike<{ data: Array<{ path: string | null; signedUrl: string | null }> | null; error: unknown }> } };
};

const SAFE_PATH = /^avatars\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/;

export async function signFriendAvatars(client: Client, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const now = Date.now();
  const missing = ids.filter((id) => { const c = cache.get(id); if (c && c.exp > now) { out.set(id, c.url); return false; } return true; });
  if (!missing.length) return out;
  try {
    const { data, error } = await client.rpc("amigos_avatares", { p_ids: missing });
    if (error || !Array.isArray(data)) return out;
    const rows = (data as Array<{ id?: unknown; path?: unknown }>)
      .filter((r) => typeof r?.id === "string" && typeof r?.path === "string" && SAFE_PATH.test(r.path as string) && !(r.path as string).includes(".."));
    const signer = client.storage?.from("travel-moments")?.createSignedUrls;
    if (!rows.length || !signer) return out;
    const { data: signed } = await client.storage!.from("travel-moments").createSignedUrls!(rows.map((r) => r.path as string), TTL_S);
    for (const s of signed ?? []) {
      const row = rows.find((r) => r.path === s.path);
      if (!row || !s.signedUrl) continue;
      let url = s.signedUrl;
      try { url = new URL(s.signedUrl).protocol === "https:" ? s.signedUrl : ""; } catch { url = ""; }
      if (!url) continue;
      cache.set(row.id as string, { url, exp: now + (TTL_S - 300) * 1000 });
      out.set(row.id as string, url);
    }
  } catch { /* sin avatar firmado: se usa lo que ya había */ }
  return out;
}

export function __resetFriendAvatars() { cache.clear(); inflight.clear(); }

/** Mapa amigo → enlace firmado de su avatar (solo los que se pudieron firmar). */
export function useFriendAvatars(ids: string[]): Map<string, string> {
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [map, setMap] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const list = key.split(",");
    let p = inflight.get(key);
    let result: Map<string, string> | null = null;
    if (!p) {
      p = signFriendAvatars(supabase as unknown as Client, list).then((m) => { result = m; });
      inflight.set(key, p);
      p.finally(() => inflight.delete(key));
    }
    p.then(() => {
      if (!alive) return;
      const now = Date.now();
      const m = new Map<string, string>();
      for (const id of list) { const c = cache.get(id); if (c && c.exp > now) m.set(id, c.url); }
      if (result) for (const [k, v] of result) m.set(k, v);
      setMap(m);
    });
    return () => { alive = false; };
  }, [key]);
  return map;
}

const PRIVATE_MOMENT = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;
const momentCache = new Map<string, Entry>();

/**
 * Fotos de momentos (travel-moments-private) con enlace firmado: los propios (política de la persona) o
 * los que un amigo marcó compartibles (política social_amigos_momento_select).
 */
export function useSignedMoments(paths: string[]): Map<string, string> {
  const key = useMemo(() => [...new Set(paths.filter((p) => PRIVATE_MOMENT.test(p)))].sort().join(","), [paths]);
  const [map, setMap] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const list = key.split(",");
    const now = Date.now();
    const out = new Map<string, string>();
    const missing = list.filter((p) => { const c = momentCache.get(p); if (c && c.exp > now) { out.set(p, c.url); return false; } return true; });
    (async () => {
      try {
        const bucket = (supabase as unknown as Client).storage?.from("travel-moments-private");
        if (missing.length && bucket?.createSignedUrls) {
          const { data } = await bucket.createSignedUrls(missing, TTL_S);
          for (const s of data ?? []) {
            if (!s.path || !s.signedUrl || !/^https:\/\//.test(s.signedUrl)) continue;
            momentCache.set(s.path, { url: s.signedUrl, exp: now + (TTL_S - 300) * 1000 });
            out.set(s.path, s.signedUrl);
          }
        }
      } catch { /* sin foto: la tarjeta usa la ilustrativa */ }
      if (alive) setMap(out);
    })();
    return () => { alive = false; };
  }, [key]);
  return map;
}
