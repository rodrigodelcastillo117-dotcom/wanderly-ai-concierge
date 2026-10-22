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
    conditions: "Crear tu cuenta es gratis; la prueba de PRO es una por persona.",
    signup: "Crea tu cuenta gratis. La prueba de PRO la activas cuando quieras.",
    checkoutNote: `Al contratar registras tu tarjeta en Stripe. Si es tu primera vez, los primeros ${TRIAL_DAYS} días son de prueba y no se cobra nada si cancelas antes; después, ${PRICE_LINE}, cada mes hasta que canceles desde “Gestionar suscripción”. IATOS AI no almacena tu tarjeta.`,
    policy: [
      `${line}. Es una por persona.`,
      `Para activarla registras tu tarjeta en Stripe, pero no se genera ningún cargo durante los primeros ${TRIAL_DAYS} días.`,
      "Si cancelas antes de que termine la prueba, no se te cobra nada.",
      `Al terminar la prueba se hace el primer cargo de ${PRICE_LINE} y después cada mes hasta que canceles.`,
    ],
  };
}
