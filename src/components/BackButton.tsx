import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

type Props = { fallback?: string; floating?: boolean };

export const BackButton = ({ fallback = "/dashboard", floating = false }: Props) => {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname === "/dashboard" || location.pathname === "/") return null;

  const handleBack = () => {
    // Bridge: vuelve a la pantalla anterior si existe historial; si no, fallback.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  };

  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-background/70 backdrop-blur text-xs text-foreground hover:bg-primary/10 hover:border-primary transition w-fit";

  return (
    <button
      onClick={handleBack}
      className={
        floating
          ? `fixed top-3 left-3 md:top-4 md:left-4 z-50 ${base}`
          : `sticky top-3 left-3 md:top-4 md:left-4 z-40 ml-3 mt-3 md:ml-4 md:mt-4 ${base}`
      }
      aria-label="Volver"
    >
      <ChevronLeft className="w-3.5 h-3.5 text-primary" />
      Volver
    </button>
  );
};
