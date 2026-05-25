import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/components/DashboardLayout";
import BenefitsVault from "@/components/BenefitsVault";
import PromocionesActivas from "@/components/PromocionesActivas";
import { Sparkles } from "lucide-react";

const Profile = () => {
  const navigate = useNavigate();
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
            <p className="text-muted-foreground">Guarda tus tarjetas, alianzas y programas de lealtad. Wanderly los usará para encontrarte tarifas y privilegios que otros no ven.</p>
          </div>
          <BenefitsVault />
        </section>

        <section>
          <PromocionesActivas />
        </section>
      </div>
    </DashboardLayout>
  );
};

export default Profile;
