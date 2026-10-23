// Estado del avatar por capas (fondo de su país + recuerdos visibles). Lee del servidor (avatar-capas,
// que firma la persona recortada del bucket privado) y de avatar_assets (qué imágenes del inventario ya
// existen). Guardar no usa IA: el servidor compone y publica el PNG.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { notifyAvatarUpdated, AVATAR_UPDATED_EVENT } from "@/hooks/useMyAvatar";
import { ASSETS_BUCKET } from "../../../supabase/functions/_shared/avatar-inventory.ts";
import type { FaceRect, HandPoint } from "../../../supabase/functions/_shared/avatar-layers.ts";

export type LayersState = {
  capas: boolean;
  pais: string | null;
  paisSugerido: string | null;
  fondoId: string | null;
  objetos: string[];
  recuerdos: string[];
  personaUrl: string | null;
  cara: FaceRect | null;
  mano: HandPoint;
  cuerpoUrl: string | null;
};

/** URL pública de un asset del inventario (con versión = huella del prompt, para la caché). */
export function assetUrl(path: string, version: string): string {
  const base = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
  return `${base}?v=${encodeURIComponent(version)}`;
}

/** Respuesta de "estado" → estado tipado (tolerante a campos ausentes). */
export function parseLayersState(d: unknown): LayersState | null {
  const o = d as Record<string, unknown> | null;
  if (!o || o.ok !== true) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const nums = (v: unknown, n: number) => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number") ? (v as number[]) : null);
  const c = nums(o.cara, 3);
  const m = nums(o.mano, 2);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    capas: o.capas === true,
    pais: str(o.pais),
    paisSugerido: str(o.pais_sugerido),
    fondoId: str(o.fondo_id),
    objetos: arr(o.objetos),
    recuerdos: arr(o.recuerdos),
    personaUrl: str(o.persona_url),
    cara: c ? { cx: c[0], cy: c[1], side: c[2] } : null,
    mano: m ? [m[0], m[1]] : null,
    cuerpoUrl: str(o.cuerpo_url),
  };
}

export function useAvatarLayers(enabled: boolean) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [state, setState] = useState<LayersState | null>(null);
  const [assets, setAssets] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid || !enabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const [estado, rows] = await Promise.all([
        supabase.functions.invoke("avatar-capas", { body: { action: "estado" } }),
        (supabase as any).from("avatar_assets").select("id, prompt_hash"),
      ]);
      if (cancelled) return;
      setState(estado.error ? null : parseLayersState(estado.data));
      const map = new Map<string, string>();
      for (const r of ((rows?.error ? [] : rows?.data) ?? []) as Array<{ id: string; prompt_hash: string }>) map.set(r.id, r.prompt_hash);
      setAssets(map);
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid, enabled, tick]);

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(AVATAR_UPDATED_EVENT, on);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, on);
  }, []);

  /** Guarda país, fondo u objetos. Regresa un mensaje de error o null. */
  const save = useCallback(async (patch: { pais?: string; fondo_id?: string | null; objetos?: string[] }): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke("avatar-capas", { body: { action: "guardar", ...patch } });
    if (error || !(data as { ok?: boolean } | null)?.ok) return (data as { error?: string } | null)?.error ?? "No pudimos guardar tu elección. Intenta de nuevo.";
    const url = (data as { url?: string | null }).url ?? null;
    notifyAvatarUpdated(url);
    if (!url) setTick((t) => t + 1);
    return null;
  }, []);

  return { state, assets, loading, save, reload: () => setTick((t) => t + 1) };
}
