// Vuelo sin precio en vivo (caso Álvaro, 28-oct-2026): el motivo en español simple, la tarifa de
// referencia de Aviasales (con su fecha y fuente) y "Consultar precio en vivo", que usa la bolsa de
// búsquedas del usuario (flights-search sin firma de análisis). Google Flights queda como opción aparte
// (el botón de compra del paso). Nada se suma al total ni se inventa.
import { useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toastFunctionError } from "@/lib/functionErrors";
import { flightNoLiveInfo, liveQuoteOutcome, referenceLine, type LiveQuoteOutcome } from "@/lib/flightLiveQuote";
import type { Invoke } from "@/lib/realFares";
import { SlowLoading } from "@/components/brand/SlowLoading";

const defaultInvoke: Invoke = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>;
const btn = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-3 text-sm text-foreground transition hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const link = "inline-flex min-h-[36px] items-center gap-1 text-xs text-primary underline-offset-2 hover:underline";

/** Cuerpo JSON de un error de la función (p. ej. 400 "no_iata" con su pregunta). */
async function errorBody(error: any): Promise<Record<string, any> | null> {
  const ctx = error?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try { return await (typeof ctx.clone === "function" ? ctx.clone() : ctx).json(); } catch { return null; }
}

export function FlightLiveQuote({ trip, invoke = defaultInvoke, className = "" }: { trip: any; invoke?: Invoke; className?: string }) {
  const info = flightNoLiveInfo(trip);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<LiveQuoteOutcome | null>(null);
  const roundTrip = !!info.body?.return_date;
  const run = async () => {
    if (busy || !info.body) return;
    setBusy(true);
    try {
      const { data, error } = await invoke("flights-search", { body: info.body });
      if (error) {
        const b = await errorBody(error);
        if (b?.error === "no_iata") setRes(liveQuoteOutcome(b, roundTrip));
        // FREE_LIMIT_REACHED abre el diálogo de límite; lo demás, un aviso.
        else await toastFunctionError(error, "No pudimos consultar el precio en vivo. Intenta de nuevo.");
        return;
      }
      setRes(liveQuoteOutcome(data, roundTrip));
    } finally {
      setBusy(false);
    }
  };
  const ref = res?.kind === "sin_precio" ? res.referencia ?? info.referencia : info.referencia;
  return (
    <div className={`mt-2 rounded-lg border border-border/60 p-3 ${className}`} data-testid="vuelo-sin-vivo">
      {!res && <p className="text-sm" data-testid="vuelo-motivo">{info.texto}</p>}
      {info.destinoNota && <p className="mt-1 text-xs text-muted-foreground" data-testid="vuelo-destino-nota">{info.destinoNota}</p>}
      {res?.kind === "precio" && (
        <div role="status" data-testid="vuelo-vivo-resultado">
          <p className="text-sm font-medium tabular-nums">Desde ${res.precioPpUsd.toLocaleString("es-MX")} USD por persona{res.aerolinea ? ` · ${res.aerolinea}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{res.nota}</p>
          {res.url && <a className={link} href={res.url} target="_blank" rel="noopener noreferrer">Ver este vuelo <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
        </div>
      )}
      {res?.kind === "sin_precio" && <p role="status" className="text-sm" data-testid="vuelo-vivo-motivo">{res.texto}</p>}
      {ref && (
        <p className="mt-1.5 text-xs text-muted-foreground" data-testid="vuelo-referencia">
          {referenceLine(ref)}
          {ref.link && <> <a className={link} href={ref.link} target="_blank" rel="noopener noreferrer">Ver en Aviasales <ExternalLink className="h-3 w-3" aria-hidden="true" /></a></>}
        </p>
      )}
      {info.body ? (
        res?.kind !== "precio" && (
          <div className="mt-2">
            <button type="button" className={btn} onClick={run} disabled={busy} data-testid="vuelo-consultar-vivo">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              Consultar precio en vivo
            </button>
            <SlowLoading active={busy} size="sm" className="justify-start" label="Consultando Google Flights…" />
            <p className="mt-1 text-[11px] text-muted-foreground">Usa una de tus búsquedas en vivo. Si no hay cupo hoy, te lo decimos.</p>
          </div>
        )
      ) : (
        info.pregunta && <p className="mt-1.5 text-xs text-amber-400/90" data-testid="vuelo-pregunta">{info.pregunta}</p>
      )}
    </div>
  );
}
