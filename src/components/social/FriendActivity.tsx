import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Heart, MapPin, MessageCircle, Send, Ticket } from "lucide-react";
import { toast } from "sonner";
import { SmartImage } from "@/components/media/SmartImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSignedMoments } from "@/hooks/useFriendAvatars";
import { destinationQuery } from "@/lib/categoryImagery";
import { localISODate } from "@/lib/localDate";
import { trackBookingClick } from "@/lib/trackBooking";
import {
  activityError, activityHeadline, ask, favoriteTipo, react, REACCIONES, relativeDay, reserveLink, stars,
  type ActivityItem, type Reaccion,
} from "@/lib/friendActivity";

type RpcClient = Parameters<typeof react>[0];
const client = () => supabase as unknown as RpcClient;

type MyTrip = { id: string; destino: string; fecha_salida: string | null; fecha_regreso: string | null };

/** "Agregar a mi viaje": anota el lugar en el diario de uno de MIS viajes próximos (sin decir de quién vino). */
export function AddToMyTripDialog({ item, open, onOpenChange }: { item: ActivityItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const [trips, setTrips] = useState<MyTrip[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = localISODate();
  useEffect(() => {
    if (!open || !user) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from("trips").select("id, destino, fecha_salida, fecha_regreso").order("fecha_salida", { ascending: true }).limit(40);
        const list = ((data ?? []) as MyTrip[]).filter((t) => !t.fecha_regreso || t.fecha_regreso >= today);
        if (alive) setTrips(list);
      } catch { if (alive) setTrips([]); }
    })();
    return () => { alive = false; };
  }, [open, user, today]);

  const add = async (t: MyTrip) => {
    if (!user || busy) return;
    setBusy(t.id);
    const text = `📌 Para visitar: ${item.titulo}${item.ciudad ? ` · ${item.ciudad}` : ""}`;
    const { error } = await supabase.from("trip_journal_entries").insert({ trip_id: t.id, author_id: user.id, text });
    setBusy(null);
    if (error) { toast.error("No se pudo agregar. Revisa que puedas editar ese viaje."); return; }
    toast.success(`Listo: quedó en el diario de tu viaje a ${t.destino}`);
    onOpenChange(false);
  };

  const place = item.ciudad ?? item.pais ?? (item.categoria === "destino" ? item.titulo : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar a mi viaje</DialogTitle>
          <DialogDescription>{item.titulo} quedará anotado en el diario del viaje que elijas.</DialogDescription>
        </DialogHeader>
        {trips === null ? (
          <p className="text-sm text-muted-foreground py-4">Buscando tus viajes…</p>
        ) : trips.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No tienes viajes próximos.</p>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {trips.map((t) => (
              <li key={t.id}>
                <button type="button" disabled={!!busy} onClick={() => void add(t)}
                  className="w-full text-left rounded-xl border border-white/[0.08] px-4 py-3 hover:border-primary/40 transition disabled:opacity-60">
                  <span className="block text-sm font-medium">{t.destino}</span>
                  <span className="block text-xs text-muted-foreground">{t.fecha_salida ? relativeTripDate(t.fecha_salida) : "Sin fechas"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {place && (
          <Button asChild variant="outline" className="w-full border-primary/30 text-primary mt-2">
            <Link to={`/dashboard/planear?${new URLSearchParams({ destino: place }).toString()}`}>Planear un viaje a {place}</Link>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const relativeTripDate = (iso: string) => `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

type CardProps = {
  item: ActivityItem;
  /** Dueño de la actividad (para reaccionar y preguntar). */
  friendId: string;
  friendName: string;
  /** En el feed de todos: avatar y nombre del amigo arriba. */
  showFriend?: { avatar: string | null };
  photoUrl?: string | null;
  onChange?: (next: ActivityItem) => void;
};

export function ActivityCard({ item, friendId, friendName, showFriend, photoUrl, onChange }: CardProps) {
  const { user } = useAuth();
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const today = localISODate();
  const when = relativeDay(item.fecha, today);
  const reserve = reserveLink(item);
  const isPlace = item.tipo !== "momento" && item.categoria !== "destino";

  const setReaction = async (r: Reaccion) => {
    if (busy) return;
    const next = item.miReaccion === r ? null : r;
    setBusy(true);
    const res = await react(client(), friendId, item.clave, next);
    setBusy(false);
    if (!res?.ok) { toast.error(activityError(res)); return; }
    onChange?.({ ...item, miReaccion: next });
  };

  const sendQuestion = async () => {
    const t = question.trim();
    if (t.length < 2 || busy) return;
    setBusy(true);
    const res = await ask(client(), friendId, item.clave, t);
    setBusy(false);
    if (!res?.ok) { toast.error(activityError(res)); return; }
    toast.success(`Le preguntaste a ${friendName}. Te avisamos cuando responda.`);
    setQuestion("");
    setAskOpen(false);
    onChange?.({ ...item, misPreguntas: [...item.misPreguntas, { id: res.id ?? `tmp-${Date.now()}`, pregunta: t, respuesta: null, fecha: today }] });
  };

  const saveFavorite = async () => {
    if (!user || saved) return;
    setSaved(true);
    try {
      const { data: existing } = await supabase.from("recomendaciones").select("id").eq("user_id", user.id).eq("titulo", item.titulo).limit(1).maybeSingle();
      const { error } = existing
        ? await supabase.from("recomendaciones").update({ guardado: true }).eq("id", (existing as { id: string }).id)
        : await supabase.from("recomendaciones").insert([{
            user_id: user.id, titulo: item.titulo, tipo: favoriteTipo(item), descripcion: item.ciudad ?? item.pais ?? null,
            imagen_url: item.imagen, guardado: true, metadata: { origen: "amigo", place_id: item.placeId, photo_ref: item.photoRef },
          }]);
      if (error) throw error;
      toast.success(`${item.titulo} quedó en tus favoritos`);
    } catch {
      setSaved(false);
      toast.error("No se pudo guardar en tus favoritos.");
    }
  };

  const doReserve = () => {
    if (!reserve) return;
    trackBookingClick({ category: reserve.category, provider: reserve.provider, title: item.titulo, bookingUrl: reserve.url, city: item.ciudad ?? undefined });
  };

  const img = photoUrl ?? item.imagen;
  return (
    <article className="glass-card rounded-2xl overflow-hidden border border-white/[0.05] flex flex-col" data-testid="activity-card">
      <SmartImage
        alt={item.titulo}
        imageUrl={img}
        photoRef={item.photoRef}
        lookup={isPlace && !img && !item.photoRef ? { name: item.titulo, city: item.ciudad, placeId: item.placeId } : null}
        stockQuery={destinationQuery(item.ciudad ?? item.titulo, item.pais)}
        icon={MapPin}
        size="card"
        className="h-40 md:h-44 w-full"
        captionPosition="top-right"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
        {showFriend && (
          <Link to={`/dashboard/social/amigo/${friendId}`} className="absolute top-3 left-3 z-[2] flex items-center gap-2 rounded-full bg-black/55 backdrop-blur pl-1 pr-3 py-1">
            <FriendAvatar name={friendName} url={showFriend.avatar} className="w-7 h-7 text-xs" />
            <span className="text-xs text-white/90">{friendName}</span>
          </Link>
        )}
      </SmartImage>
      <div className="px-4 pt-3 pb-4 flex-1 flex flex-col gap-2">
        <div>
          <h3 className="font-display text-lg leading-snug">{activityHeadline(item)}</h3>
          <p className="text-xs text-muted-foreground">
            {[item.ciudad ?? item.pais, item.cocina, when].filter(Boolean).join(" · ")}
          </p>
          {item.estrellas && <p className="text-sm mt-1" aria-label={`${item.estrellas} de 5 estrellas`}>{stars(item.estrellas)}</p>}
          {item.nota && <p className="text-sm text-foreground/85 mt-1 italic">“{item.nota}”</p>}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-1" role="group" aria-label="Reaccionar">
          {REACCIONES.map((r) => (
            <button key={r.id} type="button" disabled={busy} onClick={() => void setReaction(r.id)} aria-pressed={item.miReaccion === r.id}
              aria-label={r.label}
              className={`h-9 min-w-9 px-2.5 rounded-full border text-base transition ${item.miReaccion === r.id ? "border-primary bg-primary/15" : "border-white/10 hover:border-primary/40"}`}>
              {r.emoji}
            </button>
          ))}
          <button type="button" onClick={() => setAskOpen((o) => !o)} aria-expanded={askOpen}
            className="h-9 px-3 rounded-full border border-white/10 text-xs inline-flex items-center gap-1.5 hover:border-primary/40">
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> Preguntarle
          </button>
        </div>

        {item.misPreguntas.length > 0 && (
          <ul className="space-y-1.5" aria-label="Tus preguntas">
            {item.misPreguntas.map((q) => (
              <li key={q.id} className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2 text-xs">
                <p><span className="text-muted-foreground">Tú:</span> {q.pregunta}</p>
                <p className="mt-0.5">{q.respuesta ? <><span className="text-primary">{friendName}:</span> {q.respuesta}</> : <span className="text-muted-foreground">Esperando respuesta…</span>}</p>
              </li>
            ))}
          </ul>
        )}
        {askOpen && (
          <div className="space-y-2">
            <Textarea value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 280))} rows={2}
              aria-label={`Pregunta para ${friendName}`} placeholder={`¿Qué le preguntas a ${friendName}?`} className="text-sm" />
            <Button size="sm" disabled={busy || question.trim().length < 2} onClick={() => void sendQuestion()} className="bg-gradient-gold text-primary-foreground">
              <Send className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Enviar
            </Button>
          </div>
        )}

        <div className="mt-auto pt-2 grid grid-cols-3 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void saveFavorite()} disabled={saved} className="text-[11px] px-1.5 h-9 border-white/10">
            <Heart className={`w-3.5 h-3.5 mr-1 ${saved ? "fill-primary text-primary" : ""}`} aria-hidden="true" /> {saved ? "Guardado" : "Guardar"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTripOpen(true)} className="text-[11px] px-1.5 h-9 border-white/10">
            <CalendarPlus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> A mi viaje
          </Button>
          {reserve ? (
            <Button size="sm" onClick={doReserve} className="text-[11px] px-1.5 h-9 bg-gradient-gold text-primary-foreground">
              <Ticket className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Reservar
            </Button>
          ) : (
            <Button size="sm" asChild className="text-[11px] px-1.5 h-9 bg-gradient-gold text-primary-foreground">
              <Link to={`/dashboard/planear?${new URLSearchParams({ destino: item.ciudad ?? item.titulo }).toString()}`}>Planear</Link>
            </Button>
          )}
        </div>
      </div>
      <AddToMyTripDialog item={item} open={tripOpen} onOpenChange={setTripOpen} />
    </article>
  );
}

/** Lista de tarjetas (perfil de un amigo o feed de todos). */
export function ActivityGrid({ items, friendId, friendName, avatars, onChange }: {
  items: ActivityItem[];
  /** Perfil de un amigo: su id y nombre; en el feed salen de cada elemento. */
  friendId?: string;
  friendName?: string;
  avatars?: Map<string, string | null>;
  onChange: (next: ActivityItem) => void;
}) {
  const paths = useMemo(() => items.map((i) => i.fotoPath).filter((p): p is string => !!p), [items]);
  const photos = useSignedMoments(paths);
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
      {items.map((i) => {
        const fid = i.amigo?.id ?? friendId ?? "";
        const fname = i.amigo?.nombre ?? friendName ?? "Tu amigo";
        return (
          <ActivityCard key={`${fid}:${i.clave}`} item={i} friendId={fid} friendName={fname}
            showFriend={i.amigo ? { avatar: avatars?.get(fid) ?? null } : undefined}
            photoUrl={i.fotoPath ? photos.get(i.fotoPath) ?? null : null}
            onChange={onChange} />
        );
      })}
    </div>
  );
}
