import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Plus, Trash2, Luggage, AlertCircle, Sparkles, Loader2, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";

type Item = { id: string; text: string; done: boolean; category: string; sort_order: number };

const buildDefaults = (destino: string, dias: number, pais?: string): Omit<Item, "id">[] => {
  const d = (destino + " " + (pais ?? "")).toLowerCase();
  const isBeach = /(playa|beach|caribe|cancun|tulum|maldivas|bali|hawaii|riviera|isla|bora|fiji|seychelles|phuket|punta cana)/.test(d);
  const isCold = /(islandia|noruega|alaska|patagonia|invierno|ski|esqui|montaña|alpes|aspen|tokio invierno|moscú|finlandia|suecia)/.test(d);
  const isTropical = /(tailandia|vietnam|indonesia|filipinas|malasia|costa rica|amazonas|brasil)/.test(d);
  const isCity = /(nueva york|tokio|paris|londres|roma|barcelona|madrid|dubai|hong kong|cdmx|ny|berlin|amsterdam)/.test(d);
  const isHiking = /(patagonia|himalaya|machu|trek|hiking|montaña|kilimanjaro)/.test(d);
  const isIntl = !!pais && !/mexico|méxico/i.test(pais);

  const base: { text: string; category: string }[] = [
    { text: "Pasaporte vigente", category: "Documentos" },
    { text: "Identificación oficial", category: "Documentos" },
    { text: "Itinerario impreso o digital", category: "Documentos" },
    { text: "Reservas de hospedaje", category: "Documentos" },
    { text: "Boletos de vuelo / transporte", category: "Documentos" },
    { text: "Seguro de viaje", category: "Documentos" },
    { text: "Cargador del celular", category: "Electrónicos" },
    { text: "Adaptador universal", category: "Electrónicos" },
    { text: "Audífonos", category: "Electrónicos" },
    { text: "Power bank", category: "Electrónicos" },
    { text: "Cepillo y pasta de dientes", category: "Higiene" },
    { text: "Shampoo y acondicionador", category: "Higiene" },
    { text: "Desodorante", category: "Higiene" },
    { text: "Bloqueador solar SPF 50", category: "Higiene" },
    { text: "Analgésicos / paracetamol", category: "Salud" },
    { text: "Medicamentos personales", category: "Salud" },
    { text: "Curitas / banditas", category: "Salud" },
    { text: `Ropa interior (${dias + 2} mudas)`, category: "Ropa" },
    { text: `Calcetines (${dias + 2} pares)`, category: "Ropa" },
    { text: "Pijama", category: "Ropa" },
    { text: "Outfits cómodos para el día", category: "Ropa" },
    { text: "Zapatos cómodos para caminar", category: "Ropa" },
  ];
  if (isIntl) base.push(
    { text: "Visa (si aplica)", category: "Documentos" },
    { text: "Tarjeta sin cargos internacionales", category: "Documentos" },
    { text: "Moneda local en efectivo", category: "Documentos" },
    { text: "Copia digital del pasaporte", category: "Documentos" },
  );
  if (isBeach) base.push(
    { text: "Traje de baño (2)", category: "Playa" },
    { text: "Toalla de playa rápida", category: "Playa" },
    { text: "Sandalias", category: "Playa" },
    { text: "Lentes de sol", category: "Playa" },
    { text: "Sombrero o cachucha", category: "Playa" },
    { text: "After-sun / aloe vera", category: "Playa" },
  );
  if (isCold) base.push(
    { text: "Chamarra térmica / abrigo", category: "Frío" },
    { text: "Guantes y bufanda", category: "Frío" },
    { text: "Gorro / beanie", category: "Frío" },
    { text: "Botas impermeables", category: "Frío" },
    { text: "Térmicas (base layers)", category: "Frío" },
  );
  if (isTropical) base.push(
    { text: "Repelente de insectos", category: "Tropical" },
    { text: "Ropa ligera de algodón/lino", category: "Tropical" },
    { text: "Impermeable ligero", category: "Tropical" },
  );
  if (isCity) base.push(
    { text: "Mochila / bolsa anti-robo", category: "Ciudad" },
    { text: "Outfit para salir de noche", category: "Ciudad" },
  );
  if (isHiking) base.push(
    { text: "Botas de trekking", category: "Outdoor" },
    { text: "Mochila técnica", category: "Outdoor" },
    { text: "Botella reutilizable", category: "Outdoor" },
    { text: "Linterna frontal", category: "Outdoor" },
  );

  return base.map((b, i) => ({ ...b, done: false, sort_order: i }));
};

