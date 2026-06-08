import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const { status, isLoading: onbLoading } = useOnboardingStatus();
  const location = useLocation();

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
