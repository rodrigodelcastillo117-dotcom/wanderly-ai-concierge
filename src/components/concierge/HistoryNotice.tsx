import { History } from "lucide-react";

/**
 * Aviso dentro del hilo cuando el historial guardado se resumió (auditoría 10, ronda 3, N-P2-4): al
 * recargar ya no desaparecen preguntas sin explicación.
 */
export function HistoryNotice({ text }: { text: string }) {
  return (
    <div className="flex justify-center" role="note" data-testid="history-summary-notice">
      <p className="inline-flex max-w-[90%] items-start gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] leading-snug text-muted-foreground">
        <History className="mt-px h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
        <span>{text}</span>
      </p>
    </div>
  );
}

export default HistoryNotice;
