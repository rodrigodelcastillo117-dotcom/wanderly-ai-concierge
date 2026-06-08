import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Check,
  Luggage,
  Loader2,
  RefreshCw,
  Crown,
  Info,
  Sparkles,
  CloudRain,
  ChevronDown,
  Plane,
  PackageCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";

type Prioridad = "esencial" | "recomendado" | "opcional";
type Donde = "carry_on" | "documentado" | "ambos";

type Item = {
  id: string;
  nombre: string;
  cantidad: string;
  prioridad: Prioridad;
  donde: Donde;
  nota?: string;
};
type Categoria = { id: string; nombre: string; items: Item[] };
type Lista = {
  resumen: string;
  alerta_clima?: string;
  categorias: Categoria[];
  tips_iato: string[];
};

const prioridadStyles: Record<Prioridad, string> = {
  esencial: "bg-red-500/15 text-red-300 border border-red-500/30",
  recomendado: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  opcional: "bg-white/[0.06] text-foreground/60 border border-white/10",
};

const dondeStyles: Record<Donde, string> = {
  carry_on: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
  documentado: "bg-white/[0.04] text-foreground/60 border border-white/10",
  ambos: "bg-primary/15 text-primary border border-primary/30",
};

const dondeLabel: Record<Donde, string> = {
  carry_on: "Carry-on",
  documentado: "Documentado",
  ambos: "Ambos",
};

const itemKey = (catId: string, itemId: string) => `${catId}::${itemId}`;

