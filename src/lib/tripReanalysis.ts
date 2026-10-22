// Re-análisis de un viaje existente SIN perder lo que el usuario ya guardó.
//
// Antes: EditTrip llamaba a analizar-viaje (que siempre INSERTA un viaje nuevo) y
// después borraba el viaje original. Las FKs ON DELETE CASCADE se llevaban el diario,
// el packing y el split; gastos, reservas y alertas de precio quedaban huérfanos y los
// colaboradores perdían el acceso.
//
// Ahora: el resultado del análisis (fila temporal) se COPIA sobre la fila original
// (mismo id, mismos hijos) y solo se borra la fila temporal, que acaba de crearse y no
// tiene contenido del usuario. Si el servidor algún día actualiza en sitio (devuelve el
// mismo id), no hay nada que copiar ni borrar.

// Columnas que produce el análisis. NO incluye id, user_id, created_at ni updated_at.
export const REANALYSIS_FIELDS = [
  "destino",
  "pais_destino",
  "ciudad_origen",
  "fecha_salida",
  "fecha_regreso",
  "num_viajeros",
  "presupuesto_objetivo",
  "status",
  "total_estimado",
  "moneda",
  "match_score",
  "analisis_ai",
  "desglose_presupuesto",
  "vuelos_json",
  "hospedaje_json",
  "itinerario_json",
  "restaurantes_json",
  "tours_json",
  "tips_personalizados",
  "cruceros_json",
  "dates_optimized",
  "dates_optimization_meta",
  "cover_image_url",
] as const;

export function buildReanalysisPatch(fresh: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of REANALYSIS_FIELDS) {
    if (fresh[k] === undefined) continue;
    // Si el análisis no encontró portada, conservamos la que ya tenía el viaje.
    if (k === "cover_image_url" && !fresh[k]) continue;
    patch[k] = fresh[k];
  }
  return patch;
}

export type ReanalysisOutcome =
  /** El viaje original quedó actualizado; mismo id. */
  | { status: "updated"; tripId: string; tempCleanup: "deleted" | "not_needed" | "failed" }
  /** No se pudo escribir en el original: se conserva la cotización nueva como viaje aparte. */
  | { status: "kept_copy"; tripId: string; originalId: string };

// Interfaz mínima del cliente de Supabase que usamos (facilita las pruebas).
interface MinimalClient {
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: any; error: any }> };
  from: (table: string) => any;
}

export async function reanalyzeTripInPlace(
  client: MinimalClient,
  tripId: string,
  request: Record<string, unknown>,
): Promise<ReanalysisOutcome> {
  // trip_id va como pista para cuando el servidor soporte actualizar en sitio;
  // hoy analizar-viaje lo ignora y crea una fila nueva.
  const { data, error } = await client.functions.invoke("analizar-viaje", { body: { ...request, trip_id: tripId } });
  if (error) throw error;
  const fresh = data?.trip;
  if (!fresh?.id) throw new Error("Sin resultado");

  if (fresh.id === tripId) return { status: "updated", tripId, tempCleanup: "not_needed" };

  // Copiamos el análisis sobre el viaje original. `.select("id")` nos dice si RLS
  // realmente dejó escribir (un UPDATE bloqueado por RLS no devuelve error, solo 0 filas).
  const { data: updated, error: updErr } = await client
    .from("trips")
    .update(buildReanalysisPatch(fresh))
    .eq("id", tripId)
    .select("id");
  if (updErr || !Array.isArray(updated) || updated.length === 0) {
    // Nunca borramos nada si no pudimos actualizar: el usuario conserva ambos.
    return { status: "kept_copy", tripId: fresh.id, originalId: tripId };
  }

  // La fila temporal es nuestra y está recién creada (sin diario, packing, etc.).
  const { data: removed, error: delErr } = await client.from("trips").delete().eq("id", fresh.id).select("id");
  const tempCleanup = !delErr && Array.isArray(removed) && removed.length > 0 ? "deleted" : "failed";
  return { status: "updated", tripId, tempCleanup };
}
