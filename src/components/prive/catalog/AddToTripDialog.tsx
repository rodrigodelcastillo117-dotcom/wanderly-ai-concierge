import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveTrip } from "@/hooks/useActiveTrip";
import { tripLabel } from "@/lib/activeTrip";
import { PriveLockedError, usePriveCatalog } from "@/lib/priveCatalogApi";
import { zonedIso } from "../../../../supabase/functions/_shared/privePlanner";

export type TripItem = { experience_id: string; start_at?: string | null; template?: string | null; transfer_estimate_min?: number | null; name?: string };

/**
 * Agrega una o varias experiencias al viaje (sistema de viajes existente: bookings con trip_id, sin
 * confirmar). El viaje por omisión es el activo (resolveActiveTrip); si hay empate, el usuario elige.
 */
export function AddToTripDialog({ items, open, onOpenChange, timeZone, onLocked, askTime = true }: {
  items: TripItem[]; open: boolean; onOpenChange: (v: boolean) => void; timeZone?: string | null;
  onLocked: (code: PriveLockedError["code"]) => void; askTime?: boolean;
}) {
  const api = usePriveCatalog();
  const { trips, trip, loading } = useActiveTrip({ enabled: open });
  const [tripId, setTripId] = useState<string>("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("20:00");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (trip && !tripId) setTripId(trip.id); }, [trip, tripId]);
  const save = async () => {
    if (!tripId) return;
    setBusy(true); setMsg(null);
    try {
      const payload = items.map((it) => ({ ...it, start_at: it.start_at ?? (askTime && date ? zonedIso(date, time || "20:00", timeZone) : null) }));
      const r = await api.addToTrip(tripId, payload);
      setMsg(r.ok ? `Agregado a tu viaje (${r.added}). Queda como plan sin reservar; para pedirlo usa "Solicitar".` : "No se pudo agregar al viaje.");
    } catch (err) {
      if (err instanceof PriveLockedError) { onLocked(err.code); return; }
      setMsg("No se pudo agregar al viaje.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar a mi viaje</DialogTitle>
          <DialogDescription>Se guarda en el expediente del viaje como plan, no como reserva.</DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm">Cargando tus viajes…</p> : trips.length === 0 ? (
          <p className="text-sm">Aún no tienes viajes. Crea uno en "Planear viaje" y vuelve aquí.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="pat-trip">Viaje</Label>
              <select id="pat-trip" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={tripId} onChange={(x) => setTripId(x.target.value)}>
                <option value="">Elige un viaje</option>
                {trips.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
              </select>
            </div>
            {askTime && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="pat-date">Día (opcional)</Label><Input id="pat-date" type="date" value={date} onChange={(x) => setDate(x.target.value)} /></div>
                <div><Label htmlFor="pat-time">Hora sugerida</Label><Input id="pat-time" type="time" value={time} onChange={(x) => setTime(x.target.value)} /></div>
              </div>
            )}
            {msg && <p className="text-sm" role="status">{msg}</p>}
            <Button className="w-full" disabled={!tripId || busy} onClick={save}>{busy ? "Guardando…" : "Guardar en el viaje"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
