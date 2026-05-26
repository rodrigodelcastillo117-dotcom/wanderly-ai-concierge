import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Plus, Trash2, Luggage, AlertCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = { id: string; text: string; done: boolean; category: string };

// Smart defaults based on destination keywords + duration
const buildDefaults = (destino: string, dias: number, pais?: string): Item[] => {
  const d = (destino + " " + (pais ?? "")).toLowerCase();
  const isBeach = /(playa|beach|caribe|cancun|tulum|maldivas|bali|hawaii|riviera|isla|bora|fiji|seychelles|phuket|punta cana)/.test(d);
  const isCold = /(islandia|noruega|alaska|patagonia|invierno|ski|esqui|montaña|alpes|aspen|tokio invierno|moscú|finlandia|suecia)/.test(d);
  const isTropical = /(tailandia|vietnam|indonesia|filipinas|malasia|costa rica|amazonas|brasil)/.test(d);
  const isCity = /(nueva york|tokio|paris|londres|roma|barcelona|madrid|dubai|hong kong|cdmx|ny|berlin|amsterdam)/.test(d);
  const isHiking = /(patagonia|himalaya|machu|trek|hiking|montaña|kilimanjaro)/.test(d);
  const isInternational = !!pais && !/mexico|méxico/i.test(pais);

  const base: Item[] = [
    { id: "p1", text: "Pasaporte vigente", done: false, category: "Documentos" },
    { id: "p2", text: "Identificación oficial", done: false, category: "Documentos" },
    { id: "p3", text: "Itinerario impreso o digital", done: false, category: "Documentos" },
    { id: "p4", text: "Reservas de hospedaje", done: false, category: "Documentos" },
    { id: "p5", text: "Boletos de vuelo / transporte", done: false, category: "Documentos" },
    { id: "p6", text: "Seguro de viaje", done: false, category: "Documentos" },
    { id: "e1", text: "Cargador del celular", done: false, category: "Electrónicos" },
    { id: "e2", text: "Adaptador universal", done: false, category: "Electrónicos" },
    { id: "e3", text: "Audífonos", done: false, category: "Electrónicos" },
    { id: "e4", text: "Power bank", done: false, category: "Electrónicos" },
    { id: "e5", text: "Cámara y cargador", done: false, category: "Electrónicos" },
    { id: "h1", text: "Cepillo y pasta de dientes", done: false, category: "Higiene" },
    { id: "h2", text: "Shampoo y acondicionador", done: false, category: "Higiene" },
    { id: "h3", text: "Desodorante", done: false, category: "Higiene" },
    { id: "h4", text: "Perfume", done: false, category: "Higiene" },
    { id: "h5", text: "Bloqueador solar SPF 50", done: false, category: "Higiene" },
    { id: "m1", text: "Analgésicos / paracetamol", done: false, category: "Salud" },
    { id: "m2", text: "Medicamentos personales", done: false, category: "Salud" },
    { id: "m3", text: "Curitas / banditas", done: false, category: "Salud" },
    { id: "m4", text: "Antialérgicos", done: false, category: "Salud" },
    { id: "c1", text: `Ropa interior (${dias + 2} mudas)`, done: false, category: "Ropa" },
    { id: "c2", text: `Calcetines (${dias + 2} pares)`, done: false, category: "Ropa" },
    { id: "c3", text: "Pijama", done: false, category: "Ropa" },
    { id: "c4", text: "Outfits cómodos para el día", done: false, category: "Ropa" },
    { id: "c5", text: "Un outfit elegante", done: false, category: "Ropa" },
    { id: "c6", text: "Zapatos cómodos para caminar", done: false, category: "Ropa" },
  ];

  if (isInternational) {
    base.push(
      { id: "i1", text: "Visa (si aplica)", done: false, category: "Documentos" },
      { id: "i2", text: "Tarjeta de débito/crédito sin cargos internacionales", done: false, category: "Documentos" },
      { id: "i3", text: "Moneda local en efectivo", done: false, category: "Documentos" },
      { id: "i4", text: "Copia digital del pasaporte (email/cloud)", done: false, category: "Documentos" },
    );
  }

  if (isBeach) {
    base.push(
      { id: "b1", text: "Traje de baño (2)", done: false, category: "Playa" },
      { id: "b2", text: "Toalla de playa rápida", done: false, category: "Playa" },
      { id: "b3", text: "Sandalias", done: false, category: "Playa" },
      { id: "b4", text: "Lentes de sol", done: false, category: "Playa" },
      { id: "b5", text: "Sombrero o cachucha", done: false, category: "Playa" },
      { id: "b6", text: "After-sun / aloe vera", done: false, category: "Playa" },
      { id: "b7", text: "Snorkel (opcional)", done: false, category: "Playa" },
    );
  }
  if (isCold) {
    base.push(
      { id: "f1", text: "Chamarra térmica / abrigo", done: false, category: "Frío" },
      { id: "f2", text: "Guantes y bufanda", done: false, category: "Frío" },
      { id: "f3", text: "Gorro / beanie", done: false, category: "Frío" },
      { id: "f4", text: "Botas impermeables", done: false, category: "Frío" },
      { id: "f5", text: "Térmicas (base layers)", done: false, category: "Frío" },
      { id: "f6", text: "Crema hidratante facial", done: false, category: "Frío" },
    );
  }
  if (isTropical) {
    base.push(
      { id: "t1", text: "Repelente de insectos", done: false, category: "Tropical" },
      { id: "t2", text: "Ropa ligera de algodón/lino", done: false, category: "Tropical" },
      { id: "t3", text: "Impermeable ligero", done: false, category: "Tropical" },
      { id: "t4", text: "Sales de rehidratación", done: false, category: "Tropical" },
    );
  }
  if (isCity) {
    base.push(
      { id: "ci1", text: "Mochila / bolsa anti-robo", done: false, category: "Ciudad" },
      { id: "ci2", text: "Zapatos para caminar mucho", done: false, category: "Ciudad" },
      { id: "ci3", text: "Outfit para salir de noche", done: false, category: "Ciudad" },
    );
  }
  if (isHiking) {
    base.push(
      { id: "k1", text: "Botas de trekking", done: false, category: "Outdoor" },
      { id: "k2", text: "Mochila técnica", done: false, category: "Outdoor" },
      { id: "k3", text: "Botella reutilizable", done: false, category: "Outdoor" },
      { id: "k4", text: "Bastones de trekking (opcional)", done: false, category: "Outdoor" },
      { id: "k5", text: "Linterna frontal", done: false, category: "Outdoor" },
    );
  }

  return base;
};

