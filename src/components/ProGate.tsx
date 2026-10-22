import { Link } from "react-router-dom";
import { Crown, Lock } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { PRICE_LINE } from "@/lib/planCopy";

type Props = {
  children: React.ReactNode;
  /** Si es true, muestra el contenido igual (versión limitada) con un aviso arriba. */
  soft?: boolean;
  title?: string;
  description?: string;
};

export const ProGate = ({ children, soft = false, title, description }: Props) => {
  const { loading, isPro, access, error, refresh } = useSubscription();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (isPro) return <>{children}</>;

  // Si no pudimos leer el plan (red, servidor), no se muestra la invitación a pagar: un PRO vería
  // un muro de pago por una falla nuestra.
  if (error) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center text-sm" role="alert">
        <p className="mb-3">No pudimos verificar tu plan en este momento.</p>
        <button onClick={() => refresh()} className="text-primary underline underline-offset-2">Reintentar</button>
      </div>
    );
  }

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
              para más mensajes y análisis cada mes.
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
        {description ?? `Disponible en IATOS PRO: ${PRICE_LINE}.`}
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
