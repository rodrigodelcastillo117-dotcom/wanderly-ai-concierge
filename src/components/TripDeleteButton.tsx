// Borrar el viaje (dueño) o salir de él (colaborador) desde la página del viaje. Antes solo se
// podía desde el bote de basura de "Mis viajes" o desde "Editar viaje", y el dueño no lo encontraba.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteOwnedTrip, leaveSharedTrip, MEMBERSHIP_MESSAGES } from "@/lib/tripMembership";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function TripDeleteButton({ tripId, destino, isOwner, userId }: {
  tripId: string; destino: string; isOwner: boolean; userId: string | null;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const label = isOwner ? "Eliminar viaje" : "Salir del viaje";

  const run = async () => {
    if (!userId) return;
    setBusy(true);
    const res = isOwner ? await deleteOwnedTrip(supabase, tripId) : await leaveSharedTrip(supabase, tripId, userId);
    setBusy(false);
    if (res.ok) {
      toast.success(isOwner ? MEMBERSHIP_MESSAGES.deleted : MEMBERSHIP_MESSAGES.left);
      navigate("/dashboard/viajes");
    } else if (res.reason === "not_allowed") {
      toast.error(isOwner ? MEMBERSHIP_MESSAGES.deleteNotAllowed : MEMBERSHIP_MESSAGES.leaveNotAllowed);
    } else {
      toast.error(MEMBERSHIP_MESSAGES.error);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={busy || !userId}
          aria-label={label}
          data-testid="trip-delete"
          className="inline-flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-full glass-card text-xs hover:border-destructive/60 hover:text-destructive transition disabled:opacity-50 shrink-0"
        >
          {isOwner ? <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> : <LogOut className="w-3.5 h-3.5" aria-hidden="true" />}
          <span className="hidden sm:inline">{label}</span>
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isOwner ? "¿Eliminar este viaje?" : "¿Salir de este viaje?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {isOwner
              ? `Esta acción no se puede deshacer. Se borrará "${destino}" con su diario, packing y gastos divididos. También se borran tus fotos y videos de Recuerdos de este viaje.`
              : `Dejarás de ver "${destino}". El viaje no se borra: el dueño y los demás colaboradores lo conservan.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={run} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {isOwner ? "Eliminar" : "Salir del viaje"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
