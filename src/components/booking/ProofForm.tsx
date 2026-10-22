// "Ya reservé": el usuario registra su número de confirmación (y, si quiere, el comprobante que subió
// a Documentos del viaje). Se guarda como DECLARADA por él, nunca como verificada por el proveedor.
// No se aceptan datos de tarjeta (el servidor y la base también los rechazan).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { bridge } from "@/lib/bookingBridgeApi";

export function ProofForm({ intentId, tripId, onDone }: { intentId: string; tripId: string | null; onDone: (intent?: any) => void }) {
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await bridge("attach_user_proof", { intent_id: intentId, confirmation_code: code.trim(), note: note.trim(), consent });
    setBusy(false);
    if (!r.ok) return toast.error(r.message ?? "No se pudo guardar.");
    toast.success("Guardado como reserva declarada por ti", { description: "Queda sin verificar con el proveedor." });
    onDone(r.intent);
  }

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <label className="block text-sm">
        Número de confirmación o folio
        <Input value={code} maxLength={60} onChange={(e) => setCode(e.target.value)} placeholder="p. ej. ABC123" className="mt-1" />
      </label>
      <label className="block text-sm">
        Nota (opcional)
        <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Hora, nombre de la reserva…" className="mt-1" />
      </label>
      {tripId && <p className="text-xs text-muted-foreground">¿Tienes el PDF o una captura? Súbelo en “Documentos del viaje” como Reserva.</p>}
      <p className="text-xs text-muted-foreground">No escribas datos de tarjeta: IATOS no los necesita ni los guarda.</p>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} aria-label="Acepto guardar el comprobante" />
        <span>Acepto guardar este dato en mi viaje. Se mostrará como “declarada por ti”, no como confirmada por el proveedor.</span>
      </label>
      <Button className="w-full" disabled={busy || !consent || !code.trim()} onClick={submit}>{busy ? "Guardando…" : "Guardar comprobante"}</Button>
    </div>
  );
}
