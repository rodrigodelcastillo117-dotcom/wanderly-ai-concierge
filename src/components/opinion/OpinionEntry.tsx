// Entradas discretas a "¿Algo no se entiende? Cuéntanos" (pedido del dueño: "no muy llamativo", sin botón
// flotante): una opción en el menú y un enlace de texto pequeño y gris al pie de las pantallas. El diálogo
// vive una sola vez (OpinionHost, en DashboardLayout) y su código se descarga solo al abrirlo.
// Las pantallas que no usan el layout principal (Equipaje, Mapa, Viaje en vivo, Wrapped, preferencias)
// ponen <StandaloneOpinion />: el mismo enlace con su propio anfitrión (ronda 3, P2-3).
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { onOpenOpinion, openOpinion } from "@/lib/opinionBus";

const OpinionDialog = lazy(() => import("./OpinionDialog"));

export const OPINION_CTA = "¿Algo no se entiende? Cuéntanos";

export function OpinionHost() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => onOpenOpinion(() => { setMounted(true); setOpen(true); }), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <OpinionDialog open={open} onOpenChange={setOpen} pathname={pathname} />
    </Suspense>
  );
}

/** Enlace de texto al pie de la pantalla: pequeño, gris, sin competir con las acciones principales. */
export function OpinionFooterLink({ className = "" }: { className?: string }) {
  return (
    <div className={`flex justify-center px-4 pt-8 pb-2 ${className}`}>
      <button type="button" onClick={openOpinion} data-testid="opinion-footer-link" aria-haspopup="dialog"
        className="min-h-[44px] px-2 text-xs text-muted-foreground/80 underline-offset-4 hover:text-foreground hover:underline transition-colors">
        {OPINION_CTA}
      </button>
    </div>
  );
}

/** Enlace al pie + anfitrión del diálogo, para las pantallas que no están dentro de DashboardLayout. */
export function StandaloneOpinion({ className = "" }: { className?: string }) {
  return (
    <>
      <OpinionFooterLink className={className} />
      <OpinionHost />
    </>
  );
}
