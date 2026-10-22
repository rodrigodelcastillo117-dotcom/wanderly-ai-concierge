import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import type { PriveErrorCode } from "@/lib/priveApi";
import { PRIVE } from "./theme";

const TEXT: Partial<Record<PriveErrorCode, string>> = {
  PRIVE_NOT_PRO: "IATOS Privé es para miembros con IATOS PRO vigente.",
  PRIVE_NOT_ELIGIBLE: "IATOS Privé se abre después de 90 días de IATOS PRO pagado.",
  PRIVE_NOT_ACTIVATED: "Tu invitación a IATOS Privé está lista: actívala para entrar.",
  PRIVE_REVOKED: "El acceso a IATOS Privé no está activo en esta cuenta. Escríbenos a soporte si crees que es un error.",
  PRIVE_SESSION_EXPIRED: "Tu sesión de Privé terminó. Vuelve a desbloquear para continuar.",
};

/** Pantalla cuando el servidor no da acceso. No muestra contenido; manda al candado de Privé. */
export function PriveLocked({ code }: { code?: PriveErrorCode | null }) {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center" role="status" data-testid="prive-locked">
      <Lock className={`h-8 w-8 ${PRIVE.gold}`} aria-hidden="true" />
      <h1 className={`${PRIVE.serif} text-2xl`}>IATOS Privé</h1>
      <p className={`max-w-sm text-sm ${PRIVE.muted}`}>{(code && TEXT[code]) ?? "Desbloquea IATOS Privé para ver esta selección."}</p>
      <Link to="/prive" className={`rounded-full px-5 py-2 text-sm ${PRIVE.button}`}>Ir a IATOS Privé</Link>
    </section>
  );
}
