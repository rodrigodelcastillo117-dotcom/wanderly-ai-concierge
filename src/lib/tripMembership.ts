// Borrar un viaje propio o salir de uno compartido, diciendo la verdad sobre el resultado.
//
// Por qué: RLS solo deja borrar viajes al dueño. Un DELETE bloqueado por RLS no da
// error, solo afecta 0 filas; antes la UI mostraba "Viaje eliminado" y la tarjeta
// reaparecía al recargar. Pedimos `.select("id")` para contar las filas afectadas.

// Forma plana (no unión discriminada): el proyecto compila sin strictNullChecks y ahí
// TypeScript no estrecha uniones por `ok: true/false`.
export interface MembershipResult {
  ok: boolean;
  reason?: "not_allowed" | "error";
  message?: string;
}

interface MinimalClient {
  from: (table: string) => any;
  functions?: { invoke: (fn: string, opts?: any) => Promise<any> };
}

// T-P2-3: al borrar el viaje, la base anota TODOS sus archivos (documentos y fotos del diario, de
// cualquiera que los subió) en storage_purge_queue; trip-files-purge los borra de storage. Si esta
// llamada falla, la tarea programada y el borrado de cuenta los vuelven a intentar.
export async function deleteOwnedTrip(client: MinimalClient, tripId: string): Promise<MembershipResult> {
  const { data, error } = await client.from("trips").delete().eq("id", tripId).select("id");
  if (error) return { ok: false, reason: "error", message: error.message };
  if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "not_allowed" };
  try {
    await client.functions?.invoke("trip-files-purge", { body: {} });
  } catch {
    // no bloquea: el viaje ya se borró y los archivos siguen en la cola
  }
  return { ok: true };
}

/** Un colaborador "sale" del viaje: se borra su fila en trip_collaborators, el viaje sigue intacto. */
export async function leaveSharedTrip(client: MinimalClient, tripId: string, userId: string): Promise<MembershipResult> {
  const { data, error } = await client
    .from("trip_collaborators")
    .delete()
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .select("id");
  if (error) return { ok: false, reason: "error", message: error.message };
  if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: "not_allowed" };
  return { ok: true };
}

export const MEMBERSHIP_MESSAGES = {
  deleted: "Viaje eliminado",
  left: "Saliste del viaje. El dueño y los demás lo conservan.",
  deleteNotAllowed: "Solo quien creó el viaje puede eliminarlo. No se borró nada.",
  leaveNotAllowed: "No pudimos sacarte del viaje (quizá ya no eras colaborador).",
  error: "No pudimos completar la acción. Intenta de nuevo.",
};
