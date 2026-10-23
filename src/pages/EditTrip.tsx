import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Save, Sparkles, Trash2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { BudgetField, nightsBetween } from "@/components/BudgetField";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { toast } from "sonner";
import { staleQuoteMessage } from "@/lib/quote";
import { useAuth } from "@/contexts/AuthContext";
import { reanalyzeTripInPlace } from "@/lib/tripReanalysis";
import { deleteOwnedTrip, leaveSharedTrip, MEMBERSHIP_MESSAGES } from "@/lib/tripMembership";

const EditTrip = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  // Dueño del viaje: decide si mostramos "Eliminar" (dueño) o "Salir del viaje" (colaborador).
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const [destino, setDestino] = useState("");
  const [paisDestino, setPaisDestino] = useState("");
  const [ciudadOrigen, setCiudadOrigen] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [numViajeros, setNumViajeros] = useState(2);
  const [presupuesto, setPresupuesto] = useState<number | null>(null);
  // Viajeros y fechas con que está cotizado el viaje (para avisar si se cambian sin recotizar).
  const [original, setOriginal] = useState<{ travelers: number; dateFrom: string | null; dateTo: string | null; hasQuote: boolean } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      if (data) {
        setOwnerId(data.user_id ?? null);
        setDestino(data.destino ?? "");
        setPaisDestino(data.pais_destino ?? "");
        setCiudadOrigen(data.ciudad_origen ?? "");
        setFechaSalida(data.fecha_salida ?? "");
        setFechaRegreso(data.fecha_regreso ?? "");
        setNumViajeros(data.num_viajeros ?? 2);
        setPresupuesto(data.presupuesto_objetivo ?? null);
        const basis = (data as any).quote_basis;
        setOriginal({
          travelers: Number(basis?.num_viajeros ?? data.num_viajeros ?? 2),
          dateFrom: basis?.fecha_salida ?? data.fecha_salida ?? null,
          dateTo: basis?.fecha_regreso ?? data.fecha_regreso ?? null,
          hasQuote: data.total_estimado != null,
        });
      }
      setLoading(false);
    })();
  }, [id]);

  const guardar = async () => {
    if (!id) return;
    setSaving(true);
    const { error } = await supabase
      .from("trips")
      .update({
        destino,
        pais_destino: paisDestino || null,
        ciudad_origen: ciudadOrigen,
        fecha_salida: fechaSalida,
        fecha_regreso: fechaRegreso,
        num_viajeros: numViajeros,
        presupuesto_objetivo: presupuesto,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast.error("No pudimos guardar los cambios. Intenta de nuevo.");
      return;
    }
    if (quoteBasisChanged && original) {
      // El total guardado sigue siendo el de antes: se avisa en vez de repartirlo en silencio.
      toast.warning("Cambios guardados", { description: `${staleQuoteMessage(original)} con «Re-analizar con IA».` });
    } else {
      toast.success("Cambios guardados");
    }
    navigate(`/dashboard/viajes/${id}`);
  };

  const quoteBasisChanged = !!original?.hasQuote && (
    numViajeros !== original.travelers || (fechaSalida || null) !== original.dateFrom || (fechaRegreso || null) !== original.dateTo
  );

  // Re-analiza SOBRE el mismo viaje (mismo id): diario, packing, split, gastos,
  // reservas, alertas y colaboradores se conservan. Nunca borra el viaje original.
  const reanalizar = async () => {
    if (!id || reanalyzing) return;
    setReanalyzing(true);
    try {
      const res = await reanalyzeTripInPlace(supabase, id, {
        destino,
        pais_destino: paisDestino || undefined,
        ciudad_origen: ciudadOrigen,
        fecha_salida: fechaSalida,
        fecha_regreso: fechaRegreso,
        num_viajeros: numViajeros,
        presupuesto_objetivo: presupuesto,
      });
      if (res.status === "kept_copy") {
        toast.warning("No pudimos actualizar este viaje, así que guardamos la nueva cotización como un viaje aparte. El original no se tocó.");
      } else {
        toast.success("Viaje re-analizado. Tu diario, packing y gastos siguen aquí.");
      }
      navigate(`/dashboard/viajes/${res.tripId}`, { replace: true });
    } catch (e: any) {
      // Límite del plan → diálogo; fallo técnico → mensaje seguro (nunca el texto interno).
      await (await import("@/lib/functionErrors")).toastFunctionError(e, "No pudimos re-analizar el viaje. No se cambió nada.");
      setReanalyzing(false);
    }
  };

  const isCollaborator = !!user && !!ownerId && ownerId !== user.id;

  const eliminar = async () => {
    if (!id || !user) return;
    const res = isCollaborator ? await leaveSharedTrip(supabase, id, user.id) : await deleteOwnedTrip(supabase, id);
    if (!res.ok) {
      toast.error(
        res.reason === "not_allowed"
          ? isCollaborator ? MEMBERSHIP_MESSAGES.leaveNotAllowed : MEMBERSHIP_MESSAGES.deleteNotAllowed
          : MEMBERSHIP_MESSAGES.error,
      );
      return;
    }
    toast.success(isCollaborator ? MEMBERSHIP_MESSAGES.left : MEMBERSHIP_MESSAGES.deleted);
    navigate("/dashboard/viajes", { replace: true });
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  if (reanalyzing) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.4, repeat: Infinity }}
            className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow"
          >
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </motion.div>
          <h2 className="font-display text-3xl md:text-5xl mb-6">
            Re-analizando tu viaje a <span className="gold-text italic">{destino}</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-md">
            Esto puede tardar hasta un minuto. Actualizamos vuelos, hospedaje, restaurantes e itinerario de este mismo viaje.
          </p>
          <div className="mt-12 flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }}
                className="w-2 h-2 rounded-full bg-primary"
              />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }


  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-2xl">



        <h1 className="font-display text-4xl md:text-5xl mb-2">Editar viaje</h1>
        <p className="text-muted-foreground mb-10">
          Actualiza los detalles. Puedes guardar los cambios o re-analizar con IA.
        </p>

        <div className="space-y-6 glass-card rounded-2xl p-6 md:p-8">
          <div>
            <label htmlFor="edit-destino" className="text-sm text-muted-foreground mb-2 block">
              Destinos <span className="text-xs opacity-60">(una o varias ciudades, separadas por coma)</span>
            </label>
            <Input
              id="edit-destino"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="Ej. Roma, Florencia, Venecia"
              className="bg-input border-border h-12"
            />
          </div>
          <div>
            <label htmlFor="edit-origen" className="text-sm text-muted-foreground mb-2 block">Ciudad de salida</label>
            <Input id="edit-origen" value={ciudadOrigen} onChange={(e) => setCiudadOrigen(e.target.value)} className="bg-input border-border h-12" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-salida" className="text-sm text-muted-foreground mb-2 block">Salida</label>
              <Input id="edit-salida" type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} className="bg-input border-border h-12" />
            </div>
            <div>
              <label htmlFor="edit-regreso" className="text-sm text-muted-foreground mb-2 block">Regreso</label>
              <Input id="edit-regreso" type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} className="bg-input border-border h-12" />
            </div>
          </div>
          <div>
            <label id="edit-viajeros-label" className="text-sm text-muted-foreground mb-3 block">
              Viajeros: <span className="text-foreground font-medium">{numViajeros}</span>
            </label>
            <Slider aria-labelledby="edit-viajeros-label" value={[numViajeros]} onValueChange={(v) => setNumViajeros(v[0])} min={1} max={10} step={1} />
          </div>
          <div>
            <BudgetField value={presupuesto} onChange={setPresupuesto} travelers={numViajeros} nights={nightsBetween(fechaSalida, fechaRegreso)} size="sm" />
          </div>
        </div>

        {quoteBasisChanged && original && (
          <p role="status" className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-500">
            {staleQuoteMessage(original)}. Guardar no cambia los precios: usa «Re-analizar con IA» para cotizar con los nuevos viajeros o fechas.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mt-8">
          <Button
            onClick={guardar}
            disabled={saving || reanalyzing}
            className="flex-1 bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-12"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button
            onClick={reanalizar}
            disabled={saving || reanalyzing}
            variant="outline"
            className="flex-1 h-12"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {reanalyzing ? "Re-analizando…" : "Re-analizar con IA"}
          </Button>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="mt-6 text-destructive hover:text-destructive hover:bg-destructive/10">
              {isCollaborator ? <LogOut className="w-4 h-4 mr-2" aria-hidden="true" /> : <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />}
              {isCollaborator ? "Salir del viaje" : "Eliminar viaje"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isCollaborator ? "¿Salir de este viaje?" : "¿Eliminar este viaje?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {isCollaborator
                  ? "Dejarás de verlo. El viaje no se borra: el dueño y los demás colaboradores lo conservan."
                  : "Esta acción no se puede deshacer. Se borrará el viaje con su diario, packing y gastos divididos."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={eliminar} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {isCollaborator ? "Salir del viaje" : "Eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default EditTrip;
