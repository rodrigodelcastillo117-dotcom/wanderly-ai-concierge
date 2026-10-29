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

/**
 * Auditoría Privé P1-5 (28-oct-2026): decía "Acceso preferente a nuestro equipo humano" y no existe ninguna
 * prioridad (la Mesa de operaciones atiende por orden de llegada). Solo se promete lo que sí pasa.
 */
export const FIXER_LINE = "Nuestro equipo humano pide tus mesas de Solo para miembros, sujeto a disponibilidad";

export const FREE_CONCIERGE_LINE = "3 mensajes con Iato al mes";
export const FREE_TRIP_LINE = "1 análisis completo de viaje de cortesía (una sola vez)";

export const FREE_FEATURES = [
  "Perfil de viajero básico",
  FREE_CONCIERGE_LINE,
  FREE_TRIP_LINE,
  "Tus viajes guardados y edición manual",
  "Herramientas esenciales del viaje",
] as const;

export const PRO_FEATURES = [
  "100 mensajes con Iato al mes",
  "10 análisis completos de viaje al mes",
  "Hasta 5 alertas de precio",
  "Seguimiento de hasta 4 vuelos a la vez",
  "Personalización avanzada con tu perfil de viajero completo",
  FIXER_LINE,
] as const;

/**
 * Uso del plan gratuito en la página PRO (N-04 / D-P3-6). Si el servidor no devuelve un tope (null),
 * se muestra lo publicado del plan gratuito, nunca "sin límite": ningún plan de IATOS es ilimitado.
 */
export function freeUsageLines(a: {
  concierge_limit: number | null;
  concierge_remaining: number | null;
  trips_limit: number | null;
  trips_remaining: number | null;
}): { concierge: string; trips: string } {
  return {
    concierge: a.concierge_limit == null ? FREE_CONCIERGE_LINE : `${a.concierge_remaining ?? 0} de ${a.concierge_limit} mensajes gratis`,
    trips: a.trips_limit == null ? FREE_TRIP_LINE : `${a.trips_remaining ?? 0} de ${a.trips_limit} gratis`,
  };
}

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
      // Un solo nombre para el asistente: Iato (auditoría 10, ronda 3, §4). El plan va en el renglón de arriba.
      title: "Iato te escucha",
      note: days != null ? `Prueba de IATOS PRO: ${days === 1 ? "te queda 1 día" : `te quedan ${days} días`}.` : "Estás en la prueba de IATOS PRO.",
      showUpgrade: false,
    };
  }
  if (v.isPro) return { eyebrow: "CONCIERGE PRO", title: "Iato te escucha", note: null, showUpgrade: false };
  const quota =
    v.remaining != null && v.limit != null
      ? `Plan gratuito: te quedan ${v.remaining} de ${v.limit} mensajes con Iato este mes.`
      : "Plan gratuito: mensajes con Iato limitados cada mes.";
  return { eyebrow: "CONCIERGE · PLAN GRATUITO", title: "Iato te escucha", note: quota, showUpgrade: true };
}

export function membersOnlySubtitle(v: PlanView): string {
  // Sin "acceso preferente" (no hay prioridad real) y corto para que se lea completo en el celular.
  const base = "Vida nocturna seleccionada. Pide tu mesa y nuestro equipo te ayuda a gestionarla; la confirmación depende de cada lugar.";
  if (v.loading || v.isPro) return base;
  return `${base} Con IATOS PRO.`;
}

/**
 * Cómo funciona la prueba hoy. "no_card" = DEC-02 encendido (app_flags.trial_no_card_enabled);
 * "card" = la prueba de 30 días se activa al contratar en Stripe (comportamiento mientras el
 * dueño no encienda la prueba sin tarjeta). La página nunca debe prometer la otra.
 */
export type TrialMode = "no_card" | "card";

export type TrialCopy = {
  line: string;
  after: string;
  cta: string;
  conditions: string;
  signup: string;
  /** Nota bajo el botón de contratar en la página PRO. */
  checkoutNote: string;
  /** Viñetas de la sección "Periodo de prueba" de la política de reembolsos. */
  policy: string[];
};

export function trialCopy(mode: TrialMode): TrialCopy {
  if (mode === "no_card") {
    return {
      line: TRIAL_LINE,
      after: AFTER_TRIAL_LINE,
      cta: TRIAL_CTA,
      conditions: TRIAL_CONDITIONS,
      signup: `${TRIAL_LINE}.`,
      checkoutNote:
        "La tarjeta solo se pide al contratar PRO; la prueba gratis no la necesita. Si contratas durante tu prueba, el primer cargo se hace cuando termina. PRO se renueva cada mes hasta que canceles desde “Gestionar suscripción”. El cobro lo procesa Stripe; IATOS AI no almacena tu tarjeta.",
      policy: [
        `${TRIAL_LINE}. ${TRIAL_CONDITIONS}`,
        "No necesitas tarjeta para la prueba y no se genera ningún cargo durante ni después de ella.",
        AFTER_TRIAL_LINE,
        "Si contratas PRO durante la prueba, el primer cargo se hace cuando termina la prueba; si lo contratas después, el primer cargo es al contratar.",
      ],
    };
  }
  const line = `Prueba IATOS PRO ${TRIAL_DAYS} días gratis al contratarlo por primera vez`;
  const after = `Registras tu tarjeta al contratar; si cancelas antes de que terminen los ${TRIAL_DAYS} días no se cobra nada. Si no cancelas, se cobra ${PRICE_LINE}.`;
  return {
    line,
    after,
    cta: "Empezar gratis",
    conditions: "Crear tu cuenta es gratis; la prueba de PRO es una por persona y por tarjeta.",
    signup: "Crea tu cuenta gratis. La prueba de PRO la activas cuando quieras.",
    checkoutNote: `Al contratar registras tu tarjeta en Stripe. Si es tu primera vez, los primeros ${TRIAL_DAYS} días son de prueba y no se cobra nada si cancelas antes; si esa tarjeta ya tuvo una prueba, el primer cargo se hace al contratar. Después, ${PRICE_LINE}, cada mes hasta que canceles desde “Gestionar suscripción”. IATOS AI no almacena tu tarjeta.`,
    policy: [
      `${line}. Es una por persona y por tarjeta: si la tarjeta ya tuvo una prueba en otra cuenta, el primer cargo se hace al contratar.`,
      `Para activarla registras tu tarjeta en Stripe, pero no se genera ningún cargo durante los primeros ${TRIAL_DAYS} días.`,
      "Si cancelas antes de que termine la prueba, no se te cobra nada.",
      `Al terminar la prueba se hace el primer cargo de ${PRICE_LINE} y después cada mes hasta que canceles.`,
    ],
  };
}
