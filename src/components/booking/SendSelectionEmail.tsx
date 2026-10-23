// "Enviarme mi selección por correo" (pestaña Comprar): manda SOLO lo elegido (vuelo, hotel de cada
// ciudad, experiencias, restaurantes y auto marcados) con el total de la página. Sin vuelo y hotel
// elegidos el botón dice "Elige tu vuelo y hotel para enviarte el resumen" y no manda nada. Por defecto
// va al correo de la sesión; mandarlo a quienes viajan contigo es opcional y se marca persona por persona.
import { useMemo, useState } from "react";
import { Mail, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionErrors";
import { buildSelectionRequest, NOT_READY_LABEL, SEND_LABEL, type SelectionSel } from "@/lib/selectionEmail";
import type { PurchaseMarkRow, TripOfferActionsLike } from "@/lib/purchasePlan";
import { useTripPurchaseMarks } from "@/hooks/useTripPurchaseMarks";

type Member = { id: string; name: string | null; you: boolean };

type Props = SelectionSel & {
  trip: any;
  /** Viajeros y noches con que la página calcula el total. */
  travelers: number;
  nights: number;
  desglose: Record<string, number>;
  /** Total que muestra la página. */
  total: number;
  serverOffers?: TripOfferActionsLike;
  bookings: PurchaseMarkRow[];
  userId: string | null;
  quoteCreatedAt?: string | null;
};

export function SendSelectionEmail({ trip, selVuelo, selHospedaje, selTours, selHoteles, travelers, nights, desglose, total, serverOffers, bookings, userId, quoteCreatedAt }: Props) {
  const { rows, marks } = useTripPurchaseMarks({ trip, userId, bookings });
  const readiness = useMemo(
    () => buildSelectionRequest(trip, { selVuelo, selHospedaje, selTours, selHoteles }, { travelers, nights, desglose, total, serverOffers, quoteCreatedAt, rows, marks }),
    [trip, selVuelo, selHospedaje, selTours, selHoteles, travelers, nights, desglose, total, serverOffers, quoteCreatedAt, rows, marks],
  );
  const [sending, setSending] = useState(false);
  const [toMembers, setToMembers] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingMembers, setLoadingMembers] = useState(false);

  if (!trip?.id) return null;

  async function openMembers(on: boolean) {
    setToMembers(on);
    if (!on || members) return;
    setLoadingMembers(true);
    const { data, error } = await supabase.functions.invoke("enviar-seleccion", { body: { action: "members", trip_id: trip.id } });
    setLoadingMembers(false);
    if (error || !Array.isArray(data?.members)) {
      setToMembers(false);
      toast.error((await readFunctionError(error, "No pudimos cargar a quienes viajan contigo.")).message);
      return;
    }
    setMembers(data.members as Member[]);
    setPicked(new Set((data.members as Member[]).filter((m) => m.you).map((m) => m.id)));
  }

  async function send() {
    if (!readiness.ready || !readiness.payload || sending) return;
    const ids = [...picked];
    if (toMembers && !ids.length) return toast.error("Marca a quién se lo mandamos.");
    setSending(true);
    const { data, error } = await supabase.functions.invoke("enviar-seleccion", {
      body: { ...readiness.payload, trip_id: trip.id, to: toMembers ? "members" : "me", ...(toMembers ? { member_ids: ids } : {}) },
    });
    setSending(false);
    if (error || !data?.ok) {
      toast.error((await readFunctionError(error, "No pudimos enviar el correo. Intenta de nuevo.")).message);
      return;
    }
    const n = Number(data.sent) || 1;
    toast.success(toMembers ? `Enviado a ${n === 1 ? "1 persona" : `${n} personas`}` : "Te lo enviamos a tu correo", {
      description: "Solo va lo que elegiste, con su precio y su botón de compra.",
    });
  }

  const others = (members ?? []).length > 1;
  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 p-4 sm:p-5" aria-labelledby="enviar-seleccion-title" data-testid="enviar-seleccion">
      <h3 id="enviar-seleccion-title" className="font-display text-xl">Tu selección por correo</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Solo lo que elegiste: vuelo, hotel{hasMany(trip) ? "es" : ""}, experiencias y reservas, con su precio, su botón de compra y el total de esta página.
      </p>

      <label className="mt-3 inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="accent-primary" checked={toMembers} disabled={!readiness.ready || loadingMembers}
          onChange={(e) => void openMembers(e.target.checked)} data-testid="enviar-seleccion-miembros" />
        <Users className="w-4 h-4 text-primary" aria-hidden="true" /> Mandarlo también a quienes viajan conmigo
      </label>
      {toMembers && members && (
        others ? (
          <fieldset className="mt-1 space-y-1 rounded-xl border border-border/50 p-3" data-testid="enviar-seleccion-lista">
            <legend className="px-1 text-xs text-muted-foreground">¿A quién se lo mandamos?</legend>
            {members.map((m) => (
              <label key={m.id} className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="accent-primary" checked={picked.has(m.id)}
                  onChange={() => setPicked((prev) => { const next = new Set(prev); next.has(m.id) ? next.delete(m.id) : next.add(m.id); return next; })} />
                {m.you ? "Yo" : m.name ?? "Persona del viaje"}
              </label>
            ))}
          </fieldset>
        ) : <p className="mt-1 text-xs text-muted-foreground">Nadie más está en este viaje todavía: va solo a tu correo.</p>
      )}

      <button type="button" onClick={() => void send()} disabled={!readiness.ready || sending}
        data-testid="enviar-seleccion-boton" data-ready={readiness.ready ? "1" : "0"}
        className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground sm:w-auto">
        <Mail className="w-4 h-4" aria-hidden="true" />
        {sending ? "Enviando…" : readiness.ready ? SEND_LABEL : NOT_READY_LABEL}
      </button>
      {!readiness.ready && readiness.missing.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="enviar-seleccion-falta">Falta elegir: {readiness.missing.join(" · ")}</p>
      )}
    </section>
  );
}

function hasMany(trip: any): boolean {
  const d = trip?.itinerario_json?.destinations;
  return Array.isArray(d) && d.length > 1;
}
