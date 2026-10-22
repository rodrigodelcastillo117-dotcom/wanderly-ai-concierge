// Única fuente de los textos comerciales de IATOS (precio, prueba, qué incluye cada plan).
// Landing, registro, página PRO, avisos de PRO, términos y correos leen de aquí para decir
// exactamente lo mismo (decisiones DEC-01 y DEC-02 del dueño, 2026-10-22). Si cambian los
// límites aprobados, se cambian aquí y en la tabla plan_limits del servidor.

export const PRO_PRICE_MXN = 99;

/** "$99 MXN al mes, IVA incluido". */
export const PRICE_LINE = `$${PRO_PRICE_MXN} MXN al mes, IVA incluido`;

export const TRIAL_DAYS = 30;

/** Promesa de la prueba: sin tarjeta y sin cobro automático. */
export const TRIAL_LINE = `${TRIAL_DAYS} días de IATOS PRO gratis, sin tarjeta y sin cobro automático`;

/** Qué pasa al terminar la prueba. */
export const AFTER_TRIAL_LINE =
  "Al terminar, vuelves al plan gratuito con todos tus viajes y datos. Solo te pedimos tarjeta si decides contratar PRO.";

/** Botón principal de registro. */
export const TRIAL_CTA = `Probar PRO ${TRIAL_DAYS} días gratis`;

/** La prueba se activa al confirmar el correo, una sola vez por persona. */
export const TRIAL_CONDITIONS = "La prueba empieza al confirmar tu correo y es una por persona.";

export const FIXER_LINE = "Acceso preferente al Fixer humano, sujeto a disponibilidad";

export const FREE_FEATURES = [
  "Travel DNA básico",
  "3 mensajes con Iato al mes",
  "1 análisis completo de viaje de cortesía (una sola vez)",
  "Tus viajes guardados y edición manual",
  "Herramientas esenciales del viaje",
] as const;

export const PRO_FEATURES = [
  "100 mensajes con Iato al mes",
  "10 análisis completos de viaje al mes",
  "Hasta 5 alertas de precio",
  "Seguimiento de hasta 4 vuelos a la vez",
  "Personalización avanzada con tu Travel DNA completo",
  FIXER_LINE,
] as const;

/** Durante la prueba los topes son menores que en PRO (uso justo, ver docs/iatos/IATOS_PROPUESTA_PLANES_Y_PRUEBA.md). */
export const TRIAL_FEATURES = [
  "Funciones de IATOS PRO durante 30 días",
  "50 mensajes con Iato y 5 análisis completos de viaje",
  "Hasta 2 alertas de precio y 2 vuelos con seguimiento",
] as const;

// ── Encabezados que dependen del plan (IATOS-089 / IATOS-013) ──────────────────────────────
// El Concierge y Members Only decían "Concierge PRO te escucha" y "reservas gestionadas por tu
// Concierge PRO" también a cuentas gratis, y prometían reservar (Iato busca y da enlaces; una
// solicitud de mesa la atiende el equipo y la confirma cada lugar).

export type PlanView = {
  /** Aún se está leyendo el acceso: texto neutro, sin afirmar ningún plan. */
  loading?: boolean;
  isPro: boolean;
  isTrialing?: boolean;
  trialDaysLeft?: number | null;
  /** Mensajes con Iato que le quedan este periodo (null = sin tope). */
  remaining?: number | null;
  limit?: number | null;
};

export type ConciergeHeader = { eyebrow: string; title: string; note: string | null; showUpgrade: boolean };

export function conciergeHeaderCopy(v: PlanView): ConciergeHeader {
  if (v.loading) return { eyebrow: "CONCIERGE", title: "Iato te escucha", note: null, showUpgrade: false };
  if (v.isPro && v.isTrialing) {
    const days = v.trialDaysLeft;
    return {
      eyebrow: "CONCIERGE PRO · PRUEBA",
      title: "Concierge PRO te escucha",
      note: days != null ? `Prueba de IATOS PRO: ${days === 1 ? "te queda 1 día" : `te quedan ${days} días`}.` : "Estás en la prueba de IATOS PRO.",
      showUpgrade: false,
    };
  }
  if (v.isPro) return { eyebrow: "CONCIERGE PRO", title: "Concierge PRO te escucha", note: null, showUpgrade: false };
  const quota =
    v.remaining != null && v.limit != null
      ? `Plan gratuito: te quedan ${v.remaining} de ${v.limit} mensajes con Iato este mes.`
      : "Plan gratuito: mensajes con Iato limitados cada mes.";
  return { eyebrow: "CONCIERGE · PLAN GRATUITO", title: "Iato te escucha", note: quota, showUpgrade: true };
}

export function membersOnlySubtitle(v: PlanView): string {
  const base = "Vida nocturna seleccionada. Pide tu mesa y nuestro equipo te ayuda a gestionarla; la confirmación depende de cada lugar.";
  if (v.loading) return base;
  return v.isPro ? `${base} ${FIXER_LINE}.` : `${base} Con IATOS PRO: ${FIXER_LINE.charAt(0).toLowerCase()}${FIXER_LINE.slice(1)}.`;
}
