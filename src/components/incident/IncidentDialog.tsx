// "Tengo un problema": formulario corto (qué tipo, qué pasó, viaje, ubicación opcional). Al enviar se abre el
// caso, se avisa al equipo de guardia y se muestra lo que la persona puede hacer AHORA, lo que hará el equipo,
// el folio y la hora en que le escribimos. Estados honestos: sin conexión (no se envió; el texto se queda).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Loader2, WifiOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  draftProblem, FORM_CATEGORIES, INCIDENT_CATEGORY_LABEL, INCIDENT_TEXT_MAX, type IncidentCategory, type IncidentDraft, type IncidentSendResult,
  type IncidentSent, newIdemKey, promisedTime, sendIncident,
} from "@/lib/incident";

type TripOption = { id: string; destino: string | null; fecha_salida: string | null };
const EMPTY: IncidentDraft = { categoria: null, descripcion: "", tripId: null, compartirUbicacion: false };

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((res) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      () => res(null), { timeout: 6000, maximumAge: 300000 },
    );
  });
}

export function IncidentDialog({ open, onOpenChange, tripId }: { open: boolean; onOpenChange: (v: boolean) => void; tripId?: string | null }) {
  const { user } = useAuth();
  const [draft, setDraft] = useState<IncidentDraft>({ ...EMPTY, tripId: tripId ?? null });
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<IncidentSendResult | null>(null);
  const idem = useRef(newIdemKey());

  // Al abrir: viaje del contexto y lista corta de viajes (los suyos, más recientes).
  useEffect(() => {
    if (!open) return;
    if (result?.ok) { setDraft({ ...EMPTY, tripId: tripId ?? null }); setResult(null); setTouched(false); idem.current = newIdemKey(); }
    else setDraft((d) => ({ ...d, tripId: tripId ?? d.tripId }));
    if (!user?.id) return;
    void supabase.from("trips").select("id, destino, fecha_salida").eq("user_id", user.id).order("fecha_salida", { ascending: false }).limit(12)
      .then(({ data }) => setTrips(Array.isArray(data) ? (data as TripOption[]) : []), () => setTrips([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [open, tripId, user?.id]);

  const problem = draftProblem(draft);
  const set = (p: Partial<IncidentDraft>) => { setDraft((d) => ({ ...d, ...p })); if (result && !result.ok) setResult(null); };
  const tripLabel = useMemo(() => (t: TripOption) => [t.destino ?? "Viaje", t.fecha_salida?.slice(0, 10)].filter(Boolean).join(" · "), []);

  const submit = async () => {
    setTouched(true);
    if (problem || busy) return;
    setBusy(true);
    const loc = draft.compartirUbicacion ? await getPosition() : null;
    const r = await sendIncident(draft, loc, idem.current);
    setBusy(false);
    setResult(r);
  };

  const sent = result && result.ok ? (result as IncidentSent) : null;
  const failed = result && !result.ok ? (result as Extract<IncidentSendResult, { ok: false }>) : null;
  const hora = promisedTime(sent?.siguientePasoHora);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-md max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl p-5 sm:p-6" data-testid="incident-dialog">
        {sent ? (
          <div className="space-y-4" role="status" data-testid="incident-sent">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                <Check className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="font-display text-2xl leading-tight">Tu caso está abierto</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Folio {sent.folio} · {sent.categoriaLabel}{sent.teamNotified ? " · el equipo ya fue avisado" : " · el aviso al equipo se está reintentando"}
                </DialogDescription>
              </div>
            </div>
            {sent.emergencia ? (
              <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" data-testid="incident-emergency">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />{sent.emergencia}
              </p>
            ) : null}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Ahora mismo</p>
              <ul className="space-y-1.5 text-sm">
                {sent.ahora.map((x) => <li key={x} className="flex gap-2"><span className="text-primary">•</span><span>{x}</span></li>)}
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">{sent.equipo}</p>
            <p className="rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 text-sm" data-testid="incident-next">
              <span className="text-primary">Siguiente paso:</span> {sent.siguientePaso ?? "Te escribimos con el siguiente paso"}{hora ? `, a más tardar a las ${hora}` : ""}. Lo verás en Mis solicitudes y en tu correo.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <Button className="bg-gradient-gold text-primary-foreground hover:opacity-90" onClick={() => onOpenChange(false)}>Listo</Button>
              <Button asChild variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                <Link to="/dashboard/concierge?tab=solicitudes">Ver mis solicitudes</Link>
              </Button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-2xl">Tengo un problema</DialogTitle>
              <DialogDescription>Lo recibe el equipo IATOS de inmediato. Si es una emergencia, llama primero al número de emergencias.</DialogDescription>
            </DialogHeader>

            <div>
              <label htmlFor="incident-cat" className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-2">¿Qué pasó?</label>
              <select id="incident-cat" value={draft.categoria ?? ""} onChange={(e) => set({ categoria: (e.target.value || null) as IncidentCategory | null })}
                aria-invalid={touched && !draft.categoria}
                className="w-full min-h-[44px] rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">Elige el tipo de problema</option>
                {FORM_CATEGORIES.map((c) => <option key={c} value={c}>{INCIDENT_CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="incident-text" className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Cuéntanos</label>
              <Textarea id="incident-text" rows={4} maxLength={INCIDENT_TEXT_MAX} value={draft.descripcion}
                placeholder="Dónde estás, qué pasó y qué necesitas. Ej.: llegué a Cancún y el chofer no está en la salida 3."
                onChange={(e) => set({ descripcion: e.target.value })} aria-invalid={touched && draft.descripcion.trim().length < 3} />
            </div>

            {trips.length > 0 ? (
              <div>
                <label htmlFor="incident-trip" className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Viaje (opcional)</label>
                <select id="incident-trip" value={draft.tripId ?? ""} onChange={(e) => set({ tripId: e.target.value || null })}
                  className="w-full min-h-[44px] rounded-xl border border-white/10 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Sin viaje</option>
                  {trips.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
                </select>
              </div>
            ) : null}

            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <Checkbox checked={draft.compartirUbicacion} onCheckedChange={(v) => set({ compartirUbicacion: v === true })} className="mt-0.5" aria-label="Compartir mi ubicación" />
              <span>
                Compartir mi ubicación (opcional)
                <span className="block text-xs text-muted-foreground">Ayuda al equipo a ubicarte. Siempre enviamos tu zona horaria para saber tu hora local.</span>
              </span>
            </label>

            <div className="sticky bottom-0 z-10 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 space-y-2 border-t border-white/[0.06] bg-background px-5 pt-3 pb-5 sm:px-6 sm:pb-6">
              {touched && problem ? <p role="alert" className="text-sm text-red-300">{problem}</p> : null}
              {failed ? (
                <p role="alert" data-testid="incident-error" className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${failed.kind === "offline" ? "border-amber-400/40 text-amber-200" : "border-red-400/40 text-red-300"}`}>
                  {failed.kind === "offline" ? <WifiOff className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> : null}
                  <span>{failed.message}</span>
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={busy} className="flex-1 sm:flex-none bg-gradient-gold text-primary-foreground hover:opacity-90">
                  {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                  {busy ? "Enviando…" : failed ? "Reintentar" : "Enviar al equipo"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default IncidentDialog;
