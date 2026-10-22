import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { backFallback, hasInAppHistory, isTabRoot } from "@/lib/backNavigation";

type Props = { fallback?: string; floating?: boolean };

export const BackButton = ({ fallback, floating = false }: Props) => {
  const navigate = useNavigate();
  const location = useLocation();

  // En las pestañas raíz (Inicio, Mis viajes, Concierge…) "Volver" no tiene sentido.
  if (isTabRoot(location.pathname)) return null;

  const handleBack = () => {
    // Solo regresamos en el historial si la pantalla anterior es de la app; con una entrada
    // directa (enlace de correo, WhatsApp…) navigate(-1) sacaba a la persona de IATOS.
    if (hasInAppHistory(location.key)) {
      navigate(-1);
    } else {
      navigate(fallback ?? backFallback(location.pathname), { replace: true });
    }
  };

  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-background/70 backdrop-blur text-xs text-foreground hover:bg-primary/10 hover:border-primary transition w-fit";

  return (
    <button
      type="button"
      onClick={handleBack}
      className={
        floating
          ? `fixed top-3 left-3 md:top-4 md:left-4 z-50 ${base}`
          : `sticky top-3 left-3 md:top-4 md:left-4 z-40 ml-3 mt-3 md:ml-4 md:mt-4 ${base}`
      }
      aria-label="Volver"
    >
      <ChevronLeft className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
      Volver
    </button>
  );
};
