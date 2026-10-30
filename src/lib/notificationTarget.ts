/** A dónde lleva un aviso al tocarlo, o null si no lleva a ningún lado. */
export function notificationTarget(n: { type: string; related_id: string | null; title?: string | null }): string | null {
  const tripTypes = ["trip_updated", "trip_accepted", "trip_rejected", "price_drop", "flight_update"];
  if (n.related_id && tripTypes.includes(n.type)) return `/dashboard/viajes/${n.related_id}`;
  // Un vuelo seguido sin viaje se consultó desde el concierge (igual que el enlace del push).
  if (n.type === "flight_update") return "/dashboard/concierge";
  // IATOS Privé (notifications.type = 'prive'): la invitación abre la ceremonia sin token (el
  // servidor la busca por cuenta). Los avisos de seguridad (contraseña, sesiones, accesos) llevan a
  // la membresía. /prive/invitacion también resuelve bien cualquier estado (p. ej. "ya activa").
  if (n.type === "prive") return /invitaci/i.test(n.title ?? "") || !n.title ? "/prive/invitacion" : "/prive/membresia";
  // Saludo de un amigo (saludar_amigo): related_id es quien saludó → su perfil para devolverlo.
  if (n.type === "social_poke") return n.related_id ? `/dashboard/social/amigo/${n.related_id}` : "/dashboard/social";
  // Amistad (T-P2-1): la solicitud se responde en Social; la aceptada abre el perfil del amigo.
  if (n.type === "friend_request") return "/dashboard/social";
  if (n.type === "friend_accepted") return n.related_id ? `/dashboard/social/amigo/${n.related_id}` : "/dashboard/social";
  // Actividad compartida con amigos (20261027090000): reacciones y preguntas se ven y responden en tu
  // perfil ("Qué ven mis amigos"); una respuesta abre la actividad del amigo que respondió.
  if (n.type === "social_reaccion" || n.type === "social_pregunta") return "/dashboard/perfil#que-ven-mis-amigos";
  if (n.type === "social_respuesta") return n.related_id ? `/dashboard/social/amigo/${n.related_id}#actividad` : "/dashboard/social";
  // Reservas IA (correo al restaurante): la tarjeta vive en Mis reservas.
  if (n.type === "ai_reservation") return "/dashboard/reservas#reservas-ia";
  // Vigilancia proactiva (vuelo, check-in, documentos, clima, alertas, reconfirmaciones): el viaje; sin viaje, el concierge.
  if (n.type === "vigilancia") return n.related_id ? `/dashboard/viajes/${n.related_id}` : "/dashboard/concierge?tab=solicitudes";
  // Avisos del sistema a administradores (p. ej. se acabaron los créditos de IA): el panel de admin.
  if (n.type === "system_alert") return "/dashboard/admin";
  return null;
}
