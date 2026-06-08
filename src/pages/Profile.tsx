import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardLayout } from "@/components/DashboardLayout";
import BenefitsVault from "@/components/BenefitsVault";
import PromocionesActivas from "@/components/PromocionesActivas";
import AvatarCreator from "@/components/AvatarCreator";
import { Sparkles, LogOut, Wand2, RefreshCw, Crown, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TravelAvatarCinematic } from "@/components/lux/TravelAvatarCinematic";
import { useTravelDNA, TravelDNAStats } from "@/components/lux/TravelDNAStats";
import { CompatibilityPanel } from "@/components/lux/CompatibilityPanel";
import { BestMomentsPanel } from "@/components/lux/BestMomentsPanel";

const Profile = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>("");
  const [openAvatar, setOpenAvatar] = useState(false);
  const { dna, reload } = useTravelDNA();
  const [evolving, setEvolving] = useState(false);
  const [dnaMeta, setDnaMeta] = useState<{ version: number | null; updated_at: string | null }>({
    version: null,
    updated_at: null,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, full_name")
        .eq("id", user.id)
        .maybeSingle();
      setAvatarUrl((data as any)?.avatar_url ?? null);
      setFullName((data as any)?.full_name ?? "");

      const { data: prefs } = await supabase
        .from("ai_user_preferences")
        .select("dna_version, dna_updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      setDnaMeta({
        version: (prefs as any)?.dna_version ?? null,
        updated_at: (prefs as any)?.dna_updated_at ?? null,
      });
    })();
  }, [user]);

  const evolucionar = async () => {
    setEvolving(true);
    try {
      const { error } = await supabase.functions.invoke("evolucionar-dna", { body: {} });
      if (error) throw error;
      toast.success("Travel DNA actualizado");
      reload();
      // refresh meta
      if (user) {
        const { data: prefs } = await supabase
          .from("ai_user_preferences")
          .select("dna_version, dna_updated_at")
          .eq("user_id", user.id)
          .maybeSingle();
        setDnaMeta({
          version: (prefs as any)?.dna_version ?? null,
          updated_at: (prefs as any)?.dna_updated_at ?? null,
        });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo evolucionar");
    } finally {
      setEvolving(false);
    }
  };

  const initial = (fullName?.[0] ?? "V").toUpperCase();

  const divergencias: string[] = dna?.perfil?.divergencias_detectadas ?? [];
  const evolucionMsg =
    divergencias[0] ??
    (dna && dna.tripCount > 0
      ? `Tu estilo dominante es ${dna.dominant}. Sigue viajando para refinar tu Travel DNA.`
      : "Crea tu primer viaje para activar la evolución de tu avatar.");

  const diasDesde = (iso: string | null) => {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d;
  };
  const dias = diasDesde(dnaMeta.updated_at);

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-5xl space-y-12">
        {/* HEADER */}
        <section className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="relative">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden border border-border bg-surface flex items-center justify-center gold-glow">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Tu Travel Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="font-display text-5xl text-primary">{initial}</span>
              )}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Tu Travel Avatar</p>
            <h1 className="font-display text-3xl md:text-4xl mb-2">{fullName || "Viajero"}</h1>
            <p className="text-muted-foreground mb-4">
              {avatarUrl
                ? "Este avatar te representa en todo IATOS: perfil, viajes, social y compatibilidad."
                : "Crea tu Travel Avatar estilo Pixar. Aparecerá en todo IATOS."}
            </p>
            <Button onClick={() => setOpenAvatar(true)} className="bg-gradient-gold text-primary-foreground gold-glow">
              <Wand2 className="w-4 h-4 mr-2" />
              {avatarUrl ? "Cambiar mi avatar" : "Crear mi avatar"}
            </Button>
          </div>
        </section>

        {/* TRAVEL DNA — HERO */}
        <section className="glass-card rounded-3xl p-6 md:p-8 border border-primary/20 gold-glow space-y-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2 flex items-center gap-2">
                <Crown className="w-3 h-3" /> Tu identidad de viajero
              </p>
              <h2 className="font-display text-3xl md:text-5xl">Tu Travel DNA</h2>
              <p className="text-xs md:text-sm gold-text mt-2">
                Evoluciona con cada viaje
                {dnaMeta.version != null && <> · Versión {dnaMeta.version}</>}
                {dias != null && <> · Actualizado hace {dias} {dias === 1 ? "día" : "días"}</>}
              </p>
            </div>
            <Button
              onClick={evolucionar}
              disabled={evolving}
              className="bg-gradient-gold text-primary-foreground gold-glow"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${evolving ? "animate-spin" : ""}`} />
              {evolving ? "Recalculando…" : "✨ Recalcular mi Travel DNA"}
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* AVATAR CINEMATICO */}
            <div className="lg:col-span-2">
              <TravelAvatarCinematic dna={dna} />
              <p className="text-xs text-muted-foreground mt-2 px-1">
                {dna
                  ? `${dna.tripCount} viajes · ${dna.visitCount} lugares · DNA evoluciona con cada experiencia`
                  : "Cargando tu identidad..."}
              </p>
            </div>

            {/* DNA STATS */}
            <div className="glass-card rounded-3xl p-5">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Travel DNA
              </p>
              {dna ? (
                <TravelDNAStats stats={dna.stats} />
              ) : (
                <p className="text-xs text-muted-foreground">Cargando…</p>
              )}
            </div>

            {/* EVOLUCIÓN */}
            <div className="glass-card rounded-3xl p-5 lg:col-span-2 border border-primary/15">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3" /> Evolución detectada
              </p>
              <p className="text-sm md:text-base leading-relaxed text-foreground/90">{evolucionMsg}</p>
              {divergencias.length > 1 && (
                <ul className="mt-3 text-xs text-muted-foreground list-disc pl-4 space-y-1">
                  {divergencias.slice(1, 4).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* COMPATIBILIDAD */}
            <div className="glass-card rounded-3xl p-5">
              <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-3">Compatibilidad de viaje</p>
              <CompatibilityPanel />
            </div>

            {/* MEJORES MOMENTOS */}
            <div className="glass-card rounded-3xl p-5 lg:col-span-3">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <p className="text-[10px] tracking-[0.3em] text-primary uppercase">Mejores momentos</p>
                <p className="text-[10px] text-muted-foreground">
                  Sube fotos de tus mejores viajes — IATOS construirá tu galería
                </p>
              </div>
              <BestMomentsPanel />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Tu DNA se recalcula automáticamente cada 3 viajes. Si quieres forzarlo ahora, presiona aquí.
          </p>
        </section>

        {/* PERFIL DE GUSTOS */}
        <section>
          <h2 className="font-display text-2xl md:text-3xl mb-3">Perfil de gustos</h2>
          <p className="text-muted-foreground mb-6">
            Actualiza tus preferencias y la IA recalibrará todas las recomendaciones.
          </p>
          <Button
            onClick={() => navigate("/onboarding/deep")}
            variant="outline"
            className="border-primary/40 hover:bg-primary/10"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Editar mis preferencias
          </Button>
        </section>

        {/* BÓVEDA */}
        <section>
          <div className="mb-6">
            <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Premium</p>
            <h2 className="font-display text-3xl md:text-4xl mb-2">Bóveda de Beneficios</h2>
            <p className="text-muted-foreground">
              Guarda tus tarjetas, alianzas y programas de lealtad. IATOS AI los usará para encontrarte tarifas y
              privilegios que otros no ven.
            </p>
          </div>
          <BenefitsVault />
        </section>

        {/* PROMOCIONES */}
        <section>
          <PromocionesActivas />
        </section>

        <section className="pt-6 border-t border-white/[0.06] flex justify-center">
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate("/");
            }}
            className="rounded-full border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/[0.04] gap-2 px-6"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </Button>
        </section>
      </div>

      <Dialog open={openAvatar} onOpenChange={setOpenAvatar}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-background border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Tu Travel Avatar</DialogTitle>
          </DialogHeader>
          <AvatarCreator
            onComplete={async (url) => {
              if (url && user) {
                const { error } = await (supabase as any)
                  .from("profiles")
                  .update({ avatar_url: url })
                  .eq("id", user.id);
                if (error) {
                  toast.error("No se pudo guardar el avatar");
                } else {
                  setAvatarUrl(url);
                  toast.success("¡Avatar actualizado en todo IATOS!");
                }
              }
              setOpenAvatar(false);
            }}
            onSkip={() => setOpenAvatar(false)}
          />
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Profile;
