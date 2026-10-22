import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Crown, Check, Loader2, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useSubscription } from "@/hooks/useSubscription";
import { toast } from "@/hooks/use-toast";
import { track } from "@/lib/analytics";
import { PRICE_LINE, PRO_FEATURES } from "@/lib/planCopy";
import { useTrialCopy } from "@/hooks/usePlanConfig";

// Mismo texto que Landing, Términos y correos (src/lib/planCopy.ts).
const BENEFITS = PRO_FEATURES;

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "—";

export default function Pro() {
  const {
    loading, error, access, subscription, isPro, isTrialing, isComped,
    trialDaysLeft, cancelAtPeriodEnd, refresh, startCheckout, openPortal,
  } = useSubscription();
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const { copy: trial } = useTrialCopy();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const c = params.get("checkout");
    if (!c) return;
    if (c === "success") track("checkout_completed", { plan: "pro_mensual" });
    if (c === "success") toast({ title: "¡Gracias por contratar IATOS PRO!", description: "Estamos confirmando tu pago con Stripe; tu membresía se activa en unos segundos." });
    if (c === "cancel") toast({ title: "Checkout cancelado", description: "No se realizó ningún cargo." });
    params.delete("checkout");
    setParams(params, { replace: true });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (kind: "checkout" | "portal", fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (e) { toast({ title: "Algo salió mal", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const statusLabel = isComped
    ? "PRO de cortesía · acceso permanente"
    : isTrialing
      ? subscription?.stripe_customer_id
        ? `En periodo de prueba · ${trialDaysLeft ?? 0} días restantes`
        : `Prueba gratis sin tarjeta · ${trialDaysLeft ?? 0} días restantes; al terminar vuelves al plan gratuito`
      : subscription?.status === "past_due"
        ? "Pago pendiente · actualiza tu tarjeta en “Gestionar suscripción” para recuperar PRO"
        : subscription?.status === "active"
        ? cancelAtPeriodEnd
          ? `Activa hasta el ${fmtDate(subscription?.current_period_end)} (cancelación programada)`
          : `Activa · se renueva el ${fmtDate(subscription?.current_period_end)}`
        : "Versión gratuita";

  return (
    <DashboardLayout>
      <div className="p-5 md:p-10 max-w-3xl">
        <p className="text-xs tracking-[0.25em] uppercase text-primary mb-2">Membresía</p>
        <h1 className="font-display text-4xl md:text-5xl mb-3 flex items-center gap-3">
          IATOS <span className="gold-text">PRO</span>
        </h1>
        <p className="text-muted-foreground mb-8 max-w-xl">
          Más mensajes con Iato, más análisis de viaje y alertas de precio. {PRICE_LINE}. Cancela cuando quieras.
        </p>

        {loading ? (
          <div className="glass-card rounded-2xl p-10 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div role="alert" className="glass-card rounded-2xl p-6 md:p-8 mb-6 text-center">
            <p className="text-sm text-muted-foreground mb-4">{error} Revisa tu conexión e inténtalo de nuevo.</p>
            <button
              onClick={() => refresh()}
              className="px-6 py-3 rounded-xl border border-border text-sm hover:border-primary/50 transition"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            <div className="glass-card rounded-2xl p-6 md:p-8 mb-6">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
                <div>
                  <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Estado</p>
                  <p className="font-medium flex items-center gap-2">
                    {isPro && <Crown className="w-4 h-4 text-primary" />}
                    {statusLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl gold-text leading-none">$99</p>
                  <p className="text-[11px] text-muted-foreground">MXN / mes · IVA incluido</p>
                </div>
              </div>

              {!isPro && access && (
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="rounded-xl border border-border/60 bg-surface/40 p-4">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Concierge este mes</p>
                    <p className="text-sm">{access.concierge_limit == null ? "Mensajes sin límite" : `${access.concierge_remaining ?? 0} de ${access.concierge_limit} mensajes gratis`}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-surface/40 p-4">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Análisis de viaje</p>
                    <p className="text-sm">{access.trips_limit == null ? "Sin límite" : `${access.trips_remaining ?? 0} de ${access.trips_limit} gratis`}</p>
                  </div>
                </div>
              )}

              <ul className="space-y-2.5 mb-7">
                {BENEFITS.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{b}</span>
                  </li>
                ))}
              </ul>

              {isComped ? (
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span>Tienes acceso PRO de cortesía indefinido como miembro fundador. No necesitas hacer nada.</span>
                </div>
              ) : subscription?.stripe_customer_id && (isPro || subscription?.status) ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Con pago pendiente no se contrata otra suscripción (el servidor la rechaza): se
                      actualiza la tarjeta en el portal. */}
                  {!isPro && subscription?.status !== "past_due" && (
                    <button
                      onClick={() => run("checkout", startCheckout)}
                      disabled={busy !== null}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-gold text-primary-foreground text-sm font-medium disabled:opacity-60"
                    >
                      {busy === "checkout" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                      Activar IATOS PRO
                    </button>
                  )}
                  <button
                    onClick={() => run("portal", openPortal)}
                    disabled={busy !== null}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-border text-sm hover:border-primary/50 transition disabled:opacity-60"
                  >
                    {busy === "portal" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Gestionar suscripción
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => run("checkout", startCheckout)}
                  disabled={busy !== null}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-gold text-primary-foreground text-sm font-medium disabled:opacity-60"
                >
                  {busy === "checkout" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                  Contratar IATOS PRO
                </button>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              {trial.checkoutNote}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
              Al continuar aceptas los
              <Link to="/terminos" className="text-primary hover:underline">Términos y Condiciones</Link>
              <span>·</span>
              <Link to="/privacidad" className="text-primary hover:underline">Aviso de Privacidad</Link>
              <span>·</span>
              <Link to="/reembolsos" className="text-primary hover:underline">Política de Reembolsos</Link>
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
