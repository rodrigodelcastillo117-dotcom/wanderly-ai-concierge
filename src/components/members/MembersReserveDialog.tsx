import { useEffect, useId, useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { localISODate } from "@/lib/localDate";

/**
 * Pedir mesa en un lugar de Members Only (auditoría Privé P1-4, 28-oct-2026). Antes un solo toque en
 * "Reservar con Concierge" creaba la solicitud sin fecha, hora ni personas y mandaba un mensaje al chat
 * que decía "Ya pedí mesa". Ahora pide los datos, muestra qué se enviará y solo envía al confirmar.
 */
export type MembersReserveRequest = { fecha: string; hora: string; personas: number; notas: string };

export function validateMembersReserve(r: Partial<MembersReserveRequest>, todayISO: string): string | null {
  if (!r.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) return "Elige la fecha.";
  if (r.fecha < todayISO) return "La fecha ya pasó.";
  if (!r.hora || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.hora)) return "Elige la hora.";
  const n = Number(r.personas);
  if (!Number.isInteger(n) || n < 1 || n > 20) return "Indica cuántas personas (de 1 a 20).";
  return null;
}

const fmtFecha = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : iso;
};

export function MembersReserveDialog({ venue, open, sending, onClose, onConfirm }: {
  venue: { nombre: string; ciudad_display: string } | null;
  open: boolean;
  sending: boolean;
  onClose: () => void;
  onConfirm: (r: MembersReserveRequest) => void;
}) {
  const today = localISODate();
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("21:00");
  const [personas, setPersonas] = useState("2");
  const [notas, setNotas] = useState("");
  const [step, setStep] = useState<"datos" | "confirmar">("datos");
  const [error, setError] = useState<string | null>(null);
  const ids = { f: useId(), h: useId(), p: useId(), n: useId() };

  useEffect(() => {
    if (!open) return;
    setFecha(""); setHora("21:00"); setPersonas("2"); setNotas(""); setStep("datos"); setError(null);
  }, [open, venue?.nombre]);

  if (!venue) return null;
  const req: MembersReserveRequest = { fecha, hora, personas: Number(personas), notas: notas.trim().slice(0, 500) };
  const next = () => {
    const e = validateMembersReserve(req, today);
    setError(e);
    if (!e) setStep("confirmar");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-md border-primary/30 bg-card" data-testid="members-reserve-dialog">
        <DialogTitle className="font-fraunces text-xl">Pedir mesa en {venue.nombre}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Una persona del equipo IATOS la pide por ti, sujeto a disponibilidad. La confirmación depende del lugar: todavía no es una reserva.
        </DialogDescription>
        {step === "datos" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={ids.f} className="text-xs text-muted-foreground">Fecha
                <Input id={ids.f} type="date" min={today} value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1" />
              </label>
              <label htmlFor={ids.h} className="text-xs text-muted-foreground">Hora
                <Input id={ids.h} type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="mt-1" />
              </label>
            </div>
            <label htmlFor={ids.p} className="block text-xs text-muted-foreground">Personas
              <Input id={ids.p} type="number" inputMode="numeric" min={1} max={20} value={personas} onChange={(e) => setPersonas(e.target.value)} className="mt-1" />
            </label>
            <label htmlFor={ids.n} className="block text-xs text-muted-foreground">Nota para el equipo (opcional)
              <Input id={ids.n} value={notas} maxLength={500} placeholder="Ej. terraza, cumpleaños" onChange={(e) => setNotas(e.target.value)} className="mt-1" />
            </label>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button type="button" onClick={next} className="flex-1 rounded-full bg-gradient-gold px-4 py-2 text-sm text-primary-foreground">Revisar solicitud</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="members-reserve-summary">
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
              <p className="font-medium">{venue.nombre} · {venue.ciudad_display}</p>
              <p className="mt-1 text-muted-foreground">{fmtFecha(fecha)} · {hora} · {req.personas} {req.personas === 1 ? "persona" : "personas"}</p>
              {req.notas && <p className="mt-1 text-xs text-muted-foreground">Nota: {req.notas}</p>}
            </div>
            <p className="text-xs text-muted-foreground">Al confirmar se envía al equipo IATOS. Verás su respuesta en Concierge › Mis solicitudes y por correo.</p>
            <div className="flex gap-2">
              <button type="button" disabled={sending} onClick={() => setStep("datos")} className="flex-1 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground">Cambiar</button>
              <button type="button" disabled={sending} onClick={() => onConfirm(req)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-gold px-4 py-2 text-sm text-primary-foreground disabled:opacity-60">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="h-4 w-4" aria-hidden="true" />}
                Confirmar solicitud
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
