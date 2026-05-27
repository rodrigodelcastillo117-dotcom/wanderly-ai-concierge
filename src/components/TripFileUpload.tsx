import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Props = { size?: "sm" | "md" };

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic";
const MAX_MB = 15;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function TripFileUpload({ size = "md" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (!user) {
      toast.error("Inicia sesión para guardar el viaje");
      return;
    }
    const files = Array.from(list).slice(0, 6);
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(`${f.name} pesa más de ${MAX_MB}MB`);
        return;
      }
    }
    setLoading(true);
    const tId = toast.loading("Leyendo tu viaje del PDF…");
    try {
      const payload = await Promise.all(files.map(async (f) => ({
        name: f.name,
        mime: f.type || "application/octet-stream",
        data_base64: await fileToBase64(f),
      })));

      const { data, error } = await supabase.functions.invoke("parse-trip-file", { body: { files: payload } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "No pudimos leer el archivo");

      const destinations: string[] = (data.destinations ?? []).filter(Boolean);
      const destino: string = data.destino || destinations.join(" → ") || "Mi viaje";
      const isMulti = destinations.length > 1;

      toast.loading("Guardando tu viaje…", { id: tId });

      const itinerarioDays = (data.itinerario ?? []).map((d: any) => ({
        dia: d.dia,
        titulo: d.ciudad ? `${d.ciudad} — ${d.titulo ?? ""}` : (d.titulo ?? ""),
        ciudad: d.ciudad,
        "mañana": d["mañana"] ?? "",
        tarde: d.tarde ?? "",
        noche: d.noche ?? "",
        fecha: d.fecha ?? null,
      }));

      const { data: trip, error: tErr } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          destino,
          pais_destino: destinations[destinations.length - 1] ?? destino,
          ciudad_origen: data.ciudad_origen ?? null,
          fecha_salida: data.fecha_salida ?? null,
          fecha_regreso: data.fecha_regreso ?? null,
          num_viajeros: data.num_viajeros ?? 2,
          presupuesto_objetivo: data.presupuesto_total_mxn ?? null,
          total_estimado: data.presupuesto_total_mxn ?? null,
          moneda: "MXN",
          status: "listo",
          analisis_ai: data.summary ?? null,
          vuelos_json: data.vuelos_json ?? [],
          hospedaje_json: data.hospedaje_json ?? [],
          restaurantes_json: [],
          tours_json: [],
          itinerario_json: {
            multi: isMulti,
            destinations,
            from_pdf: true,
            cruceros: data.cruceros ?? [],
            days: itinerarioDays,
          },
          tips_personalizados: data.notas_generales ? [data.notas_generales] : null,
        })
        .select("id")
        .single();

      if (tErr) throw tErr;

      toast.success("Viaje guardado tal cual tu PDF", { id: tId });
      navigate(`/dashboard/viajes/${trip.id}`);
    } catch (e: any) {
      toast.error(e.message ?? "Error procesando archivo", { id: tId });
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const dim = size === "sm" ? "h-8 w-8 md:h-9 md:w-9" : "h-10 w-10";
  const icon = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        aria-label="Adjuntar PDF o imagen del viaje"
        title="Adjuntar PDF o imagen del viaje (lo guarda tal cual)"
        className={`${dim} shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-primary/10 hover:border-primary/30`}
      >
        {loading
          ? <Loader2 className={`${icon} animate-spin text-primary`} />
          : <Paperclip className={`${icon} text-primary`} />}
      </Button>
    </>
  );
}
