import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

type Item = { key: string; label: string; value: number; color: string };

interface Props {
  tripId: string;
  initialDesglose: Record<string, number>;
  initialTotal: number;
  onChange?: (newTotal: number, newDesglose: Record<string, number>) => void;
}

const ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: "vuelos", label: "Vuelos", color: "hsl(var(--primary))" },
  { key: "hospedaje", label: "Hospedaje", color: "hsl(41 60% 70%)" },
  { key: "comida", label: "Comida", color: "hsl(28 50% 55%)" },
  { key: "tours", label: "Tours", color: "hsl(35 40% 45%)" },
  { key: "transporte_local", label: "Transporte", color: "hsl(25 30% 35%)" },
  { key: "extras", label: "Extras", color: "hsl(40 20% 50%)" },
];

const fmtMXN = (n: number) =>
  `$${Math.round(n).toLocaleString("es-MX")} MXN`;

export const EditableBudget = ({ tripId, initialDesglose, initialTotal, onChange }: Props) => {
  const buildItems = (d: Record<string, number>): Item[] =>
    ORDER.filter((o) => d[o.key] != null && Number(d[o.key]) > 0).map((o) => ({
      ...o,
      value: Number(d[o.key]) || 0,
    }));

  const [items, setItems] = useState<Item[]>(buildItems(initialDesglose));
  const [baselineTotal] = useState<number>(initialTotal || items.reduce((s, i) => s + i.value, 0));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ idx: number; startX: number; startItems: Item[]; total: number } | null>(null);

  const total = items.reduce((s, i) => s + i.value, 0);

  useEffect(() => {
    onChange?.(total, Object.fromEntries(items.map((i) => [i.key, Math.round(i.value)])));
  }, [items]);

  const onPointerDown = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      idx,
      startX: e.clientX,
      startItems: items.map((i) => ({ ...i })),
      total,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !barRef.current) return;
    const { idx, startX, startItems, total } = dragRef.current;
    const barWidth = barRef.current.offsetWidth;
    const deltaPx = e.clientX - startX;
    const deltaValue = (deltaPx / barWidth) * total;

    const a = startItems[idx].value + deltaValue;
    const b = startItems[idx + 1].value - deltaValue;
    const min = total * 0.02;
    if (a < min || b < min) return;

    const next = startItems.map((i) => ({ ...i }));
    next[idx].value = a;
    next[idx + 1].value = b;
    setItems(next);
    setDirty(true);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const updateValue = (key: string, raw: string) => {
    const num = Math.max(0, Number(raw.replace(/[^0-9.]/g, "")) || 0);
    setItems((curr) => curr.map((i) => (i.key === key ? { ...i, value: num } : i)));
    setDirty(true);
  };

  const warnedRef = useRef(false);
  useEffect(() => {
    const ratio = total / (baselineTotal || 1);
    if (ratio > 1.1 && !warnedRef.current) {
      warnedRef.current = true;
      toast.warning("El presupuesto subió", {
        description: `Tu nuevo total es ${fmtMXN(total)} (+${Math.round((ratio - 1) * 100)}% sobre el original de ${fmtMXN(baselineTotal)}).`,
      });
    }
    if (ratio <= 1.05) warnedRef.current = false;
  }, [total, baselineTotal]);

  const reset = () => {
    setItems(buildItems(initialDesglose));
    setDirty(false);
    warnedRef.current = false;
  };

  const save = async () => {
    setSaving(true);
    const desglose = Object.fromEntries(items.map((i) => [i.key, Math.round(i.value)]));
    const { error } = await supabase
      .from("trips")
      .update({ desglose_presupuesto: desglose, total_estimado: Math.round(total) })
      .eq("id", tripId);
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar", { description: error.message });
      return;
    }
    toast.success("Presupuesto actualizado");
    setDirty(false);
  };

  if (items.length === 0) return null;

  return (
    <div className="glass-card rounded-2xl p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-primary mb-1">Nuevo total</p>
          <p className="font-display text-3xl md:text-4xl gold-text">{fmtMXN(total)}</p>
          {Math.round(total) !== Math.round(baselineTotal) && (
            <p className="text-xs text-muted-foreground mt-1">
              Original: {fmtMXN(baselineTotal)} · {total > baselineTotal ? "+" : ""}
              {Math.round(((total - baselineTotal) / baselineTotal) * 100)}%
            </p>
          )}
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={saving}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restablecer
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="w-3.5 h-3.5 mr-1.5" /> {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        )}
      </div>

      <div
        ref={barRef}
        className="relative flex h-5 rounded-full overflow-hidden mb-3 select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {items.map((it, i) => {
          const pct = (it.value / total) * 100;
          const isLast = i === items.length - 1;
          return (
            <div key={it.key} className="relative h-full" style={{ width: `${pct}%`, background: it.color }} title={`${it.label}: ${fmtMXN(it.value)}`}>
              {!isLast && (
                <div
                  onPointerDown={onPointerDown(i)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-7 rounded-full bg-white/90 border border-black/10 shadow cursor-ew-resize z-10 hover:scale-110 transition"
                  aria-label={`Ajustar ${it.label}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mb-6">
        Arrastra los puntos blancos en la barra para redistribuir sin cambiar el total, o edita los montos abajo.
      </p>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((it) => (
          <div key={it.key} className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: it.color }} />
            <div className="flex-1">
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-sm text-muted-foreground">{it.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {Math.round((it.value / total) * 100)}%
                </span>
              </div>
              <Input
                type="text"
                inputMode="numeric"
                value={Math.round(it.value).toString()}
                onChange={(e) => updateValue(it.key, e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EditableBudget;
