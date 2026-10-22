import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PriveLockedError, usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";

/** Solicitar con Iato: crea una SOLICITUD que revisa el equipo. Nunca dice "reservado". */
export function RequestDialog({ e, open, onOpenChange, tripId, onLocked }: {
  e: PriveExperience; open: boolean; onOpenChange: (v: boolean) => void; tripId?: string | null; onLocked: (code: PriveLockedError["code"]) => void;
}) {
  const api = usePriveCatalog();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("20:00");
  const [party, setParty] = useState(2);
  const [prefs, setPrefs] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setState("sending"); setError(null);
    try {
      await api.request({ experienceId: e.id, title: e.name, requestedFor: date ? `${date}T${time || "20:00"}:00` : null,
        partySize: party, preferences: prefs || null, tripId: tripId ?? null });
      setState("sent");
    } catch (err) {
      if (err instanceof PriveLockedError) { onLocked(err.code); return; }
      setState("error");
      setError(String((err as Error)?.message ?? "") === "AGE_CONFIRMATION_REQUIRED"
        ? "Confirma primero que eres mayor de edad." : "No se pudo enviar la solicitud. Intenta de nuevo.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar con Iato</DialogTitle>
          <DialogDescription>El equipo de IATOS lo gestiona con {e.name}. Es una solicitud, todavía no es una reserva.</DialogDescription>
        </DialogHeader>
        {state === "sent" ? (
          <div className="space-y-2" role="status" data-testid="prive-request-sent">
            <p className="font-medium">Solicitud enviada · aún no es una reserva</p>
            <p className="text-sm text-muted-foreground">Te avisaremos cuando el lugar confirme o si no es posible. La verás en "Mis solicitudes".</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="prq-date">Fecha</Label><Input id="prq-date" type="date" value={date} onChange={(x) => setDate(x.target.value)} /></div>
              <div><Label htmlFor="prq-time">Hora preferida</Label><Input id="prq-time" type="time" value={time} onChange={(x) => setTime(x.target.value)} /></div>
            </div>
            <div><Label htmlFor="prq-party">Personas</Label><Input id="prq-party" type="number" min={1} max={30} value={party} onChange={(x) => setParty(Math.max(1, Math.min(30, Number(x.target.value) || 1)))} /></div>
            <div><Label htmlFor="prq-prefs">Preferencias (opcional)</Label><Textarea id="prq-prefs" maxLength={1000} value={prefs} onChange={(x) => setPrefs(x.target.value)} placeholder="Mesa con vista, aniversario, alergias…" /></div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button className="w-full" disabled={state === "sending"} onClick={send}>{state === "sending" ? "Enviando…" : "Enviar solicitud"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
