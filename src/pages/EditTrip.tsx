import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Save, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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

const EditTrip = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const [destino, setDestino] = useState("");
  const [paisDestino, setPaisDestino] = useState("");
  const [ciudadOrigen, setCiudadOrigen] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [numViajeros, setNumViajeros] = useState(2);
  const [presupuesto, setPresupuesto] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      if (data) {
        setDestino(data.destino ?? "");
        setPaisDestino(data.pais_destino ?? "");
        setCiudadOrigen(data.ciudad_origen ?? "");
        setFechaSalida(data.fecha_salida ?? "");
        setFechaRegreso(data.fecha_regreso ?? "");
        setNumViajeros(data.num_viajeros ?? 2);
        setPresupuesto(data.presupuesto_objetivo ?? null);
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
      toast.error(error.message);
      return;
    }
    toast.success("Cambios guardados");
    navigate(`/dashboard/viajes/${id}`);
  };

  const reanalizar = async () => {
    if (!id) return;
    setReanalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analizar-viaje", {
        body: {
          destino,
          pais_destino: paisDestino || undefined,
          ciudad_origen: ciudadOrigen,
          fecha_salida: fechaSalida,
          fecha_regreso: fechaRegreso,
          num_viajeros: numViajeros,
          presupuesto_objetivo: presupuesto,
        },
      });
      if (error) throw error;
      if (!data?.trip?.id) throw new Error("Sin resultado");
      await supabase.from("trips").delete().eq("id", id);
      toast.success("Viaje re-analizado");
      navigate(`/dashboard/viajes/${data.trip.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "No pudimos re-analizar el viaje.");
      setReanalyzing(false);
    }
  };

  const eliminar = async () => {
    if (!id) return;
    const { error } = await supabase.from("trips").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Viaje eliminado");
    navigate("/dashboard/viajes");
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

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-2xl">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2 mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <h1 className="font-display text-4xl md:text-5xl mb-2">Editar viaje</h1>
        <p className="text-muted-foreground mb-10">
          Actualiza los detalles. Puedes guardar los cambios o re-analizar con IA.
        </p>

        <div className="space-y-6 glass-card rounded-2xl p-6 md:p-8">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Destino</label>
            <Input value={destino} onChange={(e) => setDestino(e.target.value)} className="bg-input border-border h-12" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">País destino</label>
            <Input value={paisDestino} onChange={(e) => setPaisDestino(e.target.value)} className="bg-input border-border h-12" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Ciudad de salida</label>
            <Input value={ciudadOrigen} onChange={(e) => setCiudadOrigen(e.target.value)} className="bg-input border-border h-12" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Salida</label>
              <Input type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} className="bg-input border-border h-12" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">Regreso</label>
              <Input type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} className="bg-input border-border h-12" />
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-3 block">
              Viajeros: <span className="text-foreground font-medium">{numViajeros}</span>
            </label>
            <Slider value={[numViajeros]} onValueChange={(v) => setNumViajeros(v[0])} min={1} max={10} step={1} />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sm text-muted-foreground">
                {presupuesto === null ? "Sin presupuesto fijo" : "Presupuesto"}
              </span>
              {presupuesto !== null && (
                <span className="font-display text-2xl gold-text">
                  ${presupuesto.toLocaleString("es-MX")}
                  <span className="text-sm text-muted-foreground ml-1">MXN</span>
                </span>
              )}
            </div>
            <Slider
              value={[presupuesto ?? 30000]}
              onValueChange={(v) => setPresupuesto(v[0])}
              min={5000}
              max={200000}
              step={1000}
            />
            <button
              type="button"
              onClick={() => setPresupuesto(presupuesto === null ? 30000 : null)}
              className="text-xs text-primary hover:underline mt-2"
            >
              {presupuesto === null ? "Establecer un presupuesto" : "Quitar presupuesto fijo"}
            </button>
          </div>
        </div>

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
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar viaje
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar este viaje?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción no se puede deshacer. Se borrará todo el análisis del viaje.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={eliminar} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default EditTrip;
