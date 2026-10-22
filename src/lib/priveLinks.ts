// Enlaces internos de Privé hacia el resto de IATOS (misma pestaña).

/**
 * "Pregúntale a Iato": abre el Concierge existente (no otro chatbot) con la pregunta escrita en el
 * cuadro, sin enviarla (la persona decide). El Concierge usa su viaje activo de siempre.
 */
export function askIatoHref(question: string): string {
  const q = question.trim().slice(0, 400);
  return q ? `/dashboard/concierge?ask=${encodeURIComponent(q)}` : "/dashboard/concierge";
}

/** Crear un viaje (el flujo existente de IATOS). */
export const PLAN_TRIP_HREF = "/dashboard/planear";
