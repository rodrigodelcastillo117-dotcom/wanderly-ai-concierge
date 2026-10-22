// Respaldo de la tarea programada: al abrir el perfil, si un viaje terminó hace poco (≤ 45 días) y
// aún no dio su recuerdo, se pide a avatar-evolve (idempotente por viaje en el servidor). Una vez
// por sesión y por persona, para no gastar.
import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { localISODate } from "@/lib/localDate";
import { notifyAvatarUpdated } from "@/hooks/useMyAvatar";

const KEY = "iatos_avatar_evolve_checked";

export function pickTripToEvolve(
  trips: Array<{ id: string; fecha_salida?: string | null; fecha_regreso?: string | null }>,
  doneTripKeys: Set<string>,
  today: string,
  windowDays = 45,
): string | null {
  const min = new Date(Date.parse(`${today}T00:00:00Z`) - windowDays * 86400000).toISOString().slice(0, 10);
  const ended = trips
    .map((t) => ({ id: t.id, end: t.fecha_regreso || t.fecha_salida || null }))
    .filter((t): t is { id: string; end: string } => !!t.end && t.end < today && t.end >= min && !doneTripKeys.has(t.id))
    .sort((a, b) => b.end.localeCompare(a.end));
  return ended[0]?.id ?? null;
}

export function useAutoEvolveAvatar(hasAvatar: boolean): void {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !hasAvatar) return;
    try {
      if (sessionStorage.getItem(KEY) === user.id) return;
      sessionStorage.setItem(KEY, user.id);
    } catch { /* sin almacenamiento: se intenta igual */ }
    let cancelled = false;
    (async () => {
      const today = localISODate();
      const [{ data: trips }, souv] = await Promise.all([
        supabase.from("trips").select("id, fecha_salida, fecha_regreso").eq("user_id", user.id).lt("fecha_salida", today).limit(50),
        (supabase as any).from("avatar_souvenirs").select("trip_key").eq("user_id", user.id),
      ]);
      if (cancelled || souv?.error) return; // tabla aún no creada en este ambiente
      const done = new Set<string>(((souv?.data ?? []) as Array<{ trip_key: string }>).map((r) => r.trip_key));
      const tripId = pickTripToEvolve((trips ?? []) as any[], done, today);
      if (!tripId) return;
      const { data } = await supabase.functions.invoke("avatar-evolve", { body: { trip_id: tripId } });
      if (cancelled || !data?.ok) return;
      if (data.status === "aplicado" && data.souvenir) {
        if (data.url) notifyAvatarUpdated(data.url);
        else notifyAvatarUpdated(null);
        toast.success(`Tu avatar ganó un detalle de ${data.souvenir.lugar} ${data.souvenir.emoji ?? ""}`.trim());
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [user, hasAvatar]);
}
