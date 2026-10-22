import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveTrip } from "@/hooks/useActiveTrip";
import { tripLabel } from "@/lib/activeTrip";
import { PriveLockedError, usePriveCatalog } from "@/lib/priveCatalogApi";
import { zonedIso } from "../../../../supabase/functions/_shared/privePlanner";
import { usePriveT } from "@/components/prive/PriveLang";

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
  const T = usePriveT().catalog.trip;
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
      setMsg(r.ok ? T.added(r.added) : T.error);
    } catch (err) {
      if (err instanceof PriveLockedError) { onLocked(err.code); return; }
      setMsg(T.error);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{T.desc}</DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm">{T.loading}</p> : trips.length === 0 ? (
          <p className="text-sm">{T.none}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="pat-trip">{T.trip}</Label>
              <select id="pat-trip" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={tripId} onChange={(x) => setTripId(x.target.value)}>
                <option value="">{T.choose}</option>
                {trips.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
              </select>
            </div>
            {askTime && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="pat-date">{T.day}</Label><Input id="pat-date" type="date" value={date} onChange={(x) => setDate(x.target.value)} /></div>
                <div><Label htmlFor="pat-time">{T.time}</Label><Input id="pat-time" type="time" value={time} onChange={(x) => setTime(x.target.value)} /></div>
              </div>
            )}
            {msg && <p className="text-sm" role="status">{msg}</p>}
            <Button className="w-full" disabled={!tripId || busy} onClick={save}>{busy ? T.saving : T.save}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
