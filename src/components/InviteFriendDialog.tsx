import { useEffect, useState } from "react";
import { UserPlus, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { fetchFriendProfiles, type FriendProfile } from "@/lib/friendProfiles";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { SOCIAL_ERRORS } from "@/lib/social";

type Friend = FriendProfile;

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
    // Solo nombre, usuario y avatar de amistades aceptadas (RPC friend_profiles, F-10): el correo
    // del amigo ya no se lee desde el navegador (el aviso por correo lo arma el servidor).
    setFriends(await fetchFriendProfiles(supabase));

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
    // Antes se mostraba el código crudo ("no_eres_dueno") o el mensaje técnico del servidor.
    if (error) {
      toast.error("No se pudo invitar. Intenta de nuevo.");
      return;
    }
    const r = data as { ok?: boolean; error?: string } | null;
    if (!r?.ok) {
      toast.error(SOCIAL_ERRORS[r?.error ?? ""] ?? "No se pudo invitar. Intenta de nuevo.");
      return;
    }
    toast.success("Amigo invitado al viaje");
    setCollabIds((s) => new Set([...s, friendId]));
    // Aviso por correo (best-effort): el servidor arma el correo y busca el destinatario.
    supabase.functions
      .invoke("send-email", { body: { trip_id: tripId, friend_id: friendId } })
      .catch((e) => console.warn("email send skipped", e));
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
        <button className="inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-2 text-xs transition hover:gold-border sm:px-3 glass-card" aria-label="Compartir viaje">
          <UserPlus className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline">Compartir</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-w-[92vw] bg-surface border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Invitar al viaje</DialogTitle>
          {/* Descripción accesible del diálogo (antes: advertencia de Radix en consola). */}
          <DialogDescription className="text-sm text-muted-foreground">
            Tus amigos invitados podrán ver y editar todo el viaje contigo.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Tus amigos invitados podrán ver y editar todo el viaje contigo.
        </p>
        {/* Honesto: no existe un enlace público del viaje (no se inventa). Lo que sí hay: invitar a un amigo de
            IATOS o mandar el PDF. */}
        <p className="text-xs text-muted-foreground" data-testid="compartir-sin-enlace">
          Por ahora el viaje se comparte invitando a alguien que ya tenga IATOS; todavía no hay un enlace para compartirlo con cualquier persona. Para mandarlo a alguien más, usa «Compartir PDF».
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
                  <FriendAvatar name={f.full_name || f.username || "?"} url={f.avatar_url} className="w-10 h-10 text-base font-display" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.full_name || "Sin nombre"}</p>
                    {f.username && <p className="text-xs text-muted-foreground truncate">@{f.username}</p>}
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
