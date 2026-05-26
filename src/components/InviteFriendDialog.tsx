import { useEffect, useState } from "react";
import { UserPlus, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Friend {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface Props {
  tripId: string;
  isOwner: boolean;
}

export const InviteFriendDialog = ({ tripId, isOwner }: Props) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [collabIds, setCollabIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: fs } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const friendIds = (fs ?? []).map((f) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id,
    );

    if (friendIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", friendIds);
      setFriends(profs ?? []);
    } else {
      setFriends([]);
    }

    const { data: collabs } = await supabase
      .from("trip_collaborators")
      .select("user_id")
      .eq("trip_id", tripId);
    setCollabIds(new Set((collabs ?? []).map((c: any) => c.user_id)));
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const invite = async (friendId: string) => {
    setBusyId(friendId);
    const { data, error } = await supabase.rpc("invitar_amigo_viaje", {
      p_trip_id: tripId,
      p_friend_id: friendId,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const r = data as any;
    if (!r?.ok) {
      toast.error(r?.error ?? "No se pudo invitar");
      return;
    }
    toast.success("Amigo invitado al viaje");
    setCollabIds((s) => new Set([...s, friendId]));
  };

  const remove = async (friendId: string) => {
    setBusyId(friendId);
    const { error } = await supabase
      .from("trip_collaborators")
      .delete()
      .eq("trip_id", tripId)
      .eq("user_id", friendId);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Colaborador removido");
    setCollabIds((s) => {
      const n = new Set(s);
      n.delete(friendId);
      return n;
    });
  };

  if (!isOwner) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-2 px-3 py-2 rounded-full glass-card text-xs hover:gold-border transition">
          <UserPlus className="w-3.5 h-3.5 text-primary" />
          Compartir
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-w-[92vw] bg-surface border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Invitar al viaje</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Tus amigos invitados podrán ver y editar todo el viaje contigo.
        </p>

        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Cargando amigos…</p>
        ) : friends.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Aún no tienes amigos conectados.
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/social">Ir a Social</a>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {friends.map((f) => {
              const already = collabIds.has(f.id);
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-background/40 border border-border"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-display flex-shrink-0">
                    {(f.full_name || f.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.full_name || "Sin nombre"}</p>
                    <p className="text-xs text-muted-foreground truncate">{f.email}</p>
                  </div>
                  {already ? (
                    <button
                      onClick={() => remove(f.id)}
                      disabled={busyId === f.id}
                      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> Quitar
                    </button>
                  ) : (
                    <button
                      onClick={() => invite(f.id)}
                      disabled={busyId === f.id}
                      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-gradient-gold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" /> Invitar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
