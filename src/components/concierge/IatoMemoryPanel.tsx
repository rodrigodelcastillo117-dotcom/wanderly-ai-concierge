import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// "Lo que Iato recuerda de ti" (B-14). La memoria de Iato vive en dos tablas, ambas con RLS que
// solo deja leer y borrar las filas propias:
//   - concierge_conversations: resumen y últimos turnos por viaje (lo que Iato usa al responder).
//   - behavioral_insights (action = "concierge_message"): primeros 500 caracteres de cada mensaje.
// Antes no había forma de verlas ni borrarlas salvo eliminando la cuenta.

type ConvRow = { id: string; trip_id: string | null; resumen_historico: string | null; messages: unknown; updated_at: string };
type InsightRow = { id: string; created_at: string; metadata: any; target_label: string | null };

export interface MemoryItemView { id: string; titulo: string; resumen: string | null; recuerdos: string[]; actualizado: string }

/** Lo que se muestra de una conversación: resumen y lo último que dijo el USUARIO. */
export function conversationView(row: ConvRow, tripName: (id: string | null) => string): MemoryItemView {
  const msgs = Array.isArray(row.messages) ? (row.messages as any[]) : [];
  const recuerdos = msgs
    .filter((m) => m?.role === "user" && typeof m.content === "string" && m.content.trim())
    .slice(-5)
    .map((m) => String(m.content).slice(0, 200));
  return { id: row.id, titulo: tripName(row.trip_id), resumen: row.resumen_historico?.trim() || null, recuerdos, actualizado: row.updated_at };
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "";
};

export function IatoMemoryPanel({ userId, trips }: { userId: string; trips: { id: string; destino?: string | null }[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const tripName = useCallback((id: string | null) => {
    if (!id) return "Conversaciones generales";
    const t = trips.find((x) => x.id === id);
    return t?.destino ? `Viaje a ${t.destino}` : "Viaje";
  }, [trips]);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, i] = await Promise.all([
      supabase.from("concierge_conversations").select("id, trip_id, resumen_historico, messages, updated_at")
        .eq("user_id", userId).order("updated_at", { ascending: false }),
      supabase.from("behavioral_insights").select("id, created_at, metadata, target_label")
        .eq("user_id", userId).eq("action", "concierge_message").order("created_at", { ascending: false }).limit(50),
    ]);
    if (c.error || i.error) toast.error("No pudimos cargar la memoria de Iato");
    setConvs((c.data as ConvRow[]) ?? []);
    setInsights((i.data as InsightRow[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const deleteConv = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from("concierge_conversations").delete().eq("id", id).eq("user_id", userId);
    setBusy(null);
    if (error) return toast.error("No se pudo borrar");
    setConvs((xs) => xs.filter((x) => x.id !== id));
    toast.success("Iato olvidó esa conversación");
  };

  const deleteInsight = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.from("behavioral_insights").delete().eq("id", id).eq("user_id", userId);
    setBusy(null);
    if (error) return toast.error("No se pudo borrar");
    setInsights((xs) => xs.filter((x) => x.id !== id));
  };

  const deleteAll = async () => {
    setBusy("all");
    const [a, b] = await Promise.all([
      supabase.from("concierge_conversations").delete().eq("user_id", userId),
      supabase.from("behavioral_insights").delete().eq("user_id", userId).eq("action", "concierge_message"),
    ]);
    // También se olvidan los conteos de categorías que el concierge sumaba en dna_signal.
    const { data: prefs } = await supabase.from("ai_user_preferences").select("dna_signal").eq("user_id", userId).maybeSingle();
    const sig = (prefs as any)?.dna_signal;
    if (sig && typeof sig === "object" && (sig.categories || sig.last_concierge_at)) {
      const { categories: _c, last_concierge_at: _l, ...rest } = sig;
      await supabase.from("ai_user_preferences").update({ dna_signal: rest }).eq("user_id", userId);
    }
    setBusy(null);
    if (a.error || b.error) return toast.error("No se pudo borrar todo; intenta de nuevo");
    setConvs([]);
    setInsights([]);
    toast.success("Listo: Iato ya no recuerda tus conversaciones");
  };

  const empty = !loading && convs.length === 0 && insights.length === 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition">
          <Brain className="w-3 h-3" /> Lo que Iato recuerda
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">Lo que Iato recuerda de ti</SheetTitle>
          <SheetDescription>
            Iato guarda un resumen de tus conversaciones para no volver a preguntarte lo mismo. Puedes borrar cualquier recuerdo cuando quieras.
          </SheetDescription>
        </SheetHeader>

        {loading && <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</p>}
        {empty && <p className="mt-6 text-sm text-muted-foreground">Iato todavía no guarda nada de tus conversaciones.</p>}

        {convs.length > 0 && (
          <section className="mt-6 space-y-3">
            <h3 className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Conversaciones</h3>
            {convs.map((row) => {
              const v = conversationView(row, tripName);
              return (
                <div key={v.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{v.titulo}</p>
                      <p className="text-[11px] text-muted-foreground">Actualizado {fmt(v.actualizado)}</p>
                    </div>
                    <Button variant="ghost" size="sm" disabled={busy === v.id} onClick={() => deleteConv(v.id)} aria-label={`Borrar ${v.titulo}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  {v.resumen && <p className="mt-2 text-xs whitespace-pre-line text-muted-foreground">{v.resumen.slice(0, 600)}</p>}
                  {v.recuerdos.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-4">
                      {v.recuerdos.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {insights.length > 0 && (
          <section className="mt-6 space-y-2">
            <h3 className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Mensajes que Iato usa para conocerte</h3>
            {insights.map((x) => (
              <div key={x.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs">{String(x.metadata?.msg ?? x.target_label ?? "").slice(0, 200) || "(sin texto)"}</p>
                  <p className="text-[10px] text-muted-foreground">{fmt(x.created_at)}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={busy === x.id} onClick={() => deleteInsight(x.id)} aria-label="Borrar mensaje">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </section>
        )}

        {!empty && !loading && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="mt-6 w-full" disabled={busy === "all"}>
                {busy === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Borrar todo lo que Iato recuerda
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar toda la memoria de Iato?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borran los resúmenes y mensajes guardados de tus conversaciones. Tus viajes, reservas y perfil no se tocan. No se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAll}>Borrar todo</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </SheetContent>
    </Sheet>
  );
}
