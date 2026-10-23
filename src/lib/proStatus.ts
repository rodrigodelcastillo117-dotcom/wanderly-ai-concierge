// Texto de "Estado" en /dashboard/pro, sin React (se prueba con Vitest).
//
// Hallazgo R10 en producción: con la prueba de 30 días en curso y la cancelación programada desde
// el portal de Stripe (cancel_at_period_end = true), la página seguía diciendo "En periodo de
// prueba · 30 días restantes", sin avisar que al terminar la prueba NO se cobra y PRO se acaba.

export const fmtProDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—";

export type ProStatusInput = {
  isComped: boolean;
  isTrialing: boolean;
  trialDaysLeft: number | null;
  cancelAtPeriodEnd: boolean;
  subscription: {
    status: string | null;
    stripe_customer_id: string | null;
    trial_end?: string | null;
    current_period_end: string | null;
    /** Cortesía con fecha de fin (premio de la promoción de referidos); null = sin vencimiento. */
    comped_until?: string | null;
  } | null;
};

export function proStatusLabel(v: ProStatusInput): string {
  const sub = v.subscription;
  if (v.isComped) {
    return sub?.comped_until
      ? `PRO de cortesía hasta el ${fmtProDate(sub.comped_until)} · premio por invitar a tus amigos`
      : "PRO de cortesía · acceso permanente";
  }
  if (v.isTrialing) {
    if (!sub?.stripe_customer_id) {
      return `Prueba gratis sin tarjeta · ${v.trialDaysLeft ?? 0} días restantes; al terminar vuelves al plan gratuito`;
    }
    if (v.cancelAtPeriodEnd) {
      return `En periodo de prueba hasta el ${fmtProDate(sub.trial_end ?? sub.current_period_end)} (cancelación programada: no se te cobrará y vuelves al plan gratuito)`;
    }
    return `En periodo de prueba · ${v.trialDaysLeft ?? 0} días restantes`;
  }
  if (sub?.status === "past_due") {
    return "Pago pendiente · actualiza tu tarjeta en “Gestionar suscripción” para recuperar PRO";
  }
  if (sub?.status === "active") {
    return v.cancelAtPeriodEnd
      ? `Activa hasta el ${fmtProDate(sub.current_period_end)} (cancelación programada)`
      : `Activa · se renueva el ${fmtProDate(sub.current_period_end)}`;
  }
  return "Versión gratuita";
}
