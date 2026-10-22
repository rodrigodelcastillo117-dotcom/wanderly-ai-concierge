import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildSummaryPrompt } from "@/lib/boveda/aiSummary";
import { fmtDate, upcomingTrips, type TripLite } from "@/lib/boveda/alerts";
import { summarizeWithIato } from "@/lib/boveda/api";
import type { VaultItem } from "@/lib/boveda/types";

type Props = { open: boolean; onOpenChange: (o: boolean) => void; items: VaultItem[]; trips: TripLite[] };

/** "Iato, resúmeme mis beneficios para este viaje". Solo programas, niveles y beneficios. */
export function SummarySheet({ open, onOpenChange, items, trips }: Props) {
  const isMobile = useIsMobile();
  const upcoming = useMemo(() => upcomingTrips(trips), [trips]);
  const [tripId, setTripId] = useState<string>("");
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (open) { setText(null); setTripId(upcoming[0]?.id ?? ""); } }, [open, upcoming]);
  const trip = upcoming.find((t) => t.id === tripId) ?? null;
  const { lines } = buildSummaryPrompt(items, trip);

  const run = async () => {
    const { system, prompt } = buildSummaryPrompt(items, trip);
    setLoading(true);
    setText(null);
    try {
      setText(await summarizeWithIato(system, prompt));
    } catch {
      toast.error("Iato no pudo hacer el resumen ahora. Intenta en un momento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={`${isMobile ? "max-h-[92dvh] rounded-t-3xl" : "w-full sm:max-w-md"} overflow-y-auto bg-background border-border/60 p-0`}>
        <div className="p-4 sm:p-5 space-y-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <SheetHeader className="text-left pr-8 space-y-1">
            <SheetTitle className="font-display text-xl flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" aria-hidden="true" /> Iato, resúmeme mis beneficios</SheetTitle>
            <SheetDescription className="text-xs">Qué te sirve de tus membresías, tarjetas y seguros para un viaje.</SheetDescription>
          </SheetHeader>

          <label htmlFor="vs-trip" className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Viaje</label>
          <select id="vs-trip" value={tripId} onChange={(e) => { setTripId(e.target.value); setText(null); }}
            className="w-full h-11 rounded-xl bg-input border border-border px-3 text-sm">
            <option value="">Viajar en general</option>
            {upcoming.map((t) => <option key={t.id} value={t.id}>{t.destino}{t.fecha_salida ? ` · ${fmtDate(t.fecha_salida)}` : ""}</option>)}
          </select>

          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-[12px] text-muted-foreground flex gap-2">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-px" aria-hidden="true" />
            <p>Solo enviamos a la IA el nombre, nivel y beneficios de {lines.length} programa{lines.length === 1 ? "" : "s"}, y el destino y fechas del viaje. Nunca tus documentos, fotos ni números.</p>
          </div>

          <Button onClick={run} disabled={loading || lines.length === 0} className="w-full h-11 rounded-xl bg-gradient-gold text-primary-foreground font-semibold">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <><Sparkles className="w-4 h-4 mr-2" aria-hidden="true" /> Resumir</>}
          </Button>
          {lines.length === 0 && <p className="text-xs text-muted-foreground">Agrega primero una membresía, tarjeta o seguro.</p>}

          {text && (
            <article className="rounded-2xl border border-border/60 bg-surface/70 p-4 text-sm leading-relaxed whitespace-pre-wrap" aria-live="polite" data-testid="vault-summary">
              {text}
            </article>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
