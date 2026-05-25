import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

export const BackButton = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Hide on home / landing
  if (location.pathname === "/dashboard" || location.pathname === "/") return null;

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/dashboard");
  };

  return (
    <button
      onClick={handleBack}
      className="sticky top-3 left-3 md:top-4 md:left-4 z-40 ml-3 mt-3 md:ml-4 md:mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-background/70 backdrop-blur text-xs text-foreground hover:bg-primary/10 hover:border-primary transition w-fit"
      aria-label="Volver"
    >
      <ChevronLeft className="w-3.5 h-3.5 text-primary" />
      Volver
    </button>
  );
};
