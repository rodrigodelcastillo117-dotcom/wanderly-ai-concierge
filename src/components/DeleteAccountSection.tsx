import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function DeleteAccountSection() {
  const [step, setStep] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const close = () => { if (!deleting) { setStep(0); setConfirmation(""); setError(""); } };
  const removeAccount = async () => {
    if (step !== 2 || confirmation !== "ELIMINAR" || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("delete-account", {
        body: { confirm: true, confirmation },
      });
      if (requestError || data?.ok !== true) throw new Error("deletion_failed");
    } catch {
      setError("No se pudo completar la eliminación. Algunos datos podrían haberse borrado; intenta de nuevo.");
      setDeleting(false);
      return;
    }
    await signOut().catch(() => undefined);
    queryClient.clear();
    toast.success("Tu cuenta fue eliminada");
    navigate("/", { replace: true });
  };

  return <section className="border-t border-border pt-8 space-y-3">
    <h2 className="font-display text-2xl text-destructive">Eliminar mi cuenta</h2>
    <p className="text-sm text-muted-foreground">Borra definitivamente tu perfil, viajes, conversaciones, beneficios y archivos de IATOS. Esta acción es irreversible.</p>
    <Button variant="destructive" onClick={() => setStep(1)}><Trash2 className="mr-2 h-4 w-4" />Eliminar mi cuenta</Button>
    <AlertDialog open={step > 0} onOpenChange={open => { if (!open) close(); }}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{step === 1 ? "¿Quieres eliminar tu cuenta?" : "Confirmación final"}</AlertDialogTitle>
          <AlertDialogDescription>
            {step === 1
              ? "Perderás tu cuenta y todos tus datos de IATOS, incluidas fotos y aportaciones a viajes compartidos. Los viajes de otras personas se conservarán. No podrás recuperarlos."
              : "Escribe ELIMINAR para borrar permanentemente tu cuenta. Se cancelará tu suscripción de IATOS, si tienes una; esto no cancela reservas con proveedores externos. Los emails ya enviados y respaldos sujetos a retención no se eliminan con esta acción."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {step === 2 && <div className="space-y-2">
          <label htmlFor="delete-confirmation" className="text-sm">Escribe ELIMINAR</label>
          <Input id="delete-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={deleting} />
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter className="gap-2">
          <Button variant="outline" disabled={deleting} onClick={close}>Cancelar</Button>
          {step === 1
            ? <Button variant="destructive" onClick={() => setStep(2)}>Sí, continuar</Button>
            : <Button variant="destructive" disabled={confirmation !== "ELIMINAR" || deleting} onClick={removeAccount}>
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{deleting ? "Eliminando…" : "Eliminar definitivamente"}
              </Button>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}