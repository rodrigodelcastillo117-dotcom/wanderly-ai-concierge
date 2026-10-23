import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Panel de admin: premios de la promoción "Invita 5 amigos y gana 1 mes de PRO" (admin_referral_rewards,
// solo agregados; la función responde 42501 a quien no es admin).
type Summary = { total: number; applied: number; pending: number; last_30d: number; people: number; days_given: number; stripe_apply_enabled: boolean };
type RpcClient = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

const isSummary = (v: unknown): v is Summary =>
  !!v && typeof v === "object" && typeof (v as Summary).total === "number" && typeof (v as Summary).pending === "number";
const n = (v: number) => Number(v).toLocaleString("es-MX");

export function AdminReferralRewardsCard() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await (supabase as unknown as RpcClient).rpc("admin_referral_rewards");
        if (alive && !error && isSummary(data)) setS(data);
      } catch { /* sin datos: no se muestra */ }
    })();
    return () => { alive = false; };
  }, []);
  if (!s) return null;
  return (
    <div className="rounded-xl bg-surface/60 border border-white/[0.06] p-4 flex items-start gap-3" data-testid="admin-referral-rewards">
      <Gift className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden />
      <div className="text-sm space-y-0.5">
        <p className="font-medium">Promoción de referidos: {n(s.total)} {s.total === 1 ? "premio" : "premios"} de 1 mes de PRO</p>
        <p className="text-xs text-muted-foreground">
          {n(s.applied)} aplicados ({n(s.days_given)} días de cortesía) · {n(s.pending)} guardados · {n(s.people)} {s.people === 1 ? "persona" : "personas"} · {n(s.last_30d)} en 30 días
        </p>
        <p className="text-[11px] text-muted-foreground">
          Mes gratis en Stripe para quien ya paga: {s.stripe_apply_enabled ? "encendido" : "apagado (pendiente de autorización)"}
        </p>
      </div>
    </div>
  );
}
