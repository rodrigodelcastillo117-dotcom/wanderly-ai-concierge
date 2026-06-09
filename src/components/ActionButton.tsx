import { useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { welcomePickupsLink, type WelcomePickupsTransferInput } from "@/lib/affiliateLinks";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const FIXER_WHATSAPP = "525543580077";

export type ActionType = "welcome_pickups_transfer" | "fixer_escalation" | "custom_link";

interface ActionButtonProps {
  type: ActionType;
  payload: WelcomePickupsTransferInput & {
    url?: string;
    provider?: string;
    accion?: string;
  };
  userId?: string | null;
  tripId?: string | null;
  label?: string;
  className?: string;
}

function construirMensajeFixer(payload: ActionButtonProps["payload"]): string {
  let msg = `🚖 *Solicitud Transfer IATOS*\n\nNecesito reservar transfer premium:\n\n`;
  if (payload.origen) msg += `📍 *De:* ${payload.origen}\n`;
  if (payload.destino) msg += `📍 *A:* ${payload.destino}\n`;
  if (payload.fecha) msg += `📅 *Fecha:* ${payload.fecha}\n`;
  if (payload.hora) msg += `🕐 *Hora:* ${payload.hora}\n`;
  if (payload.pax) msg += `👥 *Pasajeros:* ${payload.pax}\n`;
  if (payload.vuelo) msg += `✈️ *Vuelo:* ${payload.vuelo}\n`;
  msg += `\n_Enviado desde IATOS AI · ${new Date().toLocaleString("es-MX")}_`;
  return msg;
}

export function ActionButton({
  type,
  payload,
  userId,
  tripId,
  label,
  className = "",
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);
  const lastClick = useRef<number>(0);

  async function handleClick() {
    // Debounce 60s para no duplicar logs por doble tap.
    const now = Date.now();
    const isDuplicate = now - lastClick.current < 60_000;
    lastClick.current = now;

    setLoading(true);
    try {
      let urlFinal = "";
      let provider = "";
      let accion = "";

      if (type === "welcome_pickups_transfer") {
        provider = "welcome_pickups";
        accion = `transfer_${(payload.ciudad ?? "general").toLowerCase()}`;
        urlFinal = welcomePickupsLink(payload);
      } else if (type === "fixer_escalation") {
        provider = "fixer";
        accion = payload.accion ?? "general";
        const numero = FIXER_WHATSAPP.replace(/\D/g, "");
        urlFinal = `https://wa.me/${numero}?text=${encodeURIComponent(construirMensajeFixer(payload))}`;
      } else if (type === "custom_link") {
        urlFinal = payload.url ?? "";
        provider = payload.provider ?? "custom";
        accion = payload.accion ?? "custom";
      }

      if (!urlFinal) throw new Error("URL vacía");

      if (!isDuplicate) {
        try {
          await supabase.from("affiliate_clicks").insert({
            user_id: userId ?? null,
            trip_id: tripId ?? null,
            proveedor: provider,
            accion,
            payload: payload as any,
            url_final: urlFinal,
            user_agent: navigator.userAgent,
          });
        } catch (logErr) {
          console.error("Failed to log affiliate click:", logErr);
        }
      }

      // Sin "noopener,noreferrer" para wa.me: el redirect a api.whatsapp.com
      // dispara COOP y Chrome bloquea popups opener-less.
      const isWhatsapp = urlFinal.includes("wa.me") || urlFinal.includes("whatsapp.com");
      window.open(urlFinal, "_blank", isWhatsapp ? undefined : "noopener,noreferrer");
      toast.success("Abriendo proveedor…");
    } catch (err) {
      console.error("Action error:", err);
      toast.error("Hubo un problema. Te conectamos con tu Fixer.");
      const numero = FIXER_WHATSAPP.replace(/\D/g, "");
      const fallback = `https://wa.me/${numero}?text=${encodeURIComponent(construirMensajeFixer(payload))}`;
      window.open(fallback, "_blank");
    } finally {
      setLoading(false);
    }
  }

  const displayLabel =
    label ??
    (type === "welcome_pickups_transfer"
      ? "Reservar con Welcome Pickups"
      : type === "fixer_escalation"
        ? "Contactar Fixer"
        : "Continuar");

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`w-full bg-gradient-gold text-primary-foreground font-medium py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-50 ${className}`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <>
          {displayLabel}
          <ExternalLink className="w-4 h-4" />
        </>
      )}
    </button>
  );
}
