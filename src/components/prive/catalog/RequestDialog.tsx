import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PriveLockedError, usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { requestedForIso } from "@/lib/priveCatalogView";
import { usePriveT } from "@/components/prive/PriveLang";

/** Solicitar con Iato: crea una SOLICITUD que revisa el equipo. Nunca dice "reservado". */
export function RequestDialog({ e, open, onOpenChange, tripId, onLocked }: {
  e: PriveExperience; open: boolean; onOpenChange: (v: boolean) => void; tripId?: string | null; onLocked: (code: PriveLockedError["code"]) => void;
}) {
  const api = usePriveCatalog();
  const t = usePriveT();
  const T = t.catalog.request;
  const [date, setDate] = useState("");
  const [time, setTime] = useState("20:00");
  const [party, setParty] = useState(2);
  const [prefs, setPrefs] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setState("sending"); setError(null);
    try {
      await api.request({ experienceId: e.id, title: e.name, requestedFor: requestedForIso(date, time, e.destination?.timezone),
        partySize: party, preferences: prefs || null, tripId: tripId ?? null });
      setState("sent");
    } catch (err) {
      if (err instanceof PriveLockedError) { onLocked(err.code); return; }
      setState("error");
      setError(String((err as Error)?.message ?? "") === "AGE_CONFIRMATION_REQUIRED"
        ? T.ageFirst : T.error);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{T.desc(e.name)}</DialogDescription>
        </DialogHeader>
        {state === "sent" ? (
          <div className="space-y-2" role="status" data-testid="prive-request-sent">
            <p className="font-medium">{T.sentTitle}</p>
            <p className="text-sm text-muted-foreground">{T.sentBody}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="prq-date">{T.date}</Label><Input id="prq-date" type="date" value={date} onChange={(x) => setDate(x.target.value)} /></div>
              <div><Label htmlFor="prq-time">{T.time}</Label><Input id="prq-time" type="time" value={time} onChange={(x) => setTime(x.target.value)} /></div>
            </div>
            <div><Label htmlFor="prq-party">{T.party}</Label><Input id="prq-party" type="number" min={1} max={30} value={party} onChange={(x) => setParty(Math.max(1, Math.min(30, Number(x.target.value) || 1)))} /></div>
            <div><Label htmlFor="prq-prefs">{T.prefs}</Label><Textarea id="prq-prefs" maxLength={1000} value={prefs} onChange={(x) => setPrefs(x.target.value)} placeholder={T.prefsPh} /></div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button className="w-full" disabled={state === "sending"} onClick={send}>{state === "sending" ? t.common.sending : T.send}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
