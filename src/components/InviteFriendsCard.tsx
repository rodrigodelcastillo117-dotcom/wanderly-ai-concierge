import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Share2, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { inviteLink } from "@/lib/referral";
import {
  JOIN_STATUS_LABEL,
  REFERRAL_GOAL,
  REFERRAL_TERMS_PATH,
  type ReferralProgress,
  fetchReferralProgress,
  referralView,
  shareMessage,
  shareText,
} from "@/lib/referralPromo";
import { toast } from "sonner";

// Promoción "Invita 5 amigos y gana 1 mes de PRO". Quién cuenta y los premios los decide el servidor
// (referral_progress); la tarjeta solo los muestra.
export function InviteFriendsCard() {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReferralProgress | null>(null);
  const [joined, setJoined] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const [{ data: profile }, prog] = await Promise.all([
        supabase.from("profiles").select("invite_code").eq("id", user.id).maybeSingle(),
        fetchReferralProgress().catch(() => null),
      ]);
      if (!alive) return;
      setCode(profile?.invite_code ?? null);
      setProgress(prog);
      if (!prog) {
        // Sin respuesta de la promoción (p. ej. la migración aún no está aplicada): al menos el conteo.
        const { count } = await supabase.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_id", user.id);
        if (alive) setJoined(count ?? 0);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  if (!code) return null;
  const link = inviteLink(code);
  const view = progress ? referralView(progress) : null;
  const goal = progress?.goal || REFERRAL_GOAL;
  const people = progress?.joined ?? [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Enlace copiado");
    } catch {
      toast.error("No pudimos copiar el enlace");
    }
  };

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "IATOS", text: shareText, url: link }); } catch { /* cancelado */ }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage(link))}`, "_blank", "noopener");
    }
  };

  return (
    <section className="glass-card rounded-xl p-5 space-y-4" aria-labelledby="invite-promo-title">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
          <UserPlus className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p id="invite-promo-title" className="font-medium">Invita {goal} amigos y gana 1 mes de PRO</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Comparte tu enlace. Cuentan los amigos que confirman su correo y crean su primer viaje.
          </p>
        </div>
      </div>

      {view && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Tu progreso</span>
            <span className="font-medium text-foreground" data-testid="invite-progress-label">{view.label}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Amigos que ya cuentan"
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuenow={view.filled}
            aria-valuetext={view.label}
            className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"
          >
            <div className="h-full rounded-full bg-gradient-gold transition-[width] duration-500" style={{ width: `${(view.filled / goal) * 100}%` }} />
          </div>
          {view.earnedLine && <p className="text-xs text-muted-foreground">{view.earnedLine} {view.statusLine}</p>}
        </div>
      )}

      {view?.celebrate && (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/[0.07] px-3 py-2.5 flex items-start gap-2 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500"
        >
          <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-foreground">¡Ganaste 1 mes de PRO!</p>
            {view.statusLine && <p className="text-xs text-muted-foreground mt-0.5">{view.statusLine}</p>}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg bg-surface/60 border border-white/[0.06] px-3 py-2">
        <span className="text-xs text-muted-foreground truncate flex-1">{link}</span>
        <button type="button" onClick={copy} aria-label="Copiar enlace de invitación" className="text-primary hover:opacity-80 shrink-0">
          <Copy className="w-4 h-4" />
        </button>
      </div>

      {progress && people.length > 0 && (
        <ul className="divide-y divide-white/[0.05] text-sm" aria-label="Quienes se unieron con tu enlace">
          {people.map((p, i) => (
            <li key={`${p.joined_at}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
              <span className="truncate">{p.name ?? "Sin nombre"}</span>
              <span className={`text-xs shrink-0 ${p.status === "cuenta" ? "text-primary" : "text-muted-foreground"}`}>
                {JOIN_STATUS_LABEL[p.status] ?? JOIN_STATUS_LABEL.no_cuenta}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0 space-y-0.5">
          {(progress ? people.length === 0 : joined === 0) && (
            <p className="text-sm text-muted-foreground">Nadie se ha unido todavía con tu enlace.</p>
          )}
          {!progress && joined != null && joined > 0 && (
            <p className="text-sm text-muted-foreground">{joined} {joined === 1 ? "persona se unió" : "personas se unieron"} con tu enlace.</p>
          )}
          <Link to={REFERRAL_TERMS_PATH} className="inline-block text-xs text-primary hover:underline">Términos de la promoción</Link>
        </div>
        <Button onClick={share} size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90">
          <Share2 className="w-3.5 h-3.5 mr-1.5" /> Compartir
        </Button>
      </div>
    </section>
  );
}
