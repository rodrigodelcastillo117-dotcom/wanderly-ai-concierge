import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/components/DashboardLayout";
import BenefitsVault from "@/components/BenefitsVault";
import PromocionesActivas from "@/components/PromocionesActivas";
import { Sparkles, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const Profile = () => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-4xl space-y-12">
        <section>
          <h1 className="font-display text-4xl md:text-5xl mb-3">Perfil de gustos</h1>
          <p className="text-muted-foreground mb-6">Actualiza tus preferencias y la IA recalibrará todas las recomendaciones.</p>
          <Button onClick={() => navigate("/onboarding")} className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow">
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
    </DashboardLayout>
  );
};

export default Profile;
