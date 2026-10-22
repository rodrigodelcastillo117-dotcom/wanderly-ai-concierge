import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Users, Plus, Trash2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { computeSplit, hasPayments, parseSplitAmount } from "@/lib/split";
import { convertedTotal, formatMoney, fxLabel } from "@/lib/fx";
import { useFxTable } from "@/hooks/useFxTable";

const MONEDAS = ["MXN", "USD", "EUR", "GBP", "JPY", "CAD"] as const;

type Person = { id: string; name: string };
type Expense = { id: string; payer_id: string; amount: number; currency?: string | null; description: string; created_at: string };

const TripSplit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [newName, setNewName] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [payer, setPayer] = useState("");
  const [currency, setCurrency] = useState<string>("MXN");
  const fx = useFxTable();
  const tipSplit = useTooltipShown("split");

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [{ data: t }, { data: ps }, { data: ex }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).maybeSingle(),
        supabase.from("trip_split_people").select("*").eq("trip_id", id).order("created_at"),
        supabase.from("trip_split_expenses").select("*").eq("trip_id", id).order("created_at", { ascending: false }),
      ]);
      setTrip(t);
      setPeople((ps as Person[]) || []);
      setExpenses((ex as Expense[]) || []);
    })();
  }, [id]);

  const addPerson = async () => {
    const n = newName.trim();
    if (!n || !id) return;
    setNewName("");
    const { data, error } = await supabase.from("trip_split_people").insert({ trip_id: id, name: n }).select().single();
    if (!error && data) setPeople(prev => [...prev, data as Person]);
    else toast.error("No se pudo agregar");
  };

  // Quitar a alguien ya no borra lo que pagó (cambiaba los saldos de todos): primero sus gastos.
  const removePerson = async (pid: string) => {
    const person = people.find(p => p.id === pid);
    if (hasPayments(pid, expenses)) {
      toast.error(`${person?.name ?? "Esta persona"} tiene pagos registrados`, { description: "Borra primero sus gastos para quitarla." });
      return;
    }
    const { error } = await supabase.from("trip_split_people").delete().eq("id", pid);
    if (error) { toast.error("No se pudo quitar"); return; }
    setPeople(prev => prev.filter(p => p.id !== pid));
  };

  const addExp = async () => {
    const a = parseSplitAmount(amount);
    if (!payer || !desc.trim() || !id) return;
    if (a == null) { toast.error("El monto debe ser mayor a 0"); return; }
    const row = { trip_id: id, payer_id: payer, amount: a, description: desc.trim(), currency };
    let { data, error } = await supabase.from("trip_split_expenses").insert(row).select().single();
    if (error && currency === "MXN") {
      // Sin la columna currency (migración 20261022143200 pendiente) un gasto en MXN se guarda igual.
      ({ data, error } = await supabase.from("trip_split_expenses")
        .insert({ trip_id: id, payer_id: payer, amount: a, description: desc.trim() }).select().single());
    }
    if (!error && data) {
      setExpenses(prev => [data as Expense, ...prev]);
      setAmount(""); setDesc("");
    } else toast.error("No se pudo guardar");
  };

  const removeExp = async (eid: string) => {
    setExpenses(prev => prev.filter(x => x.id !== eid));
    await supabase.from("trip_split_expenses").delete().eq("id", eid);
  };

  // Saldos y "cómo saldar" por moneda (nunca se mezclan MXN y EUR como si fueran lo mismo).
  const split = useMemo(() => computeSplit(people, expenses), [people, expenses]);
  const monedas = Object.keys(split.totals);
  const enMxn = fx && monedas.length > 1
    ? convertedTotal(monedas.map((c) => ({ amount: split.totals[c], currency: c })), "MXN", fx)
    : null;

  return (
    <DashboardLayout>
      <FeatureTooltip id="split" icon="💰" text="Divide gastos con tu acompañante o grupo. Iato lleva la cuenta automática." shouldShow={tipSplit.shouldShow} onDismiss={tipSplit.dismiss} />
      <div className="p-4 sm:p-6 md:p-10 max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <Users className="w-7 h-7 text-primary" />
          <div className="min-w-0">
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Gastos compartidos</p>
            <h1 className="font-display text-2xl sm:text-3xl truncate">{trip?.destino}</h1>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6">
          <h2 className="font-medium mb-3">Personas</h2>
          <div className="flex gap-2 mb-3">
            <Input aria-label="Nombre de la persona" placeholder="Nombre" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()} />
            <Button onClick={addPerson} className="shrink-0" aria-label="Agregar persona"><Plus className="w-4 h-4" aria-hidden="true" /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {people.map(p => (
              <span key={p.id} className="px-3 py-1.5 rounded-full bg-primary/10 text-sm flex items-center gap-2">
                {p.name}
                <button onClick={() => removePerson(p.id)} aria-label={`Quitar a ${p.name}`} className="p-1.5 -m-1.5"><Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" aria-hidden="true" /></button>
              </span>
            ))}
          </div>
        </div>

        {people.length > 0 && (
          <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6">
            <h2 className="font-medium mb-3">Agregar gasto</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <Input aria-label="Descripción del gasto" placeholder="Descripción" value={desc} onChange={e => setDesc(e.target.value)} />
              <div className="flex gap-2">
                <Input type="number" min="0.01" step="0.01" aria-label="Monto del gasto" placeholder="Monto" value={amount} onChange={e => setAmount(e.target.value)} />
                <select aria-label="Moneda del gasto" value={currency} onChange={e => setCurrency(e.target.value)}
                  className="bg-background border border-border rounded-md px-2 text-sm">
                  {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <select className="w-full bg-background border border-border rounded-md p-2 mb-3 text-sm" value={payer} onChange={e => setPayer(e.target.value)}>
              <option value="">¿Quién pagó?</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button onClick={addExp} className="w-full"><Receipt className="w-4 h-4 mr-2" /> Agregar gasto</Button>
          </div>
        )}

        {expenses.length > 0 && (
          <>
            <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6">
              <h2 className="font-medium mb-1">Balances</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Total: {monedas.map(c => formatMoney(split.totals[c], c)).join(" · ")}
                {enMxn && (
                  <span className="block text-[11px]">
                    ≈ {formatMoney(Math.round(enMxn.total), "MXN", 0)} en total
                    {enMxn.unconvertedCount > 0 && ` (sin contar ${Object.keys(enMxn.unconverted).join(", ")}: no tenemos tipo de cambio)`}
                    {" · "}{fxLabel(fx!)}. Los saldos se pagan en la moneda de cada gasto.
                  </span>
                )}
              </p>
              {monedas.map(c => (
                <div key={c} className="mb-2 last:mb-0">
                  {monedas.length > 1 && <p className="text-[11px] uppercase tracking-wider text-primary mt-2">{c}</p>}
                  {people.map(p => {
                    const b = split.balances[c]?.[p.id] || 0;
                    return (
                      <div key={p.id} className="flex justify-between py-1.5 text-sm border-b border-border/30 last:border-0">
                        <span>{p.name}</span>
                        <span className={b >= 0 ? "text-emerald-400" : "text-destructive"}>
                          {b >= 0 ? "+" : "−"}{formatMoney(Math.abs(b), c)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {split.settlements.length > 0 && (
              <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6 border-primary/30">
                <h2 className="font-medium mb-3 text-primary">Cómo saldar</h2>
                {split.settlements.map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-1.5 text-sm">
                    <span className="font-medium">{s.from}</span> → <span className="font-medium">{s.to}</span>: <span className="text-primary">{formatMoney(s.amount, s.currency)}</span>
                  </motion.div>
                ))}
              </div>
            )}

            <div className="glass-card rounded-2xl p-4 sm:p-5">
              <h2 className="font-medium mb-3">Gastos</h2>
              {expenses.map(e => {
                const p = people.find(x => x.id === e.payer_id);
                return (
                  <div key={e.id} className="flex justify-between items-center py-2 border-b border-border/30 last:border-0">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{e.description}</div>
                      <div className="text-xs text-muted-foreground">Pagó {p?.name || "?"}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium">{formatMoney(Number(e.amount), e.currency || "MXN")}</span>
                      <button onClick={() => removeExp(e.id)} aria-label={`Eliminar gasto ${e.description ?? ""}`.trim()} className="p-2 -m-2"><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" aria-hidden="true" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripSplit;
