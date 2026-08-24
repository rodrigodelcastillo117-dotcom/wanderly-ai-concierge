import { Link } from "react-router-dom";
import { Crown, Lock } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

type Props = {
  children: React.ReactNode;
  /** Si es true, muestra el contenido igual (versión limitada) con un aviso arriba. */
  soft?: boolean;
  title?: string;
  description?: string;
};

export const ProGate = ({ children, soft = false, title, description }: Props) => {
  const { loading, isPro, access } = useSubscription();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (isPro) return <>{children}</>;

  if (soft) {
    return (
      <>
        <div className="glass-card rounded-2xl p-4 mb-5 flex items-start gap-3 border border-primary/20">
          <Crown className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium mb-0.5">Estás en la versión gratuita</p>
            <p className="text-muted-foreground text-xs">
              Te quedan {access?.concierge_remaining ?? 0} mensajes del Concierge este mes y{" "}
              {access?.trips_remaining ?? 0} análisis de viaje.{" "}
              <Link to="/dashboard/pro" className="text-primary underline underline-offset-2">
                Activa IATOS PRO
              </Link>{" "}
              para acceso ilimitado.
            </p>
          </div>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-8 text-center max-w-lg mx-auto">
      <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
        <Lock className="w-5 h-5 text-primary" />
      </div>
      <h2 className="font-display text-2xl mb-2">{title ?? "Función exclusiva de IATOS PRO"}</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {description ?? "Activa tu membresía para desbloquear esta experiencia. 30 días de prueba, luego $99 MXN al mes."}
      </p>
      <Link
        to="/dashboard/pro"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-gold text-primary-foreground text-sm font-medium"
      >
        <Crown className="w-4 h-4" /> Ver IATOS PRO
      </Link>
    </div>
  );
};
