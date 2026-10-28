import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import type { PriveErrorCode, PriveStatus } from "@/lib/priveApi";
import type { PriveView } from "@/lib/priveView";
import type { PriveText } from "@/lib/priveI18n";
import { PRO_PATH } from "@/lib/functionErrors";
import { PRIVE } from "./theme";
import { usePriveT } from "@/components/prive/PriveLang";
import { usePriveAccessOptional } from "@/hooks/priveAccessContext";

type Cta = { to: string; label: string };

/**
 * Por qué esta cuenta no ve la sección y qué puede hacer, según su estado real (prive_status). Antes
 * todas las áreas decían "Desbloquea IATOS Privé para ver esta selección." aunque la cuenta no pudiera
 * desbloquear nada (auditoría 28-oct, P2).
 */
export function lockedCopy(t: PriveText, view: PriveView | null, status: PriveStatus | null, code?: PriveErrorCode | null): { text: string; cta: Cta } {
  const L = t.catalog.lockedFor;
  const C = t.catalog.lockedCta;
  const toStatus: Cta = { to: "/prive", label: C.status };
  switch (view) {
    case "teaser":
      return { text: L.teaser, cta: { to: PRO_PATH, label: C.pro } };
    case "progress":
      if (status?.pro_basis === "comped") return { text: L.comped, cta: toStatus };
      return { text: L.progress(status?.tenure_days ?? 0, status?.required_days ?? 90), cta: { to: "/prive", label: C.progress } };
    case "preparing":
      return { text: L.preparing, cta: toStatus };
    case "invitation":
    case "set_password":
      return { text: L.invitation, cta: { to: "/prive/invitacion", label: C.invitation } };
    case "paused_pro":
    case "paused_tenure":
      return { text: L.paused, cta: toStatus };
    case "revoked":
      return { text: t.catalog.locked.PRIVE_REVOKED ?? t.catalog.lockedDefault, cta: toStatus };
    case "locked":
    case "must_reset":
      return { text: L.signIn, cta: { to: "/prive", label: C.enter } };
    default:
      return { text: (code && t.catalog.locked[code]) ?? t.catalog.lockedDefault, cta: { to: "/prive", label: t.common.goPrive } };
  }
}

/** Pantalla cuando el servidor no da acceso. No muestra contenido; explica el estado y lleva a donde sirve. */
export function PriveLocked({ code, view, status }: { code?: PriveErrorCode | null; view?: PriveView | null; status?: PriveStatus | null }) {
  const t = usePriveT();
  const access = usePriveAccessOptional();
  const { text, cta } = lockedCopy(t, view ?? access?.view ?? null, status ?? access?.status ?? null, code);
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center" role="status" data-testid="prive-locked">
      <Lock className={`h-8 w-8 ${PRIVE.gold}`} aria-hidden="true" />
      <h1 className={`${PRIVE.serif} text-2xl`}>IATOS Privé</h1>
      <p className={`max-w-sm text-sm ${PRIVE.muted} prive-nums`} data-testid="prive-locked-text">{text}</p>
      <Link to={cta.to} className={`rounded-full px-5 py-2 text-sm ${PRIVE.button}`}>{cta.label}</Link>
    </section>
  );
}
