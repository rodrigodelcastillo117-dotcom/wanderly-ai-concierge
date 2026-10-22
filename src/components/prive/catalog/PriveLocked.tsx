import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import type { PriveErrorCode } from "@/lib/priveApi";
import { PRIVE } from "./theme";
import { usePriveT } from "@/components/prive/PriveLang";

/** Pantalla cuando el servidor no da acceso. No muestra contenido; manda al candado de Privé. */
export function PriveLocked({ code }: { code?: PriveErrorCode | null }) {
  const t = usePriveT();
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center" role="status" data-testid="prive-locked">
      <Lock className={`h-8 w-8 ${PRIVE.gold}`} aria-hidden="true" />
      <h1 className={`${PRIVE.serif} text-2xl`}>IATOS Privé</h1>
      <p className={`max-w-sm text-sm ${PRIVE.muted}`}>{(code && t.catalog.locked[code]) ?? t.catalog.lockedDefault}</p>
      <Link to="/prive" className={`rounded-full px-5 py-2 text-sm ${PRIVE.button}`}>{t.common.goPrive}</Link>
    </section>
  );
}
