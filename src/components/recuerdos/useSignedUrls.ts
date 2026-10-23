// Enlaces firmados (1 h) bajo demanda: se piden solo las fotos que se van a ver (mes, álbum o visor),
// en lote, sin repetir, y se vuelven a pedir pasados 50 minutos.
import { useCallback, useEffect, useRef, useState } from "react";
import { signItems, type RecuerdosClient } from "@/lib/recuerdos/api";

const FRESH_MS = 50 * 60 * 1000;
export type Wanted = { bucket: string; path: string | null | undefined };
export const urlKey = (bucket: string, path: string) => `${bucket}|${path}`;

export function useSignedUrls(client: RecuerdosClient) {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const at = useRef(new Map<string, number>());
  const pending = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const request = useCallback((wanted: Wanted[]) => {
    const now = Date.now();
    const need = wanted
      .filter((w): w is { bucket: string; path: string } => !!w.path)
      .filter((w) => {
        const k = urlKey(w.bucket, w.path);
        const t = at.current.get(k);
        return !pending.current.has(k) && (t == null || now - t > FRESH_MS);
      });
    const uniq = [...new Map(need.map((w) => [urlKey(w.bucket, w.path), w])).values()];
    if (!uniq.length) return;
    uniq.forEach((w) => pending.current.add(urlKey(w.bucket, w.path)));
    void signItems(client, uniq).then((got) => {
      uniq.forEach((w) => pending.current.delete(urlKey(w.bucket, w.path)));
      if (!alive.current) return;
      const t = Date.now();
      got.forEach((_, k) => at.current.set(k, t));
      setUrls((prev) => { const next = new Map(prev); got.forEach((v, k) => next.set(k, v)); return next; });
    });
  }, [client]);

  const get = useCallback((bucket: string, path: string | null | undefined) => (path ? urls.get(urlKey(bucket, path)) ?? null : null), [urls]);
  return { request, get };
}
