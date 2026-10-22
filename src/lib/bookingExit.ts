// Salida al proveedor del Booking Bridge (cierre de auditoría, AUD-04; docs/iatos/cierre/BRIDGE.md).
//  * linkKindLine: qué es exactamente el enlace. Una oferta exacta y una búsqueda general nunca se
//    ven igual (sale de action.mode / action.kind, que fija el resolver y booking-bridge guarda en
//    booking_intents.booking_mode).
//  * exitNotice: booking-go regresa a IATOS con ?salida=<motivo> cuando no deja salir (enlace vencido,
//    destino cambiado o bloqueado, precio por confirmar). Antes nadie leía ese motivo: el usuario
//    caía en la pantalla sin saber por qué.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { BookingAction } from "@/lib/booking";

export function linkKindLine(action: Pick<BookingAction, "mode" | "kind" | "processor" | "label">): string | null {
  if (action.mode === "EXACT_DEEP_LINK") return `Enlace a esta oferta exacta en ${action.processor}.`;
  if (action.kind === "equivalent_search") return `Búsqueda general en ${action.processor}: no es un enlace a esta oferta. Elige la opción ahí.`;
  if (action.kind === "official_booking_page") return `Página de reservas de ${action.processor}: no aparta lugar por sí sola.`;
  if (action.kind === "official_website") return /sin verificar/.test(action.label) ? "Sitio web sin verificar por IATOS." : "Página general del lugar, no una reserva.";
  if (action.kind === "maps_listing") return "Ficha de Google Maps, no una reserva.";
  return null;
}

const EXIT_NOTICES: Record<string, { title: string; description: string }> = {
  enlace_vencido: { title: "El enlace de salida venció", description: "Por seguridad dura 30 minutos. Vuelve a tocar el botón de la opción para continuar." },
  enlace_invalido: { title: "Ese enlace de salida no es válido", description: "Vuelve a tocar el botón de la opción dentro de IATOS." },
  destino_bloqueado: { title: "No te enviamos a ese sitio", description: "El destino guardado cambió o ya no pasa nuestras reglas de seguridad. Vuelve a elegir la opción." },
  comprueba_el_precio: { title: "Primero confirma el precio", description: "Esta opción necesita que compruebes o aceptes el precio antes de salir." },
  no_disponible: { title: "Esa opción ya no está disponible", description: "Elige otra forma de continuar desde la opción." },
};

export function exitNotice(reason: string | null): { title: string; description: string } | null {
  return reason ? EXIT_NOTICES[reason] ?? null : null;
}

/** Muestra (una vez) el motivo con el que booking-go regresó a IATOS y limpia el parámetro. */
export function useBookingExitNotice(): void {
  const [params, setParams] = useSearchParams();
  const reason = params.get("salida");
  useEffect(() => {
    const n = exitNotice(reason);
    if (!reason) return;
    if (n) toast.error(n.title, { description: n.description });
    const next = new URLSearchParams(params);
    next.delete("salida");
    setParams(next, { replace: true });
  }, [reason]); // eslint-disable-line react-hooks/exhaustive-deps
}
