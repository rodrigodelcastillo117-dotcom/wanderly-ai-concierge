import { Fragment, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, GitCompare, Sparkles, X, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { toast } from "sonner";

type Row = {
  destino: string;
  costo_diario_usd: string;
  mejor_epoca: string;
  visa_mx: string;
  seguridad: string;
  idioma: string;
  highlights: string;
};

const Compare = () => {
  const navigate = useNavigate();
  const [dests, setDests] = useState<string[]>(["", ""]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (i: number, v: string) => setDests(d => d.map((x, idx) => idx === i ? v : x));
  const add = () => dests.length < 4 && setDests([...dests, ""]);
  const remove = (i: number) => dests.length > 2 && setDests(dests.filter((_, idx) => idx !== i));

  const run = async () => {
    const list = dests.map(d => d.trim()).filter(Boolean);
    if (list.length < 2) { toast.error("Agrega al menos 2 destinos"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("concierge-chat", {
        body: {
          messages: [{
            role: "user",
            content: `Compara estos destinos para un viajero mexicano: ${list.join(" vs ")}. Responde SOLO un JSON array así: [{"destino":"...","costo_diario_usd":"$X-Y","mejor_epoca":"...","visa_mx":"Sí/No, info","seguridad":"Alta/Media/Baja + nota","idioma":"...","highlights":"..."}]`
          }]
        }
      });
      if (error) throw error;
      const text = (data?.message || data?.content || data?.reply || "") as string;
      const m = text.match(/\[[\s\S]*\]/);
      if (m) setRows(JSON.parse(m[0]));
      else toast.error("No se pudo procesar");
    } catch { toast.error("Error al comparar"); }
    setLoading(false);
  };

  const fields: { key: keyof Row; label: string }[] = [
    { key: "costo_diario_usd", label: "Costo diario" },
    { key: "mejor_epoca", label: "Mejor época" },
    { key: "visa_mx", label: "Visa (MX)" },
    { key: "seguridad", label: "Seguridad" },
    { key: "idioma", label: "Idioma" },
    { key: "highlights", label: "Highlights" },
  ];

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 md:p-10 max-w-6xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="mb-6 flex items-center gap-3">
          <GitCompare className="w-7 h-7 text-primary" />
          <div>
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Comparador</p>
            <h1 className="font-display text-3xl md:text-4xl">Destino vs destino</h1>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6 space-y-2">
          {dests.map((d, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder={`Destino ${i + 1} (ej: Tokio, Japón)`} value={d} onChange={e => set(i, e.target.value)} />
              {dests.length > 2 && (
                <Button variant="ghost" size="icon" onClick={() => remove(i)}><X className="w-4 h-4" /></Button>
              )}
            </div>
          ))}
          <div className="flex flex-col sm:flex-row gap-2">
            {dests.length < 4 && (
              <Button variant="outline" onClick={add} className="sm:flex-1"><Plus className="w-4 h-4 mr-1" /> Otro destino</Button>
            )}
            <Button onClick={run} disabled={loading} className="sm:flex-1">
              <Sparkles className="w-4 h-4 mr-2" /> {loading ? "Comparando..." : "Comparar"}
            </Button>
          </div>
        </div>

        {rows && (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[600px] px-4 sm:px-0">
              <div className="grid gap-px bg-border rounded-2xl overflow-hidden" style={{ gridTemplateColumns: `140px repeat(${rows.length}, minmax(160px, 1fr))` }}>
                <div className="bg-card p-3 text-xs uppercase tracking-wider text-muted-foreground">Aspecto</div>
                {rows.map((r, i) => (
                  <div key={i} className="bg-card p-3 font-display text-lg">{r.destino}</div>
                ))}
                {fields.map(f => (
                  <>
                    <div key={`l-${f.key}`} className="bg-card p-3 text-sm font-medium text-primary">{f.label}</div>
                    {rows.map((r, i) => (
                      <div key={`${f.key}-${i}`} className="bg-card p-3 text-sm">{r[f.key]}</div>
                    ))}
                  </>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Compare;
