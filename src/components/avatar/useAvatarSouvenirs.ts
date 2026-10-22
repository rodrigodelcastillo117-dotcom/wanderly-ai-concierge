// Colección de recuerdos del avatar (tabla avatar_souvenirs, solo lectura de lo propio).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AVATAR_UPDATED_EVENT } from "@/hooks/useMyAvatar";

export type AvatarSouvenir = {
  id: string;
  trip_id: string | null;
  trip_label: string;
  trip_end: string | null;
  fuente: "fin_de_viaje" | "documento" | "retroactivo";
  souvenir_key: string;
  nombre: string;
  lugar: string;
  emoji: string;
  status: "pendiente" | "aplicado" | "repetido" | "sin_avatar" | "sin_cupo" | "fallido";
  visible: boolean;
  unlocked_at: string;
};

/** Orden de la línea de tiempo: del viaje más reciente al más viejo. Sin filas en proceso o fallidas. */
export function timelineItems(rows: AvatarSouvenir[]): AvatarSouvenir[] {
  return rows
    .filter((r) => r.status === "aplicado" || r.status === "sin_avatar" || r.status === "repetido")
    .sort((a, b) => String(b.trip_end ?? b.unlocked_at).localeCompare(String(a.trip_end ?? a.unlocked_at)));
}

export function useAvatarSouvenirs(): { rows: AvatarSouvenir[]; loading: boolean; available: boolean; reload: () => void } {
  const { user } = useAuth();
  const [rows, setRows] = useState<AvatarSouvenir[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any).from("avatar_souvenirs")
        .select("id, trip_id, trip_label, trip_end, fuente, souvenir_key, nombre, lugar, emoji, status, visible, unlocked_at")
        .eq("user_id", user.id);
      if (cancelled) return;
      setAvailable(!error);
      setRows(error ? [] : ((data ?? []) as AvatarSouvenir[]));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, tick]);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(AVATAR_UPDATED_EVENT, on);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, on);
  }, []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, loading, available, reload };
}
