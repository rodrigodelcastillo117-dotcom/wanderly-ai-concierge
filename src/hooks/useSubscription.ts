import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { readFunctionError } from "@/lib/functionErrors";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Límites leídos de public.plan_limits en el servidor; null = ilimitado (p. ej. PRO mientras
// pro_limits_enforced esté apagado).
export type AccessState = {
  is_pro: boolean;
  plan?: "free" | "pro";
  limits_enforced?: boolean;
  concierge_used: number;
  concierge_limit: number | null;
  concierge_remaining: number | null;
  concierge_renews_at?: string | null;
  trips_used: number;
  trips_limit: number | null;
  trips_remaining: number | null;
  trips_period?: "month" | "once";
};

export type SubscriptionRow = {
  status: string | null;
  plan: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string | null;
};

const daysLeft = (iso?: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86400000));
};

// Si el servidor no contesta en este tiempo, dejamos de esperar y ofrecemos "Reintentar"
// (antes la tarjeta de /dashboard/pro podía quedarse girando para siempre, N-02).
export const SUBSCRIPTION_TIMEOUT_MS = 12000;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Evento para volver a leer el acceso (get_access_state) en todos los componentes montados que usan
 * useSubscription; p. ej. el Concierge lo dispara tras cada mensaje para actualizar "te quedan N".
 */
export const ACCESS_CHANGED_EVENT = "iatos:access-changed";
export function notifyAccessChanged() {
  try { window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT)); } catch { /* sin window (SSR/pruebas) */ }
}

export function useSubscription() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [access, setAccess] = useState<AccessState | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Solo la última consulta escribe el estado: una respuesta vieja que llega tarde no debe
  // dejar la tarjeta en un estado intermedio.
  const reqRef = useRef(0);
  useEffect(() => () => { reqRef.current += 1; }, []);

  // silent: relectura en segundo plano (tras un mensaje) sin pasar por "cargando" ni parpadear.
  const refresh = useCallback(async (opts: { silent?: boolean } = {}) => {
    const req = ++reqRef.current;
    if (!uid) {
      setAccess(null);
      setSubscription(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const [{ data: state, error: stateErr }, { data: sub, error: subErr }] = await withTimeout(
        Promise.all([
          supabase.rpc("get_access_state", { _user_id: uid }),
          supabase
            .from("subscriptions")
            .select("status, plan, trial_end, current_period_end, cancel_at_period_end, stripe_customer_id")
            .eq("user_id", uid)
            .maybeSingle(),
        ]),
        SUBSCRIPTION_TIMEOUT_MS,
      );
      if (req !== reqRef.current) return;
      // Sin respuesta válida no adivinamos "versión gratuita": mostramos el error con "Reintentar".
      if (stateErr || subErr || !state || typeof state !== "object") throw stateErr ?? subErr ?? new Error("sin datos");
      setAccess(state as unknown as AccessState);
      setSubscription((sub as SubscriptionRow) ?? null);
    } catch (e) {
      if (req !== reqRef.current) return;
      console.error("useSubscription", e);
      setError("No pudimos cargar el estado de tu membresía.");
    } finally {
      // Pase lo que pase, la última consulta siempre termina el "cargando".
      if (req === reqRef.current) setLoading(false);
    }
    // Depende del id (no del objeto user, que cambia en cada refresh de token).
  }, [uid]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onChange = () => { refresh({ silent: true }); };
    window.addEventListener(ACCESS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ACCESS_CHANGED_EVENT, onChange);
  }, [refresh]);

  const status = subscription?.status ?? null;
  // Una prueba vencida (p. ej. la de 30 días sin tarjeta) queda como 'trialing' en la fila, pero
  // ya no da acceso: solo cuenta como prueba mientras el servidor diga que es PRO.
  const isTrialing = status === "trialing" && Boolean(access?.is_pro);
  const isComped = status === "comped";
  const trialDaysLeft = isTrialing ? daysLeft(subscription?.trial_end ?? subscription?.current_period_end) : null;

  const startCheckout = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("stripe-checkout", {
      body: { origin: window.location.origin },
    });
    // 409 = ya tiene PRO (o pago pendiente): el servidor explica qué hacer; lo mostramos tal cual.
    if (error) throw new Error((await readFunctionError(error, "No se pudo iniciar el pago. Intenta de nuevo.")).message);
    if (!data?.url) throw new Error(data?.message ?? "No se pudo iniciar el checkout.");
    track("checkout_started", { plan: "pro_mensual" });
    window.location.href = data.url as string;
  }, []);

  const openPortal = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("stripe-portal", {
      body: { origin: window.location.origin },
    });
    if (error) throw new Error((await readFunctionError(error, "No se pudo abrir el portal de facturación.")).message);
    if (!data?.url) throw new Error(data?.message ?? "No se pudo abrir el portal de facturación.");
    window.location.href = data.url as string;
  }, []);

  return {
    loading,
    error,
    access,
    subscription,
    isPro: Boolean(access?.is_pro),
    isTrialing,
    isComped,
    trialDaysLeft,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    refresh,
    startCheckout,
    openPortal,
  };
}
