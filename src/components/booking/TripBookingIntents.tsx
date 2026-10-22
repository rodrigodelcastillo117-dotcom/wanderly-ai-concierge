// Seguimiento de reservas del viaje (Fase 8): lo que el usuario abrió, solicitó o declaró, con texto
// honesto. Lee booking_intents con RLS (solo las del propio usuario). Si la tabla aún no existe en la
// base (migración sin aplicar), no muestra nada.
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { bridge } from "@/lib/bookingBridgeApi";
import { intentStatusText } from "@/lib/booking";
import { ProofForm } from "./ProofForm";

type Row = { id: string; title: string; state: any; verification: any; processor: string | null; user_report: any; created_at: string; product_type: string };

export function TripBookingIntents({ tripId }: { tripId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [proof, setProof] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).from("booking_intents")
      .select("id, title, state, verification, processor, user_report, created_at, product_type")
      .eq("trip_id", tripId).not("state", "in", "(EXPIRED,CANCELLED)").order("created_at", { ascending: false }).limit(30);
    if (!error) setRows((data as Row[]) ?? []);
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // Al volver del proveedor, refrescar el estado.
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  async function outcome(id: string, o: string) {
    const r = await bridge("mark_returned", { intent_id: id, outcome: o });
    if (!r.ok) toast.error(r.message ?? "No se pudo guardar.");
    void load();
  }
  async function cancel(id: string) {
    const r = await bridge("cancel", { intent_id: id });
    if (!r.ok) toast.error(r.message ?? "No se pudo cancelar.");
    void load();
  }

  if (!rows.length) return null;
  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3 mb-3">
        <ClipboardCheck className="w-5 h-5 text-primary shrink-0" />
        <h2 className="font-display text-lg sm:text-xl">Seguimiento de reservas</h2>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const declared = r.verification === "user_declared";
          return (
            <li key={r.id} className="rounded-xl border border-border/60 bg-surface/40 p-3">
              <p className="text-sm font-medium break-words">{r.title}</p>
              <p className={`text-xs mt-0.5 ${r.state === "CONFIRMED" ? "text-emerald-400" : "text-muted-foreground"}`}>
                {intentStatusText(r.state, r.verification, r.processor ?? "el proveedor")}
                {r.user_report?.confirmation_code ? ` · folio ${r.user_report.confirmation_code}` : ""}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {r.state === "REDIRECTED_TO_PROVIDER" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setProof(r.id)}>Ya reservé</Button>
                    <Button size="sm" variant="ghost" onClick={() => outcome(r.id, "not_completed")}>No la completé</Button>
                  </>
                )}
                {(r.state === "REQUESTED" || (r.state === "PENDING_CONFIRMATION" && !declared)) && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => outcome(r.id, "venue_confirmed")}>Me confirmaron</Button>
                    <Button size="sm" variant="ghost" onClick={() => outcome(r.id, "other_time")}>Otra hora</Button>
                    <Button size="sm" variant="ghost" onClick={() => outcome(r.id, "not_available")}>No disponible</Button>
                  </>
                )}
                {declared && !r.user_report?.confirmation_code && <Button size="sm" variant="outline" onClick={() => setProof(r.id)}>Agregar folio</Button>}
                {r.state !== "CONFIRMED" && r.state !== "FAILED" && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => cancel(r.id)}>Quitar</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Dialog open={!!proof} onOpenChange={(v) => !v && setProof(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar mi reserva</DialogTitle></DialogHeader>
          {proof && <ProofForm intentId={proof} tripId={tripId} onDone={() => { setProof(null); void load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
