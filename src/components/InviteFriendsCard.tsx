import { useEffect, useState } from "react";
import { Copy, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { inviteLink } from "@/lib/referral";
import { toast } from "sonner";

export function InviteFriendsCard() {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [joined, setJoined] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: profile }, { count }] = await Promise.all([
        supabase.from("profiles").select("invite_code").eq("id", user.id).maybeSingle(),
        supabase.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_id", user.id),
      ]);
      setCode(profile?.invite_code ?? null);
      setJoined(count ?? 0);
    })();
  }, [user]);

  if (!code) return null;
  const link = inviteLink(code);
  const message = `Planeo mis viajes con IATOS: cotiza con precios reales y tiene concierge con IA. Únete con mi enlace: ${link}`;

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
      try { await navigator.share({ title: "IATOS", text: message, url: link }); } catch { /* cancelled */ }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
    }
  };

  return (
    <section className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
          <UserPlus className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-medium">Invita a quien viaja contigo</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Comparte tu enlace. Cuando alguien crea su cuenta con él, lo verás aquí.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-surface/60 border border-white/[0.06] px-3 py-2">
        <span className="text-xs text-muted-foreground truncate flex-1">{link}</span>
        <button type="button" onClick={copy} aria-label="Copiar enlace de invitación" className="text-primary hover:opacity-80 shrink-0">
          <Copy className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">
          {joined === 0 ? "Nadie se ha unido todavía con tu enlace." : `${joined} ${joined === 1 ? "persona se unió" : "personas se unieron"} con tu enlace.`}
        </p>
        <Button onClick={share} size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90">
          <Share2 className="w-3.5 h-3.5 mr-1.5" /> Compartir
        </Button>
      </div>
    </section>
  );
}
