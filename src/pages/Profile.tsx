import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/components/DashboardLayout";

const Profile = () => {
  const navigate = useNavigate();
  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-2xl">
        <h1 className="font-display text-4xl md:text-5xl mb-4">Perfil de gustos</h1>
        <p className="text-muted-foreground mb-8">Actualiza tus preferencias y la IA recalibrará todas las recomendaciones.</p>
        <Button onClick={() => navigate("/onboarding")} className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow">
          Editar mis preferencias
        </Button>
      </div>
    </DashboardLayout>
  );
};

export default Profile;
