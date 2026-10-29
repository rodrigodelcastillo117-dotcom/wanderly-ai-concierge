// El selector de viaje sigue al viaje del que trató la respuesta (auditoría 10, ronda 3, N-P2-8). Con
// Valle de Bravo fijado, "chofer en Oaxaca" respondía "sobre Oaxaca" y el selector seguía en Valle de
// Bravo ("elegido por ti"). Ahora, si Iato respondió sobre un viaje que el usuario NOMBRÓ, el selector lo
// muestra (sin cambiar el viaje fijado en su perfil) y la conversación sigue sobre ese viaje.

export interface ReplyTrip { tripId?: string | null; reason?: string | null }

/**
 * Siguiente viaje "seguido": el que nombró el usuario si no es el que ya muestra el selector; null si
 * volvió al de siempre; sin cambios en cualquier otro caso (la respuesta siguió sobre el mismo viaje).
 */
export function nextFollowTrip(prev: string | null, reply: ReplyTrip, baseId: string | null): string | null {
  if (!reply.tripId) return prev;
  // La respuesta volvió al viaje de siempre (por nombre o porque es el fijado): el selector también.
  if (reply.tripId === baseId) return null;
  if (reply.reason === "mentioned") return reply.tripId;
  // Otra razón (p. ej. el mismo viaje seguido, que la app mandó como trip_id): se sigue mostrando.
  return prev;
}