const TripPacking = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [newItem, setNewItem] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const suggestWithAI = async () => {
    if (!trip || !id) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-packing", { body: { trip } });
      if (error) throw error;
      const suggestions: { text: string; category: string }[] = data?.items ?? [];
      if (!suggestions.length) { toast.info("La IA no devolvió sugerencias"); return; }
      const existing = new Set(items.map(i => i.text.toLowerCase().trim()));
      const fresh = suggestions
        .filter(s => s.text && !existing.has(s.text.toLowerCase().trim()))
        .map((s, i) => ({
          trip_id: id, text: s.text, category: s.category || "Personalizado",
          done: false, sort_order: items.length + i,
        }));
      if (!fresh.length) { toast.success("Tu lista ya está completa ✨"); return; }
      const { data: ins, error: insErr } = await supabase.from("trip_packing_items").insert(fresh).select();
      if (insErr) throw insErr;
      setItems(prev => [...prev, ...(ins as Item[])]);
      toast.success(`+${ins?.length ?? fresh.length} sugerencias inteligentes`);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudieron generar sugerencias");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: t } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(t);
      const { data: existing } = await supabase
        .from("trip_packing_items")
        .select("*")
        .eq("trip_id", id)
        .order("sort_order", { ascending: true });

      if (existing && existing.length > 0) {
        setItems(existing as Item[]);
      } else if (t) {
        const start = t.fecha_salida ? new Date(t.fecha_salida) : new Date();
        const end = t.fecha_regreso ? new Date(t.fecha_regreso) : start;
        const dias = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
        const defaults = buildDefaults(t.destino, dias, t.pais_destino);
        const rows = defaults.map(d => ({ ...d, trip_id: id }));
        const { data: ins, error } = await supabase.from("trip_packing_items").insert(rows).select();
        if (!error && ins) setItems(ins as Item[]);
      }
      setLoading(false);
    })();
  }, [id]);

  const toggle = async (it: Item) => {
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, done: !x.done } : x));
    await supabase.from("trip_packing_items").update({ done: !it.done }).eq("id", it.id);
  };

  const remove = async (itemId: string) => {
    setItems(prev => prev.filter(x => x.id !== itemId));
    await supabase.from("trip_packing_items").delete().eq("id", itemId);
  };

  const add = async () => {
    const t = newItem.trim();
    if (!t || !id) return;
    setNewItem("");
    const { data, error } = await supabase
      .from("trip_packing_items")
      .insert({ trip_id: id, text: t, category: "Personalizado", sort_order: items.length })
      .select().single();
    if (!error && data) setItems(prev => [...prev, data as Item]);
    else if (error) toast.error("No se pudo agregar");
  };

  const reset = async () => {
    if (!trip || !id || !confirm("¿Resetear la lista a los valores recomendados?")) return;
    await supabase.from("trip_packing_items").delete().eq("trip_id", id);
    const start = trip.fecha_salida ? new Date(trip.fecha_salida) : new Date();
    const end = trip.fecha_regreso ? new Date(trip.fecha_regreso) : start;
    const dias = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const defaults = buildDefaults(trip.destino, dias, trip.pais_destino);
    const rows = defaults.map(d => ({ ...d, trip_id: id }));
    const { data } = await supabase.from("trip_packing_items").insert(rows).select();
    if (data) setItems(data as Item[]);
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    items.forEach(it => { if (!m.has(it.category)) m.set(it.category, []); m.get(it.category)!.push(it); });
    return Array.from(m.entries());
  }, [items]);

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (!trip) return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Viaje no encontrado</div>;

  return (
    <div className="min-h-screen bg-background text-foreground pb-32">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[140px]" />
      </div>

      <div className="px-4 md:px-8 pt-5 max-w-[900px] mx-auto">
        <BackButton floating />
        <div className="flex items-center gap-3 mb-5 mt-10">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Luggage className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Packing list</div>
            <h1 className="text-xl md:text-3xl font-serif truncate">{trip.destino}</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={suggestWithAI}
            disabled={aiLoading}
            className="border-primary/40 text-primary hover:bg-primary/10"
          >
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 mr-1" />}
            Sugerencias IA
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">{done} de {total} listos</span>
            <span className="text-sm text-primary font-bold">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-black/40 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex gap-2 mb-5">
          <Input
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === "Enter" && add()}
            placeholder="Agregar algo más…"
            className="bg-white/[0.02] border-white/[0.08]"
          />
          <Button onClick={add} className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
            <Plus className="w-4 h-4" />
          </Button>
        </div>


        <div className="space-y-5">
          {grouped.map(([cat, list]) => (
            <section key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <h2 className="text-xs uppercase tracking-[0.18em] text-foreground/70 font-semibold">{cat}</h2>
                <span className="text-[10px] text-foreground/40 ml-auto">{list.filter(i => i.done).length}/{list.length}</span>
              </div>
              <ul className="space-y-1.5">
                {list.map(it => (
                  <li key={it.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${it.done ? "bg-primary/[0.06] border-primary/20" : "bg-white/[0.02] border-white/[0.05]"}`}>
                    <button
                      onClick={() => toggle(it)}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition ${it.done ? "bg-primary border-primary" : "border-white/20"}`}
                    >
                      {it.done && <Check className="w-3 h-3 text-primary-foreground" />}
                    </button>
                    <span className={`flex-1 text-sm ${it.done ? "line-through text-foreground/40" : "text-foreground/90"}`}>{it.text}</span>
                    <button onClick={() => remove(it.id)} className="text-foreground/30 hover:text-red-400 transition shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-6 p-4 rounded-xl border border-primary/15 bg-primary/[0.04] flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground/70">
            Lista guardada en la nube y compartida con tus colaboradores del viaje.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TripPacking;
