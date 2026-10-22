// Elegir el viaje donde se agrega un plan. Por omisión, el que Iato usó (o el viaje activo único); con varios
// viajes posibles NO se preselecciona ninguno: la persona elige (nunca otro viaje por error).
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveTrip } from "@/hooks/useActiveTrip";
import { tripLabel } from "@/lib/activeTrip";
import type { KeyText } from "@/lib/priveKeyI18n";

export function TripPickerDialog({ open, onOpenChange, preferredTripId, onPick, busy, message, t }: {
  open: boolean; onOpenChange: (v: boolean) => void; preferredTripId?: string | null; onPick: (tripId: string) => void; busy?: boolean; message?: string | null; t: KeyText;
}) {
  const { trips, resolved, loading } = useActiveTrip({ enabled: open });
  const [tripId, setTripId] = useState("");
  useEffect(() => {
    if (!open || tripId) return;
    const pref = preferredTripId && trips.some((x) => x.id === preferredTripId) ? preferredTripId : resolved.trip?.id ?? "";
    if (pref) setTripId(pref);
  }, [open, preferredTripId, trips, resolved.trip, tripId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.tripChooser}</DialogTitle>
          <DialogDescription>{t.addedTrip}</DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm" role="status">…</p> : trips.length === 0 ? <p className="text-sm">{t.noTrips}</p> : (
          <div className="space-y-3">
            <fieldset className="space-y-2" aria-label={t.tripChooser}>
              {trips.map((tr) => (
                <label key={tr.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm">
                  <input type="radio" name="pk-trip" value={tr.id} checked={tripId === tr.id} onChange={() => setTripId(tr.id)} />
                  {tripLabel(tr)}
                </label>
              ))}
            </fieldset>
            {resolved.reason === "ambiguous" && !preferredTripId && <p className="text-xs text-muted-foreground">{t.tripPick}</p>}
            {message && <p className="text-sm" role="status">{message}</p>}
            <div className="flex gap-2">
              <button type="button" className="flex-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={!tripId || busy} onClick={() => onPick(tripId)}>
                {t.saveToTrip}
              </button>
              <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => onOpenChange(false)}>{t.cancel}</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