const TripPacking = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [newItem, setNewItem] = useState("");

  const storageKey = `packing-${id}`;

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(data);
      // Load from localStorage or build defaults
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try { setItems(JSON.parse(saved)); } catch { /* */ }
      } else if (data) {
        const start = data.fecha_salida ? new Date(data.fecha_salida) : new Date();
        const end = data.fecha_regreso ? new Date(data.fecha_regreso) : start;
        const dias = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
        setItems(buildDefaults(data.destino, dias, data.pais_destino));
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Persist
  useEffect(() => {
    if (!loading && items.length >= 0) {
      localStorage.setItem(storageKey, JSON.stringify(items));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loading]);

  const toggle = (id: string) => setItems(prev => prev.map(it => it.id === id ? { ...it, done: !it.done } : it));
  const remove = (id: string) => setItems(prev => prev.filter(it => it.id !== id));
  const add = () => {
    const t = newItem.trim();
    if (!t) return;
    setItems(prev => [...prev, { id: `c-${Date.now()}`, text: t, done: false, category: "Personalizado" }]);
    setNewItem("");
  };
  const reset = () => {
    if (!trip || !confirm("¿Resetear toda la lista a los valores recomendados?")) return;
    localStorage.removeItem(storageKey);
    const start = trip.fecha_salida ? new Date(trip.fecha_salida) : new Date();
    const end = trip.fecha_regreso ? new Date(trip.fecha_regreso) : start;
    const dias = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    setItems(buildDefaults(trip.destino, dias, trip.pais_destino));
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    items.forEach(it => { if (!m.has(it.category)) m.set(it.category, []); m.get(it.category)!.push(it); });
    return Array.from(m.entries());
  }, [items]);

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Cargando…</div>;
  if (!trip) return <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">Viaje no encontrado</div>;

  return (
    <div className="min-h-screen bg-background text-foreground pb-32">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[140px]" />
      </div>

      <div className="px-4 md:px-8 pt-5 max-w-[900px] mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
            <Luggage className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Packing list</div>
            <h1 className="text-2xl md:text-3xl font-serif truncate">{trip.destino}</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
        </div>

        {/* Progress */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">{done} de {total} listos</span>
            <span className="text-sm text-primary font-bold">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-black/40 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Add item */}
        <div className="flex gap-2 mb-5">
          <Input
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === "Enter" && add()}
            placeholder="Agregar algo más…"
            className="bg-white/[0.02] border-white/[0.08]"
          />
          <Button onClick={add} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Groups */}
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
                      onClick={() => toggle(it.id)}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition ${it.done ? "bg-primary border-primary" : "border-white/20"}`}
                    >
                      {it.done && <Check className="w-3 h-3 text-primary-foreground" />}
                    </button>
                    <span className={`flex-1 text-sm ${it.done ? "line-through text-foreground/40" : "text-foreground/90"}`}>{it.text}</span>
                    <button onClick={() => remove(it.id)} className="text-foreground/30 hover:text-red-400 transition">
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
            Lista generada automáticamente según tu destino, duración y clima esperado. Puedes agregar o quitar lo que quieras — se guarda automáticamente.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TripPacking;
