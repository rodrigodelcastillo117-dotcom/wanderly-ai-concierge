import { useState } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  tripId: string;
  onUpdated: () => void;
}

const EJEMPLOS = [
  "Quita Florencia y agrega Cinque Terre 2 noches",
  "Reorganiza los días para que termine en Roma",
  "Baja el presupuesto, busca hoteles de 3★ y vuelos económicos",
  "Cambia las fechas: ahora salgo el 10 de julio y regreso el 22",
  "Agrega un tour gastronómico en cada ciudad",
  "Cambia hospedaje a Airbnbs con cocina",
];

export const EditWithAIDialog = ({ tripId, onUpdated }: Props) => {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!instruction.trim() || loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("editar-viaje-ai", {
        body: { trip_id: tripId, instruction: instruction.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Viaje actualizado por IATOS AI");
      setOpen(false);
      setInstruction("");
      onUpdated();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar el viaje");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary/90 px-2.5 py-2 text-sm font-medium text-primary-foreground shadow-lg transition hover:bg-primary sm:px-4"
        aria-label="Editar viaje con IA"
      >
        <Sparkles className="w-4 h-4" /> <span className="hidden sm:inline">Editar con IA</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => !loading && setOpen(false)}>
          <div
            className="glass-card rounded-2xl p-5 md:p-8 w-full max-w-2xl max-h-[88vh] overflow-y-auto gold-border relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h3 className="font-display text-2xl">Editar viaje con IATOS AI</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Describe los cambios y la IA reorganizará, recotizará y actualizará todo: rutas, vuelos, hospedaje, itinerario y presupuesto.
            </p>

            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Ej: Cambia Florencia por Cinque Terre, sube a 4★ y agrega un tour en barco..."
              rows={5}
              disabled={loading}
              className="w-full bg-background/40 border border-border/50 rounded-xl p-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {EJEMPLOS.map((ej) => (
                <button
                  key={ej}
                  onClick={() => setInstruction(ej)}
                  disabled={loading}
                  className="text-xs px-3 py-1.5 rounded-full border border-border/50 text-muted-foreground hover:text-foreground hover:gold-border transition disabled:opacity-50"
                >
                  {ej}
                </button>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={loading || !instruction.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Rehaciendo viaje...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Aplicar cambios
                  </>
                )}
              </button>
            </div>

            {loading && (
              <p className="text-xs text-muted-foreground mt-4 text-center">
                IATOS AI está reorganizando rutas y recotizando precios. Puede tardar 20-40 segundos.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};
