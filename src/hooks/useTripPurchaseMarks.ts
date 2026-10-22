// "Ya lo reservé" compartido (r2 grupo): carga las marcas del viaje para todos sus miembros, marca y
// quita. Con la tabla trip_purchase_marks (modo "grupo") todos ven quién marcó qué y cuándo; si la tabla
// aún no existe o no responde (modo "propio"), se comporta como antes: solo las marcas propias en bookings.
// Las marcas propias hechas con la versión anterior (solo en bookings) se copian al grupo sin perder nada.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { markRow, type PurchaseItem, type PurchaseMarkRow } from "@/lib/purchasePlan";
import {
  MARKS_COLUMNS, marksFromBookings, marksFromGroup, pendingGroupCopies, type GroupMark, type TripPurchaseMarkRow,
} from "@/lib/purchaseMarks";

export type MarksMode = "cargando" | "grupo" | "propio";
export type MarkResult = { ok: boolean; reason?: "sin_sesion" | "error" | "no_permitido" };

type TripLike = { id: string; user_id?: string | null; destino?: string | null; fecha_salida?: string | null };

const BOOKING_COLUMNS = "id, user_id, trip_id, category, status, confirmation_code, partner_reference, title, subtitle, raw_payload, created_at";

// Las llamadas a la base pueden fallar de forma síncrona (cliente sin ese método en pruebas, red caída):
// todo lo que no sea una respuesta buena cuenta como error.
async function safe<T>(fn: () => PromiseLike<T> | T): Promise<T | { data: null; error: unknown }> {
  try { return await fn(); } catch (e) { return { data: null, error: e ?? "error" }; }
}

export function useTripPurchaseMarks({ trip, userId, bookings }: { trip: TripLike; userId: string | null; bookings: PurchaseMarkRow[] }) {
  const tripId = trip?.id ?? null;
  const [mode, setMode] = useState<MarksMode>("cargando");
  const [group, setGroup] = useState<TripPurchaseMarkRow[]>([]);
  // Cambios locales de bookings mientras la página no recarga (y si la base no responde, no se finge).
  const [localRows, setLocalRows] = useState<PurchaseMarkRow[] | null>(null);
  useEffect(() => { setLocalRows(null); }, [bookings]);
  const rows = localRows ?? bookings;
  const copied = useRef<Set<string>>(new Set());

  const load = useCallback(async (): Promise<boolean> => {
    if (!tripId) return false;
    const res: any = await safe(() => supabase.from("trip_purchase_marks").select(MARKS_COLUMNS).eq("trip_id", tripId));
    if (res?.error || !Array.isArray(res?.data)) { setMode("propio"); return false; }
    setGroup(res.data as TripPurchaseMarkRow[]);
    setMode("grupo");
    return true;
  }, [tripId]);

  useEffect(() => {
    setMode("cargando"); setGroup([]); copied.current = new Set();
    void load();
  }, [load]);

  // Al volver a la pestaña se recargan: así se ve lo que otro miembro marcó mientras tanto.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => { if (document.visibilityState === "visible" && mode === "grupo") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, mode]);

  const groupMap = useMemo(() => marksFromGroup(group), [group]);

  // Copia suave: marcas propias que solo están en bookings pasan al grupo (una vez por elemento).
  useEffect(() => {
    if (mode !== "grupo" || !tripId || !userId) return;
    const todo = pendingGroupCopies(rows, groupMap, userId).filter((c) => !copied.current.has(c.item_key));
    if (!todo.length) return;
    todo.forEach((c) => copied.current.add(c.item_key));
    void (async () => {
      const res: any = await safe(() => supabase.from("trip_purchase_marks")
        .upsert(todo.map((c) => ({ trip_id: tripId, item_key: c.item_key, category: c.category, marked_by: userId })),
          { onConflict: "trip_id,item_key", ignoreDuplicates: true }));
      if (!res?.error) await load();
    })();
  }, [mode, tripId, userId, rows, groupMap, load]);

  const marks: Map<string, GroupMark> = useMemo(() => {
    if (mode === "grupo") return groupMap;
    return marksFromBookings(rows, userId);
  }, [mode, groupMap, rows, userId]);

  const mark = useCallback(async (item: PurchaseItem): Promise<MarkResult> => {
    if (!userId || !tripId) return { ok: false, reason: "sin_sesion" };
    // 1) La constancia personal en bookings (pending: lo marcó el usuario, sin verificar), como antes.
    const res: any = await safe(() => supabase.from("bookings").insert(markRow(item, trip, userId) as any).select(BOOKING_COLUMNS).single());
    if (res?.error || !res?.data) return { ok: false, reason: "error" };
    setLocalRows([...(rows ?? []), res.data as PurchaseMarkRow]);
    if (mode === "propio") return { ok: true };
    // 2) La marca del grupo. Si alguien ya lo marcó, se queda la suya (una por elemento).
    copied.current.add(item.key);
    const up: any = await safe(() => supabase.from("trip_purchase_marks")
      .upsert({ trip_id: tripId, item_key: item.key, category: item.category, marked_by: userId }, { onConflict: "trip_id,item_key", ignoreDuplicates: true }));
    if (up?.error) { setMode("propio"); return { ok: true }; }
    await load();
    return { ok: true };
  }, [userId, tripId, trip, rows, mode, load]);

  const unmark = useCallback(async (item: PurchaseItem): Promise<MarkResult> => {
    const mk = marks.get(item.key);
    if (!mk?.id) return { ok: false, reason: "error" };
    if (mk.source === "grupo") {
      // La base deja quitarla solo a quien la puso o al dueño; también borra la constancia "marcado a mano"
      // de quien la puso (si no, su app la volvería a copiar).
      const res: any = await safe(() => supabase.from("trip_purchase_marks").delete().eq("id", mk.id).select("id"));
      if (res?.error) return { ok: false, reason: "error" };
      if (!Array.isArray(res?.data) || res.data.length === 0) return { ok: false, reason: "no_permitido" };
      if (mk.markedBy === userId) setLocalRows((rows ?? []).filter((r) => r?.raw_payload?.compra_item !== item.key || r.status !== "pending"));
      await load();
      return { ok: true };
    }
    const res: any = await safe(() => supabase.from("bookings").delete().eq("id", mk.id));
    if (res?.error) return { ok: false, reason: "error" };
    setLocalRows((rows ?? []).filter((x) => x.id !== mk.id));
    return { ok: true };
  }, [marks, rows, userId, load]);

  return { mode, rows, marks, mark, unmark, reload: load };
}
