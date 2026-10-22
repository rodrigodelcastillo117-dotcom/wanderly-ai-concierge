// Lectura y escritura del viaje activo (profiles.active_trip_id) para todas las pantallas.
//
// La columna llega con la migración 20261022131000. Mientras no esté aplicada en producción, el
// SELECT responde 400 (columna inexistente): aquí se atrapa el error y se usa la elección guardada
// en este dispositivo, sin romper la pantalla. El Concierge ya usaba la misma llave local.

export const ACTIVE_TRIP_LOCAL_KEY = "iatos_concierge_trip";

type MinimalClient = { from: (table: string) => any };

export function readLocalPin(): string | null {
  try { return localStorage.getItem(ACTIVE_TRIP_LOCAL_KEY) || null; } catch { return null; }
}

export function writeLocalPin(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_TRIP_LOCAL_KEY, id);
    else localStorage.removeItem(ACTIVE_TRIP_LOCAL_KEY);
  } catch { /* modo privado */ }
}

export type PinnedRead = { id: string | null; source: "profile" | "local" };

/**
 * Viaje fijado por el usuario. Nunca lanza: si la columna no existe o la red falla, devuelve la
 * elección local (o null).
 */
export async function fetchPinnedTripId(client: MinimalClient, userId: string): Promise<PinnedRead> {
  try {
    const { data, error } = await client.from("profiles").select("active_trip_id").eq("id", userId).maybeSingle();
    if (error || !data) return { id: readLocalPin(), source: "local" };
    const id = (data as { active_trip_id?: string | null }).active_trip_id ?? null;
    writeLocalPin(id);
    return { id, source: "profile" };
  } catch {
    return { id: readLocalPin(), source: "local" };
  }
}

export type PinResult = { ok: boolean; forbidden?: boolean; message?: string };

/** Fija (o quita, con null) el viaje activo. Se guarda local siempre y en el perfil si se puede. */
export async function savePinnedTripId(client: MinimalClient, userId: string, id: string | null): Promise<PinResult> {
  writeLocalPin(id);
  try {
    const { error } = await client.from("profiles").update({ active_trip_id: id }).eq("id", userId);
    if (!error) return { ok: true };
    // 42501: el trigger profiles_guard_active_trip rechazó un viaje sin acceso.
    if (error.code === "42501") return { ok: false, forbidden: true, message: "No tienes acceso a ese viaje" };
    return { ok: false, message: error.message };
  } catch (e) {
    return { ok: false, message: (e as Error)?.message };
  }
}
