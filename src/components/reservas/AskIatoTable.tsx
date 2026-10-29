// "Pedir mesa con Iato" en las tarjetas de restaurante (Reservas IA). Solo aparece si el servidor dice
// que Reservas IA está disponible para este usuario (status.enabled: bandera + piloto; una consulta por
// sesión). Formulario corto (fecha, hora, personas, notas) → create_intent → preview → confirm_send.
// Nada se envía sin que el usuario pulse "Enviar al restaurante".
import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { localISODate } from "@/lib/localDate";
import { type AiReservationDraft, aiReservationsEnabled, createAiReservationIntent } from "@/lib/aiReservations";
import { isGooglePlaceId } from "../../../supabase/functions/concierge-chat/actions.ts";
import { newIdemKey } from "../../../supabase/functions/_shared/idempotency.ts";
import { AiReservationSend } from "./AiReservationSend";
import { IatoName } from "@/lib/iatoMark";

const field = "w-full rounded-xl border border-white/15 bg-black/30 px-3 min-h-[40px] text-sm text-foreground focus:border-primary focus:outline-none";

export function AskIatoTable({ placeId, name, city, tripId, defaultParty }: {
  placeId?: string | null; name: string; city?: string | null; tripId?: string | null; defaultParty?: number;
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [party, setParty] = useState(String(Math.min(20, Math.max(1, defaultParty ?? 2))));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiReservationDraft | null>(null);
  // Una clave por formulario: "Reintentar" no crea otra solicitud.
  const [idem, setIdem] = useState(() => `card:${newIdemKey()}`);
  const validPlace = isGooglePlaceId(placeId);

  useEffect(() => {
    if (!validPlace) return;
    let alive = true;
    void aiReservationsEnabled().then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, [validPlace]);

  if (!validPlace || !enabled) return null;

  const n = Number(party);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && Number.isInteger(n) && n >= 1 && n <= 20;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const r = await createAiReservationIntent({
      venue: { name, place_id: placeId!, city: city ?? null }, datetime_local: `${date}T${time}`, party_size: n,
      notes, trip_id: tripId ?? null, source: "usuario", idempotency_key: idem,
    });
    setBusy(false);
    if (!r.ok || !r.reservation) { setError(r.message ?? "No pudimos preparar la solicitud. No se envió nada."); return; }
    setDraft({ reservation: r.reservation, preview: r.preview ?? null, confirm_prompt: r.confirm_prompt ?? r.reservation.confirm_prompt, next: r.next ?? null });
  };

  const close = (v: boolean) => {
    setOpen(v);
    if (!v && draft) { setDraft(null); setIdem(`card:${newIdemKey()}`); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="pedir-mesa-iato"
        className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-primary/60 px-3 text-[11px] text-primary transition hover:bg-primary/10">
        <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Pedir mesa con <IatoName />
      </button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto rounded-2xl border-primary/30 p-4">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Pedir mesa en {name}</DialogTitle>
            <DialogDescription className="text-xs">
              <IatoName /> le escribe al restaurante por correo en tu nombre. Primero verás el correo; nada se envía sin tu confirmación.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <AiReservationSend draft={draft} />
          ) : (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>Fecha</span>
                  <input type="date" required min={localISODate()} value={date} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Fecha" />
                </label>
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>Hora (del lugar)</span>
                  <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={field} aria-label="Hora" />
                </label>
              </div>
              <label className="block text-xs text-muted-foreground space-y-1">
                <span>Personas</span>
                <input type="number" min={1} max={20} required value={party} onChange={(e) => setParty(e.target.value)} className={field} aria-label="Personas" />
              </label>
              <label className="block text-xs text-muted-foreground space-y-1">
                <span>Notas (opcional)</span>
                <textarea value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} className={`${field} py-2`} aria-label="Notas"
                  placeholder="Aniversario, alergias, terraza…" />
              </label>
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              <button type="submit" disabled={!ready || busy}
                className="inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-gradient-gold text-sm font-medium text-primary-foreground disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                {busy ? "Buscando el correo oficial…" : "Preparar el correo"}
              </button>
              <p className="text-[10px] text-muted-foreground">Aún no está reservado: solo cuenta cuando el restaurante lo confirma por escrito.</p>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AskIatoTable;
