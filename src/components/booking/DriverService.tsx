// Chofer privado / traslados con conductor (caso Álvaro, 28-oct-2026). Por cotizar, con dos acciones
// reales: pedírselo al equipo (concierge-action "transport", la misma solicitud que usa Iato y que
// llega a la Mesa de operaciones) y, para el traslado del aeropuerto, Welcome Pickups (enlace de
// afiliado que ya existe en affiliateLinks.ts; no recibe datos por enlace). Nunca un precio inventado.
import { CarTaxiFront, ExternalLink } from "lucide-react";
import { RequestButton, useConciergeRequest } from "@/components/concierge/ConciergeCards";
import { prefillLine, welcomePickupsLink } from "@/lib/affiliateLinks";
import { logBookingClick } from "@/lib/trackBooking";
import type { DriverOption } from "@/lib/driverService";

export function DriverService({ driver, tripId, startAt = null, className = "" }: { driver: DriverOption; tripId: string | null; startAt?: string | null; className?: string }) {
  const req = useConciergeRequest(tripId);
  const welcome = welcomePickupsLink({ ciudad: driver.city });
  return (
    <div className={`rounded-lg border p-3 ${driver.recommended ? "border-primary/50 bg-primary/[0.05]" : "border-border/60"} ${className}`} data-testid="chofer-privado" data-recommended={driver.recommended ? "1" : "0"}>
      <p className="flex items-start gap-2 text-sm font-medium">
        <CarTaxiFront className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>Chofer privado / traslados con conductor{driver.recommended ? <span className="ml-1 whitespace-nowrap text-xs font-normal text-primary">· Recomendado</span> : null}</span>
      </p>
      {driver.reason && <p className="mt-0.5 text-xs text-muted-foreground" data-testid="chofer-motivo">{driver.reason}</p>}
      <p className="mt-1 text-xs text-muted-foreground" data-testid="chofer-precio">Por cotizar: IATOS no tiene precio de chofer en {driver.city}. Te lo cotiza una persona del equipo.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <RequestButton state={req.state} label="Pedírselo a Iato / al equipo" onClick={() => void req.run(driver.request)} className="min-h-[40px] text-sm" />
        <a href={welcome} target="_blank" rel="noopener noreferrer" data-testid="chofer-welcome"
          onClick={() => void logBookingClick({ category: "car", provider: "Welcome Pickups", title: `Traslado del aeropuerto · ${driver.city}`, bookingUrl: welcome,
            city: driver.city, tripId, startAt: startAt ?? undefined })}
          className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-primary/40 px-3 py-2 text-sm text-primary">
          Traslado del aeropuerto (Welcome Pickups) <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      {req.state === "confirmed" ? (
        <p className="mt-1 text-[11px] text-muted-foreground" role="status" data-testid="chofer-folio">
          Folio {req.folio}. La atiende una persona del equipo IATOS: verás su respuesta en Concierge › Mis solicitudes y por correo. Todavía no es una reserva.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">
          La solicitud la atiende una persona del equipo (no es una reserva). Welcome Pickups: {prefillLine("welcome")} Revisa que opere en {driver.city}.
        </p>
      )}
    </div>
  );
}
