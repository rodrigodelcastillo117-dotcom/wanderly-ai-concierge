import { useEffect, useState, useRef } from "react";
import { Bell, Check, Plane, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { afterCritical } from "@/lib/idleGate";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { notificationTarget } from "@/lib/notificationTarget";
import { respondFriendRequest } from "@/lib/friendRequests";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  related_id: string | null;
  read: boolean;
  created_at: string;
};

export const NotificationBell = ({ className = "" }: { className?: string }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  // Total real de no leídas (no solo entre las 20 que se muestran).
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user) return;
    const [{ data }, { count, error: countError }] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false),
    ]);
    const list = (data as Notification[]) || [];
    setItems(list);
    setUnread(countError || count == null ? list.filter((n) => !n.read).length : count);
  };

  useEffect(() => {
    if (!user) return;
    // Secundario: la campana no detiene la pantalla; se pide (y se abre el canal en vivo) cuando ya
    // llegaron los datos principales de la página (idleGate).
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancel = afterCritical(() => {
      load();
      channel = supabase
        .channel(`notif-${user.id}-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          () => load()
        )
        .subscribe();
    });
    return () => {
      cancel();
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markAllRead = async () => {
    if (!user || unread === 0) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    load();
  };

  const openNotif = async (n: Notification) => {
    if (n.type === "trip_invite") return; // handled by Accept/Reject buttons
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    }
    setOpen(false);
    const target = notificationTarget(n);
    if (target) navigate(target);
    load();
  };

  // Evita aceptar/rechazar dos veces con un doble toque, y no lleva al viaje si falló.
  const [responding, setResponding] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const respondInvite = async (n: Notification, accept: boolean) => {
    if (!n.related_id || responding) return;
    setResponding(n.id);
    setInviteError(null);
    const fn = accept ? "aceptar_invitacion_viaje" : "rechazar_invitacion_viaje";
    const { error } = await supabase.rpc(fn as any, { p_trip_id: n.related_id });
    setResponding(null);
    if (error) {
      setInviteError(n.id);
      return;
    }
    await load();
    if (accept) {
      setOpen(false);
      navigate(`/dashboard/viajes/${n.related_id}`);
    }
  };

  // Solicitud de amistad (T-P2-1): la amistad solo existe si la persona la acepta aquí o en Social.
  const respondFriend = async (n: Notification, accept: boolean) => {
    if (!n.related_id || responding) return;
    setResponding(n.id);
    setInviteError(null);
    const r = await respondFriendRequest(supabase as never, n.related_id, accept);
    setResponding(null);
    // sin_solicitud: ya se respondió en otra pantalla (o la cancelaron); solo se marca como leído.
    if (!r?.ok && r?.error !== "sin_solicitud") { setInviteError(n.id); return; }
    if (r?.error === "sin_solicitud" && !n.read) await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    await load();
    if (accept && r?.ok) { setOpen(false); navigate(`/dashboard/social/amigo/${n.related_id}`); }
  };

  return (
    <div ref={panelRef} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificaciones"
        className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition relative"
      >
        <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        // En móvil el panel va fijo con margen a ambos lados: anclado a la campana (right-0, 340 px)
        // se salía ~54 px por la izquierda a 390 px y cortaba el título. Fondo negro sólido: con
        // bg-black/90 + desenfoque dentro del encabezado (que ya desenfoca) se veía el contenido de atrás.
        <div className="fixed inset-x-3 top-[calc(max(env(safe-area-inset-top),0.5rem)+3rem)] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[340px] sm:max-w-[92vw] rounded-2xl border border-white/[0.08] bg-black shadow-[0_20px_60px_-12px_rgba(0,0,0,0.85)] overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
            <p className="text-sm font-medium">Notificaciones</p>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                <Check className="w-3 h-3" /> Marcar todas
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8 px-4">No tienes notificaciones</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`w-full px-4 py-3 border-b border-white/[0.03] transition ${
                    !n.read ? "bg-primary/[0.04]" : ""
                  }`}
                >
                  <button
                    onClick={() => openNotif(n)}
                    className="w-full text-left flex gap-3 hover:opacity-90"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                      {n.type === "social_poke"
                        ? <span aria-hidden="true" className="text-sm leading-none">👋</span>
                        : n.type === "friend_request" || n.type === "friend_accepted"
                          ? <UserPlus className="w-4 h-4 text-primary" />
                          : <Plane className="w-4 h-4 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      {n.body && <p className="text-[11px] text-muted-foreground line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                      </p>
                    </div>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />}
                  </button>
                  {n.type === "trip_invite" && (
                    <div className="flex gap-2 mt-3 ml-11">
                      <button
                        onClick={() => respondInvite(n, true)}
                        disabled={responding === n.id}
                        className="disabled:opacity-50 flex-1 px-3 py-1.5 rounded-full bg-gradient-gold text-primary-foreground text-[11px] font-medium tracking-wide hover:opacity-90 transition"
                      >
                        Aceptar viaje
                      </button>
                      <button
                        onClick={() => respondInvite(n, false)}
                        disabled={responding === n.id}
                        className="disabled:opacity-50 flex-1 px-3 py-1.5 rounded-full border border-white/10 text-muted-foreground text-[11px] hover:text-foreground hover:bg-white/[0.04] transition"
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
                  {n.type === "friend_request" && n.related_id && !n.read && (
                    <div className="flex gap-2 mt-3 ml-11">
                      <button
                        onClick={() => respondFriend(n, true)}
                        disabled={responding === n.id}
                        className="disabled:opacity-50 flex-1 px-3 py-1.5 rounded-full bg-gradient-gold text-primary-foreground text-[11px] font-medium tracking-wide hover:opacity-90 transition"
                      >
                        Aceptar
                      </button>
                      <button
                        onClick={() => respondFriend(n, false)}
                        disabled={responding === n.id}
                        className="disabled:opacity-50 flex-1 px-3 py-1.5 rounded-full border border-white/10 text-muted-foreground text-[11px] hover:text-foreground hover:bg-white/[0.04] transition"
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
                  {(n.type === "trip_invite" || n.type === "friend_request") && inviteError === n.id && (
                    <p role="alert" className="mt-2 ml-11 text-[11px] text-destructive">
                      No se pudo responder la invitación. Intenta de nuevo.
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
