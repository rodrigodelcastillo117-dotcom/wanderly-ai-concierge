import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Check, Loader2, MapPin, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { localISODate } from "@/lib/localDate";
import { planWithFriendHref, prettyPlace, shortMonthYear, SOCIAL_ERRORS } from "@/lib/social";
import { shortTripName } from "@/lib/tripName";

type MyTrip = { id: string; destino: string; pais_destino: string | null; fecha_salida: string | null; fecha_regreso: string | null };

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  friendId: string;
  friendName: string;
  /** Viajes que ya comparten (no se ofrecen). */
  sharedTripIds: Set<string>;
  /** Destinos que los dos quieren conocer. */
  suenos: string[];
};

/**
 * "Próximo viaje juntos": invitar al amigo a un viaje propio que viene (mismo RPC y correo que
 * "Compartir" en el viaje) o empezar uno nuevo con él ya incluido.
 */
export function PlanTogetherDialog({ open, onOpenChange, friendId, friendName, sharedTripIds, suenos }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<MyTrip[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, destino, pais_destino, fecha_salida, fecha_regreso")
        .eq("user_id", user.id)
        .order("fecha_salida", { ascending: true });
      const today = localISODate();
      const mine = ((data ?? []) as MyTrip[]).filter((t) => !sharedTripIds.has(t.id) && (!t.fecha_regreso || t.fecha_regreso >= today));
      // Invitaciones ya enviadas a este amigo que aún no acepta.
      let inv = new Set<string>();
      if (mine.length) {
        const { data: c } = await supabase
          .from("trip_collaborators")
          .select("trip_id, status")
          .eq("user_id", friendId)
          .in("trip_id", mine.map((t) => t.id));
        inv = new Set(((c ?? []) as { trip_id: string }[]).map((x) => x.trip_id));
      }
      if (!alive) return;
      setTrips(mine.slice(0, 12));
      setPending(inv);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id, friendId, sharedTripIds]);

  const invite = async (t: MyTrip) => {
    if (busy) return;
    setBusy(t.id);
    const { data, error } = await supabase.rpc("invitar_amigo_viaje", { p_trip_id: t.id, p_friend_id: friendId });
    setBusy(null);
    const r = data as { ok?: boolean; error?: string } | null;
    if (error || !r?.ok) {
      toast.error(SOCIAL_ERRORS[r?.error ?? ""] ?? "No se pudo invitar. Intenta de nuevo.");
      return;
    }
    setPending((s) => new Set([...s, t.id]));
    toast.success(`Invitamos a ${friendName} a ${t.destino}`);
    // Aviso por correo (best-effort): el servidor arma el correo y busca el destinatario.
    supabase.functions.invoke("send-email", { body: { trip_id: t.id, friend_id: friendId } }).catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-primary/20 max-w-[92vw] sm:max-w-lg rounded-2xl p-5 md:p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Su próximo viaje juntos</DialogTitle>
          <DialogDescription>Invita a {friendName} a un viaje que ya tienes o empiecen uno nuevo.</DialogDescription>
        </DialogHeader>

        {suenos.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] tracking-[0.25em] uppercase text-primary flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Los dos sueñan con</p>
            <div className="flex flex-wrap gap-2">
              {suenos.slice(0, 4).map((d) => (
                <button key={d} type="button" onClick={() => navigate(planWithFriendHref(friendId, prettyPlace(d)))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary/10 border border-primary/30 text-sm text-foreground hover:bg-primary/20 transition">
                  ✨ Planear {prettyPlace(d)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">Tus próximos viajes</p>
          {trips === null ? (
            <div className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />
          ) : trips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tienes viajes próximos sin {friendName}.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {trips.map((t) => {
                const sent = pending.has(t.id);
                return (
                  <li key={t.id} className="flex items-center gap-3 p-3 rounded-xl bg-background/40 border border-white/[0.06]">
                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{shortTripName(t)}</p>
                      <p className="text-[11px] text-muted-foreground">{shortMonthYear(t.fecha_salida) ?? "Sin fechas"}</p>
                    </div>
                    {sent ? (
                      <span className="inline-flex items-center gap-1 text-xs text-primary"><Check className="w-3.5 h-3.5" /> Invitación enviada</span>
                    ) : (
                      <button type="button" onClick={() => invite(t)} disabled={!!busy}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-gradient-gold text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
                        {busy === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarPlus className="w-3 h-3" />} Invitar
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button type="button" onClick={() => navigate(planWithFriendHref(friendId))}
          className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full border border-primary/40 text-primary text-sm font-medium hover:bg-primary/10 transition">
          <Plus className="w-4 h-4" /> Planear un viaje nuevo con {friendName}
        </button>
      </DialogContent>
    </Dialog>
  );
}
