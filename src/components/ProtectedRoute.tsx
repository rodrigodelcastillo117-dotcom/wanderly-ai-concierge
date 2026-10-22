import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, restoring, retryRestore } = useAuth();
  const { status, isLoading: onbLoading } = useOnboardingStatus();
  const location = useLocation();

  // Red lenta con una sesión guardada: NO es un cierre de sesión. Se avisa y se reintenta
  // (antes, a los 4.5 s se mandaba a /auth y se perdía la pantalla a la que iba).
  if (loading && restoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div role="status" aria-live="polite" className="max-w-sm text-center space-y-4">
          <div className="mx-auto w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" aria-hidden="true" />
          <p className="text-foreground">Recuperando tu sesión…</p>
          <p className="text-sm text-muted-foreground">
            La conexión va lenta. Seguimos intentando; no necesitas volver a iniciar sesión.
          </p>
          <button
            type="button"
            onClick={retryRestore}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full border border-primary/40 text-sm text-foreground hover:bg-primary/10 transition"
          >
            Reintentar ahora
          </button>
        </div>
      </div>
    );
  }

  if (loading || (user && onbLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Force onboarding for users that haven't completed it.
  // Allow access to /onboarding itself and the deep profile builder.
  const path = location.pathname;
  const isOnboardingRoute = path === "/onboarding" || path.startsWith("/onboarding/");
  if (status && !status.completed_onboarding && !isOnboardingRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
};
