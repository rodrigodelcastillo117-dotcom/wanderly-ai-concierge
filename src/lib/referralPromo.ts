// Promoción "Invita 5 amigos y gana 1 mes de PRO". El servidor decide todo (public.referral_progress,
// migración 20261027080000_referidos_promo.sql): quién cuenta, cuántos premios hay y cómo se aplicó cada
// uno. Aquí solo se traduce esa respuesta a lo que muestra la tarjeta de invitar.
import { supabase } from "@/integrations/supabase/client";

export const REFERRAL_GOAL = 5;
export const REFERRAL_TERMS_PATH = "/terminos#promo-referidos";

export type ReferralJoinStatus = "cuenta" | "falta_correo" | "falta_viaje" | "no_cuenta";

export type ReferralProgress = {
  goal: number;
  days_per_reward: number;
  /** Referidos válidos que aún no cubre ningún premio (0–4 normalmente). */
  counting: number;
  rewards: number;
  pending_rewards: number;
  last_reward: {
    status: "pending" | "processing" | "applied";
    route: "comp" | "stripe" | "prive" | "cortesia_indefinida";
    days: number;
    created_at: string;
    applied_at: string | null;
    comped_until: string | null;
  } | null;
  /** Fin de la cortesía por referidos vigente (null si no hay). */
  comped_until: string | null;
  stripe_apply_enabled: boolean;
  joined: { name: string | null; status: ReferralJoinStatus; joined_at: string }[];
};

export const JOIN_STATUS_LABEL: Record<ReferralJoinStatus, string> = {
  cuenta: "Ya cuenta",
  falta_correo: "Falta que confirme su correo",
  falta_viaje: "Falta que cree su primer viaje",
  no_cuenta: "No cuenta para la promoción",
};

export const shareText = "Te invito a IATOS, tu concierge de viajes con IA:";
export const shareMessage = (link: string) => `${shareText} ${link}`;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
};

const months = (n: number) => `${n} ${n === 1 ? "mes" : "meses"}`;

/** Qué pasa con el último premio, en una frase. */
export function rewardStatusLine(p: ReferralProgress): string | null {
  const r = p.last_reward;
  if (!r) return null;
  if (r.status === "applied") {
    if (r.route === "comp") {
      // p.comped_until solo viene mientras la cortesía sigue vigente.
      const until = fmtDate(p.comped_until);
      return until ? `Tienes IATOS PRO de cortesía hasta el ${until}.` : "Tu mes de PRO de cortesía ya se usó.";
    }
    return "Tu mes gratis se aplicó como saldo a favor en tu cobro.";
  }
  if ((r.route === "stripe" || r.route === "prive") && p.stripe_apply_enabled) {
    return "Tu mes gratis se aplicará en tu próximo cobro.";
  }
  return "Tu mes gratis está guardado; te avisaremos cuando se aplique.";
}

export type ReferralView = {
  /** Lo que llena la barra (0–5). */
  filled: number;
  label: string;
  /** true justo al completar 5: celebración. */
  celebrate: boolean;
  /** "Ya ganaste 1 mes de PRO." cuando hay premios y se avanza hacia el siguiente. */
  earnedLine: string | null;
  statusLine: string | null;
};

export function referralView(p: ReferralProgress): ReferralView {
  const goal = p.goal > 0 ? p.goal : REFERRAL_GOAL;
  const counting = Math.max(0, Math.min(goal, Math.floor(p.counting ?? 0)));
  const rewards = Math.max(0, Math.floor(p.rewards ?? 0));
  const celebrate = rewards > 0 && counting === 0;
  const filled = celebrate ? goal : counting;
  return {
    filled,
    label: `${filled} de ${goal}`,
    celebrate,
    earnedLine: rewards > 0 && !celebrate ? `Ya ganaste ${months(rewards)} de PRO.` : null,
    statusLine: rewards > 0 ? rewardStatusLine(p) : null,
  };
}

function isProgress(v: unknown): v is ReferralProgress {
  const o = v as Partial<ReferralProgress> | null;
  return !!o && typeof o === "object" && typeof o.counting === "number" && typeof o.rewards === "number" && Array.isArray(o.joined);
}

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Progreso de quien tiene la sesión. null si el servidor no respondió (la tarjeta se ve sin progreso). */
export async function fetchReferralProgress(): Promise<ReferralProgress | null> {
  // Método llamado sobre el cliente (rpc usa this); el tipo generado aún no conoce la función.
  const { data, error } = await (supabase as unknown as RpcClient).rpc("referral_progress");
  if (error || !isProgress(data)) return null;
  return data;
}