const TripPacking = () => {
  const { id } = useParams();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lista, setLista] = useState<Lista | null>(null);
  const [estado, setEstado] = useState<Record<string, boolean>>({});
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipPacking = useTooltipShown("packing");

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: t }, { data: pl }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).maybeSingle(),
        supabase.from("packing_lists").select("*").eq("trip_id", id).maybeSingle(),
      ]);
      setTrip(t);
      if (pl) {
        setLista(pl.lista_json as Lista);
        setEstado((pl.estado_checkboxes as Record<string, boolean>) ?? {});
        // open first category by default
        const cats = (pl.lista_json as Lista)?.categorias ?? [];
        if (cats[0]) setOpenCats({ [cats[0].id]: true });
      }
      setLoading(false);
    })();
  }, [id]);

  const persistEstado = (next: Record<string, boolean>) => {
    if (!id) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      await supabase
        .from("packing_lists")
        .update({ estado_checkboxes: next, updated_at: new Date().toISOString() })
        .eq("trip_id", id);
    }, 500);
  };

  const toggle = (catId: string, itemId: string) => {
    const k = itemKey(catId, itemId);
    setEstado((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      persistEstado(next);
      return next;
    });
  };

  const generar = async (regenerar = false) => {
    if (!id) return;
    if (regenerar && !confirm("¿Regenerar la lista? Se perderá el progreso actual.")) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generar-packing-list", {
        body: { trip_id: id },
      });
      if (error) throw error;
      if (!data?.packing_list) throw new Error("Sin lista");
      setLista(data.packing_list.lista_json as Lista);
      setEstado(regenerar ? {} : (data.packing_list.estado_checkboxes ?? {}));
      const cats = (data.packing_list.lista_json as Lista)?.categorias ?? [];
      if (cats[0]) setOpenCats({ [cats[0].id]: true });
      toast.success("Iato preparó tu equipaje ✨");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "No se pudo generar la lista");
    } finally {
      setGenerating(false);
    }
  };

  const { total, done, pct } = useMemo(() => {
    if (!lista) return { total: 0, done: 0, pct: 0 };
    let t = 0,
      d = 0;
    for (const c of lista.categorias) {
      for (const it of c.items) {
        t++;
        if (estado[itemKey(c.id, it.id)]) d++;
      }
    }
    return { total: t, done: d, pct: t ? Math.round((d / t) * 100) : 0 };
  }, [lista, estado]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-foreground/60">
        Viaje no encontrado
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-32">
      <FeatureTooltip
        id="packing"
        icon="🎒"
        text="Lista de equipaje generada por Iato: cantidades inteligentes, notas culturales y todo lo del Vault."
        shouldShow={tipPacking.shouldShow}
        onDismiss={tipPacking.dismiss}
      />

      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-[#C9A961]/[0.05] blur-[140px]" />
        <div className="absolute top-1/2 -left-40 w-[420px] h-[420px] rounded-full bg-primary/[0.04] blur-[140px]" />
      </div>

      <div className="px-4 md:px-8 pt-5 max-w-[900px] mx-auto">
        <BackButton floating />

        <header className="flex items-start gap-3 mb-6 mt-10">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#C9A961]/30 to-[#C9A961]/5 border border-[#C9A961]/30 flex items-center justify-center shrink-0">
            <Luggage className="w-5 h-5 text-[#C9A961]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#C9A961] font-semibold">
              Iato Packing
            </div>
            <h1 className="font-serif text-2xl md:text-4xl leading-tight truncate">
              Tu equipaje para {trip.destino}
            </h1>
            {lista?.resumen && (
              <p className="text-sm text-foreground/60 mt-1 font-[Manrope,system-ui]">
                {lista.resumen}
              </p>
            )}
          </div>
          {lista && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => generar(true)}
              disabled={generating}
              className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10 shrink-0"
            >
              {generating ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
              )}
              Regenerar
            </Button>
          )}
        </header>

        {!lista && !generating && (
          <div className="rounded-3xl border border-[#C9A961]/20 bg-gradient-to-b from-[#C9A961]/[0.06] to-transparent p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[#C9A961]/15 border border-[#C9A961]/30 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Crown className="w-7 h-7 text-[#C9A961]" />
            </div>
            <h2 className="font-serif text-2xl mb-2">Iato puede armar tu equipaje</h2>
            <p className="text-sm text-foreground/60 max-w-md mx-auto mb-6 font-[Manrope,system-ui]">
              Lista premium personalizada por destino, clima, itinerario, vuelos, cenas formales,
              tu Vault y tu Travel DNA.
            </p>
            <Button
              onClick={() => generar(false)}
              className="bg-[#C9A961] text-black hover:bg-[#C9A961]/90 px-6"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generar lista con Iato
            </Button>
          </div>
        )}

        {generating && !lista && (
          <div className="rounded-3xl border border-[#C9A961]/20 bg-white/[0.02] p-10 text-center">
            <Loader2 className="w-8 h-8 text-[#C9A961] animate-spin mx-auto mb-4" />
            <p className="font-serif text-xl">Iato está armando tu equipaje…</p>
            <p className="text-xs text-foreground/50 mt-2">Esto toma 15–30 segundos.</p>
          </div>
        )}

        {lista && (
          <>
            {lista.alerta_clima && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#C9A961]/25 bg-[#C9A961]/[0.06] p-4">
                <CloudRain className="w-4 h-4 text-[#C9A961] mt-0.5 shrink-0" />
                <p className="text-sm text-foreground/85 font-[Manrope,system-ui]">
                  {lista.alerta_clima}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">
                  {done} de {total} empacados
                </span>
                <span className="text-sm text-[#C9A961] font-bold">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-black/40 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#C9A961] to-[#C9A961]/60 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {pct === 100 && (
                <div className="mt-3 flex items-center gap-2 text-xs text-[#C9A961]">
                  <PackageCheck className="w-3.5 h-3.5" />
                  ✨ Equipaje listo. Que tengas un viaje increíble.
                </div>
              )}
            </div>

            <div className="space-y-3">
              {lista.categorias.map((cat) => {
                const open = !!openCats[cat.id];
                const total = cat.items.length;
                const doneCat = cat.items.filter((it) => estado[itemKey(cat.id, it.id)]).length;
                return (
                  <section
                    key={cat.id}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setOpenCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))
                      }
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition"
                    >
                      <span className="font-serif text-base flex-1 truncate">{cat.nombre}</span>
                      <span className="text-[11px] text-foreground/50 font-[Manrope,system-ui]">
                        {doneCat}/{total}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-foreground/50 transition-transform ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {open && (
                      <ul className="px-3 pb-3 space-y-1.5">
                        {cat.items.map((it) => {
                          const k = itemKey(cat.id, it.id);
                          const checked = !!estado[k];
                          const noteOpen = !!expandedNotes[k];
                          return (
                            <li
                              key={it.id}
                              className={`rounded-xl border transition ${
                                checked
                                  ? "bg-[#C9A961]/[0.06] border-[#C9A961]/20"
                                  : "bg-white/[0.02] border-white/[0.05]"
                              }`}
                            >
                              <div className="flex items-start gap-3 p-3">
                                <button
                                  onClick={() => toggle(cat.id, it.id)}
                                  className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center shrink-0 transition active:scale-90 ${
                                    checked
                                      ? "bg-[#C9A961] border-[#C9A961]"
                                      : "border-white/20 hover:border-[#C9A961]/40"
                                  }`}
                                  aria-label={checked ? "Desmarcar" : "Marcar"}
                                >
                                  {checked && <Check className="w-5 h-5 text-black" />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start gap-2 flex-wrap">
                                    <span
                                      className={`text-sm font-[Manrope,system-ui] ${
                                        checked
                                          ? "line-through text-foreground/40"
                                          : "text-foreground/90"
                                      }`}
                                    >
                                      {it.nombre}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#C9A961]/15 text-[#C9A961] border border-[#C9A961]/30 font-semibold">
                                      {it.cantidad}
                                    </span>
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${prioridadStyles[it.prioridad]}`}
                                    >
                                      {it.prioridad}
                                    </span>
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 ${dondeStyles[it.donde]}`}
                                    >
                                      {it.donde === "carry_on" && <Plane className="w-2.5 h-2.5" />}
                                      {dondeLabel[it.donde]}
                                    </span>
                                  </div>
                                  {it.nota && (
                                    <button
                                      onClick={() =>
                                        setExpandedNotes((prev) => ({
                                          ...prev,
                                          [k]: !prev[k],
                                        }))
                                      }
                                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-foreground/50 hover:text-[#C9A961] transition"
                                    >
                                      <Info className="w-3 h-3" />
                                      {noteOpen ? "Ocultar nota" : "Ver nota de Iato"}
                                    </button>
                                  )}
                                  {it.nota && noteOpen && (
                                    <p className="mt-2 text-[12px] text-foreground/70 leading-relaxed border-l-2 border-[#C9A961]/40 pl-3 font-[Manrope,system-ui]">
                                      {it.nota}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>

            {lista.tips_iato?.length > 0 && (
              <div className="mt-6 rounded-3xl border border-[#C9A961]/25 bg-gradient-to-b from-[#C9A961]/[0.07] to-transparent p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Crown className="w-4 h-4 text-[#C9A961]" />
                  <h3 className="font-serif text-lg">Tips de Iato</h3>
                </div>
                <ol className="space-y-2.5">
                  {lista.tips_iato.map((tip, i) => (
                    <li
                      key={i}
                      className="flex gap-3 text-sm text-foreground/80 font-[Manrope,system-ui]"
                    >
                      <span className="text-[#C9A961] font-bold shrink-0">{i + 1}.</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TripPacking;
