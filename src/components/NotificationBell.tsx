import { useEffect, useState, useRef } from "react";
import { Bell, Check, Plane } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

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
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.read).length;

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as Notification[]) || []);
  };

  useEffect(() => {
    load();
    if (!user) return;
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
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
    if (!n.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
    }
    setOpen(false);
    if (n.related_id && (n.type === "trip_invite" || n.type === "trip_updated")) {
      navigate(`/dashboard/viajes/${n.related_id}`);
    }
    load();
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
        <div className="absolute right-0 mt-2 w-[340px] max-w-[92vw] rounded-2xl border border-white/[0.06] bg-black/90 backdrop-blur-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.85)] overflow-hidden z-50">
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
                <button
                  key={n.id}
                  onClick={() => openNotif(n)}
                  className={`w-full text-left px-4 py-3 border-b border-white/[0.03] hover:bg-white/[0.03] transition flex gap-3 ${
                    !n.read ? "bg-primary/[0.04]" : ""
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <Plane className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {n.body && <p className="text-[11px] text-muted-foreground line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
