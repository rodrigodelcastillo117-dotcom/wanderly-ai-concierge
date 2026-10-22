import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Check, Loader2, Siren, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { localISODate } from "@/lib/localDate";
import { readPriveSession } from "@/lib/priveSession";
import { buildIcs, type ProposedAction, type CalendarEvent } from "../../../supabase/functions/concierge-chat/actions.ts";
import { newIdemKey } from "../../../supabase/functions/_shared/idempotency.ts";

// Tarjeta de acción de Iato (Concierge 2.0): "Iato propone, tú confirmas". El resumen lo arma el
// servidor con los datos validados; al tocar Confirmar el servidor vuelve a validar permisos, viaje y
// límites del plan antes de ejecutar. Nada se reserva: las solicitudes al Fixer quedan "solicitado".

type State = "idle" | "running" | "done" | "error" | "cancelled";

const browserTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

/** Descarga un .ics con los eventos (corre en el navegador, sin servidor). */
export function downloadIcs(events: CalendarEvent[], name = "iatos-itinerario.ics") {
  const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ActionCard({ action, tripId, onOpenEmergency }: { action: ProposedAction; tripId?: string | null; onOpenEmergency?: () => void }) {
  const navigate = useNavigate();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // AUD-SEG-05: una clave por tarjeta; "Reintentar" manda la misma y el servidor no repite la acción.
  const [idemKey] = useState(newIdemKey);

  const confirm = async () => {
    if (action.runs === "client") {
      if (action.type === "export_calendar") {
        downloadIcs((action.params.events as CalendarEvent[]) ?? []);
        setState("done");
        setMessage("Listo: descargué el archivo .ics. Ábrelo para agregarlo a tu calendario.");
      } else if (action.type === "open_emergency") {
        onOpenEmergency?.();
        setState("idle");
      }
      return;
    }
    setState("running");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const ps = readPriveSession(sess.session?.user?.id)?.token;
      const { data, error } = await supabase.functions.invoke("concierge-chat", {
        headers: ps ? { "x-prive-session": ps } : undefined,
        body: { mode: "action", action: { type: action.type, params: action.params }, trip_id: tripId ?? null, client_date: localISODate(), tz: browserTimeZone(), idempotency_key: idemKey },
      });
      if (error) {
        const { readFunctionError } = await import("@/lib/functionErrors");
        // 422 trae el motivo en lenguaje claro (validación de la acción).
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.clone === "function" ? await ctx.clone().json().catch(() => null) : null;
        const info = await readFunctionError(error, "No pude completar la acción.");
        setState("error");
        setMessage(typeof body?.message === "string" ? body.message : info.message);
        return;
      }
      setState(data?.ok ? "done" : "error");
      setMessage(String(data?.message ?? (data?.ok ? "Listo." : "No pude completar la acción.")));
      if (typeof data?.link === "string" && data.link.startsWith("/")) setLink(data.link);
    } catch {
      setState("error");
      setMessage("No pude conectar. Revisa tu internet e intenta de nuevo.");
    }
  };

  if (state === "cancelled") return null;
  const Icon = action.type === "open_emergency" ? Siren : action.type === "export_calendar" ? CalendarPlus : Sparkles;
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4" data-card-type="action" data-action-type={action.type}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-[0.25em] uppercase text-primary mb-1">Iato propone</p>
          <p className="text-sm leading-snug">{action.summary}</p>
          {action.note && <p className="text-[11px] text-muted-foreground mt-1">{action.note}</p>}
          {message && (
            <p role="status" className={`text-xs mt-2 ${state === "error" ? "text-destructive" : "text-foreground"}`}>
              {message}
              {link && (
                <button type="button" onClick={() => navigate(link)} className="ml-1 text-primary underline underline-offset-2">Ver</button>
              )}
            </p>
          )}
          {state !== "done" && (
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={confirm} disabled={state === "running"}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-gold text-primary-foreground px-4 min-h-[40px] text-sm font-medium disabled:opacity-60">
                {state === "running" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                {state === "error" ? "Reintentar" : action.confirm_label || "Confirmar"}
              </button>
              <button type="button" onClick={() => setState("cancelled")} disabled={state === "running"}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 min-h-[40px] text-sm text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" aria-hidden="true" /> Cancelar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
