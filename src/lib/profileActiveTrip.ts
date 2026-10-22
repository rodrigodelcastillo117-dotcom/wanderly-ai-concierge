// Lectura/guardado tolerante de profiles.active_trip_id (N-03).
//
// Por qué: la columna llega con la migración 20261022131000_active_trip_and_fixer_status.sql. Si
// el frontend se publica antes que la migración, PostgREST responde 400 y el Concierge lo repetía
// cada minuto (auto-refresh) y en cada cambio de viaje. Tras el primer error dejamos de consultar
// en lo que resta de la sesión y el Concierge sigue con la elección local (localStorage).
import { supabase } from "@/integrations/supabase/client";

let unavailable = false;

/** Códigos de "la columna no existe" (Postgres 42703 y caché de esquema de PostgREST). */
const isMissingColumn = (code?: string | null) => code === "42703" || code === "PGRST204";

export function activeTripColumnUnavailable() {
  return unavailable;
}

/** Solo para pruebas. */
export function __resetActiveTripColumn() {
  unavailable = false;
}

/** undefined = no se pudo leer (usar la elección local); null = Iato decide; string = viaje fijado. */
export async function readPinnedTrip(userId: string): Promise<string | null | undefined> {
  if (unavailable) return undefined;
  try {
    const { data, error } = await supabase.from("profiles").select("active_trip_id").eq("id", userId).maybeSingle();
    if (error) {
      unavailable = true;
      return undefined;
    }
    if (!data) return undefined;
    return ((data as { active_trip_id?: string | null }).active_trip_id ?? null);
  } catch {
    unavailable = true;
    return undefined;
  }
}

/**
 * Guarda el viaje fijado. Devuelve el código de error que la pantalla debe explicar (p. ej. 42501:
 * el viaje no es tuyo), o null si se guardó o si la columna no existe (silencioso).
 */
export async function savePinnedTrip(userId: string, tripId: string | null): Promise<string | null> {
  if (unavailable) return null;
  try {
    const { error } = await supabase.from("profiles").update({ active_trip_id: tripId }).eq("id", userId);
    if (!error) return null;
    if (isMissingColumn(error.code)) {
      unavailable = true;
      return null;
    }
    return error.code ?? "unknown";
  } catch {
    return null;
  }
}
