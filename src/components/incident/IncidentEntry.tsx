// Entradas discretas a "Tengo un problema": el anfitrión del diálogo (una sola vez, en DashboardLayout; su
// código se descarga al abrirlo) y el enlace pequeño dentro del viaje.
import { lazy, Suspense, useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { INCIDENT_CTA, onOpenIncident, openIncident } from "@/lib/incidentBus";

const IncidentDialog = lazy(() => import("./IncidentDialog"));

export function IncidentHost() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  useEffect(() => onOpenIncident((o) => { setTripId(o.tripId ?? null); setMounted(true); setOpen(true); }), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <IncidentDialog open={open} onOpenChange={setOpen} tripId={tripId} />
    </Suspense>
  );
}

/** Dentro del viaje: enlace pequeño, sin competir con las acciones del viaje. */
export function IncidentTripLink({ tripId, className = "" }: { tripId: string; className?: string }) {
  return (
    <div className={`flex justify-center pt-6 ${className}`}>
      <button type="button" onClick={() => openIncident({ tripId })} aria-haspopup="dialog" data-testid="trip-incident-link"
        className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-xs text-muted-foreground/90 underline-offset-4 hover:text-foreground hover:underline transition-colors">
        <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />{INCIDENT_CTA} en este viaje
      </button>
    </div>
  );
}
