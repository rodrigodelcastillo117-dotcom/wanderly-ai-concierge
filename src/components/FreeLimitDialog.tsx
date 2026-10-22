// Aviso de límite del plan (IATOS-P1-FREE-01). Reemplaza los errores técnicos ("Edge Function
// returned a non-2xx status code", "hubo un tropiezo") por un mensaje claro y dos salidas.
import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { Crown } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { freeLimitCopy, PRO_PATH, type FreeLimitInfo } from "@/lib/functionErrors";
import { closeFreeLimitDialog, getFreeLimitDialog, subscribeFreeLimitDialog } from "@/lib/freeLimitStore";

export function FreeLimitDialog({ info, onClose, onUpgrade }: {
  info: FreeLimitInfo | null;
  onClose: () => void;
  onUpgrade: () => void;
}) {
  const title = !info
    ? ""
    : info.quota === "price_watches_active"
      ? (info.upgradeAvailable && !info.limit ? "Alertas de precio con IATOS PRO" : "Llegaste al máximo de alertas")
    : info.quota === "tracked_flights_active"
      ? "Llegaste al máximo de vuelos seguidos"
    : info.quota.startsWith("live_searches_")
      ? "Usaste tus búsquedas en vivo"
    : !info.upgradeAvailable
      ? "Llegaste al límite de tu plan"
      : info.quota.endsWith("_trial")
        ? "Llegaste al límite de tu prueba"
      : info.quota === "concierge_monthly"
        ? "Usaste tus mensajes gratuitos"
        : "Usaste tu análisis gratuito";
  return (
    <Dialog open={Boolean(info)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription>{info ? freeLimitCopy(info) : ""}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {info?.upgradeAvailable ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-border text-sm hover:border-primary/50 transition"
              >
                Continuar con la versión gratuita
              </button>
              <button
                onClick={onUpgrade}
                className="px-4 py-2.5 rounded-xl bg-gradient-gold text-primary-foreground text-sm font-medium"
              >
                Conocer IATOS PRO
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-border text-sm">
              Entendido
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Se monta una vez dentro del Router (App.tsx). */
export function FreeLimitDialogHost() {
  const info = useSyncExternalStore(subscribeFreeLimitDialog, getFreeLimitDialog, getFreeLimitDialog);
  const navigate = useNavigate();
  return (
    <FreeLimitDialog
      info={info}
      onClose={closeFreeLimitDialog}
      onUpgrade={() => {
        closeFreeLimitDialog();
        navigate(PRO_PATH);
      }}
    />
  );
}
