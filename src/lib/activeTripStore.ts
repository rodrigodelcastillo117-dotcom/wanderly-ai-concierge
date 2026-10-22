// Viaje activo (profiles.active_trip_id) para las pantallas fuera del chat. La lectura/escritura
// tolerante es la de profileActiveTrip.ts (N-03: si la columna aún no existe en producción, el
// primer error se calla y no se vuelve a consultar en la sesión); aquí se suma la elección local,
// con la misma llave que usa el Concierge, para que todas las pantallas coincidan sin la columna.
import { readPinnedTrip, savePinnedTrip } from "@/lib/profileActiveTrip";

export const ACTIVE_TRIP_LOCAL_KEY = "iatos_concierge_trip";

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

/** Viaje fijado. Nunca lanza: sin columna o sin red, la elección local (o null). */
export async function fetchPinnedTripId(userId: string): Promise<PinnedRead> {
  const v = await readPinnedTrip(userId);
  if (v === undefined) return { id: readLocalPin(), source: "local" };
  writeLocalPin(v);
  return { id: v, source: "profile" };
}

export type PinResult = { ok: boolean; forbidden?: boolean; message?: string };

/** Fija (o quita, con null) el viaje activo: siempre en el dispositivo y en el perfil si se puede. */
export async function savePinnedTripId(userId: string, id: string | null): Promise<PinResult> {
  writeLocalPin(id);
  const code = await savePinnedTrip(userId, id);
  if (!code) return { ok: true };
  // 42501: el trigger profiles_guard_active_trip rechazó un viaje sin acceso.
  if (code === "42501") return { ok: false, forbidden: true, message: "No tienes acceso a ese viaje" };
  return { ok: false, message: code };
}
