import { useCallback, useEffect, useState } from "react";
import { track } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AccessState = {
  is_pro: boolean;
  concierge_used: number;
  concierge_limit: number;
  concierge_remaining: number;
  trips_used: number;
  trips_limit: number;
  trips_remaining: number;
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

export function useSubscription() {
  const { user } = useAuth();
  const [access, setAccess] = useState<AccessState | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setAccess(null);
      setSubscription(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: state }, { data: sub }] = await Promise.all([
      supabase.rpc("get_access_state", { _user_id: user.id }),
      supabase
        .from("subscriptions")
        .select("status, plan, trial_end, current_period_end, cancel_at_period_end, stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    setAccess((state as unknown as AccessState) ?? null);
    setSubscription((sub as SubscriptionRow) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const status = subscription?.status ?? null;
  const isTrialing = status === "trialing";
  const isComped = status === "comped";
  const trialDaysLeft = isTrialing ? daysLeft(subscription?.trial_end ?? subscription?.current_period_end) : null;

  const startCheckout = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("stripe-checkout", {
      body: { origin: window.location.origin },
    });
    if (error) throw new Error(error.message);
    if (!data?.url) throw new Error(data?.message ?? "No se pudo iniciar el checkout.");
    track("checkout_started", { plan: "pro_mensual" });
    window.location.href = data.url as string;
  }, []);

  const openPortal = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("stripe-portal", {
      body: { origin: window.location.origin },
    });
    if (error) throw new Error(error.message);
    if (!data?.url) throw new Error(data?.message ?? "No se pudo abrir el portal de facturación.");
    window.location.href = data.url as string;
  }, []);

  return {
    loading,
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
