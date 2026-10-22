import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { emailStatusLabel, HEALTH_STALE_HOURS, isHealthStale } from "@/lib/serviceHealth";

type Check = { name: string; ok: boolean; warn?: string; detail?: string };
type Run = { ran_at: string; ok: boolean; results: Check[]; email_status?: string | null; email_error?: string | null };

/** Último chequeo diario de servicios externos (función health-check). Solo administradores. */
export function ServiceHealthCard() {
  const [run, setRun] = useState<Run | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from("health_checks")
      .select("ran_at, ok, results, email_status, email_error")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setRun((data as unknown as Run) ?? null));
  }, []);

  if (run === undefined) return null;

  return (
    <section className="glass-card rounded-2xl p-5" aria-labelledby="health-title">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 id="health-title" className="font-display text-xl">Estado de los servicios</h2>
        {run && (
          <span className="text-xs text-muted-foreground">
            Revisado {new Date(run.ran_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
      </div>
      {run && isHealthStale(run.ran_at) && (
        <p role="alert" className="flex items-start gap-2 text-sm rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 mb-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <span>
            El último chequeo tiene más de {HEALTH_STALE_HOURS} horas: la tarea diaria dejó de correr.
            Revisa que exista <span className="font-mono">health-check-daily</span> (docs/ops/LEEME.md).
          </span>
        </p>
      )}
      {!run ? (
        <p className="text-sm text-muted-foreground">Todavía no corre el chequeo diario.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-2">
          {run.results.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-sm rounded-lg border border-border/60 p-3">
              {!c.ok ? (
                <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
              ) : c.warn ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
              )}
              <span>
                <span className="sr-only">{!c.ok ? "Falla: " : c.warn ? "Atención: " : "Funciona: "}</span>
                <span className="font-medium">{c.name}</span>
                {(c.warn || c.detail) && (
                  <span className="block text-xs text-muted-foreground">{c.ok ? c.warn ?? c.detail : c.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {run && emailStatusLabel(run.email_status) && (
        <p className="text-xs text-muted-foreground mt-3">
          {emailStatusLabel(run.email_status)}
          {run.email_error ? ` (${run.email_error})` : ""}
        </p>
      )}
    </section>
  );
}
