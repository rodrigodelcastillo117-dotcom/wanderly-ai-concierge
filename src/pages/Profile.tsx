import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardLayout } from "@/components/DashboardLayout";
import BenefitsVault from "@/components/BenefitsVault";
import PromocionesActivas from "@/components/PromocionesActivas";
import AvatarCreator from "@/components/AvatarCreator";
import { Sparkles, LogOut, Wand2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Profile = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string>("");
  const [openAvatar, setOpenAvatar] = useState(false);

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
    })();
  }, [user]);

  const initial = (fullName?.[0] ?? "V").toUpperCase();

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-4xl space-y-12">
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

        <section>
          <h2 className="font-display text-2xl md:text-3xl mb-3">Perfil de gustos</h2>
          <p className="text-muted-foreground mb-6">Actualiza tus preferencias y la IA recalibrará todas las recomendaciones.</p>
          <Button onClick={() => navigate("/onboarding")} variant="outline" className="border-primary/40 hover:bg-primary/10">
            <Sparkles className="w-4 h-4 mr-2" />
            Editar mis preferencias
          </Button>
        </section>

        <section>
          <div className="mb-6">
            <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Premium</p>
            <h2 className="font-display text-3xl md:text-4xl mb-2">Bóveda de Beneficios</h2>
            <p className="text-muted-foreground">Guarda tus tarjetas, alianzas y programas de lealtad. IATOS AI los usará para encontrarte tarifas y privilegios que otros no ven.</p>
          </div>
          <BenefitsVault />
        </section>

        <section>
          <PromocionesActivas />
        </section>

        <section className="pt-6 border-t border-white/[0.06] flex justify-center">
          <Button
            variant="outline"
            onClick={async () => { await signOut(); navigate("/"); }}
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
