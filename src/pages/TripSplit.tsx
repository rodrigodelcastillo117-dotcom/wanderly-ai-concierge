import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Users, Plus, Trash2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { toast } from "sonner";

type Person = { id: string; name: string };
type Expense = { id: string; payer_id: string; amount: number; description: string; created_at: string };

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

  const removePerson = async (pid: string) => {
    setPeople(prev => prev.filter(p => p.id !== pid));
    await supabase.from("trip_split_people").delete().eq("id", pid);
    // Refresh expenses (cascade may have deleted some)
    const { data: ex } = await supabase.from("trip_split_expenses").select("*").eq("trip_id", id!).order("created_at", { ascending: false });
    setExpenses((ex as Expense[]) || []);
  };

  const addExp = async () => {
    const a = parseFloat(amount);
    if (!a || !payer || !desc.trim() || !id) return;
    const { data, error } = await supabase
      .from("trip_split_expenses")
      .insert({ trip_id: id, payer_id: payer, amount: a, description: desc.trim() })
      .select().single();
    if (!error && data) {
      setExpenses(prev => [data as Expense, ...prev]);
      setAmount(""); setDesc("");
    } else toast.error("No se pudo guardar");
  };

  const removeExp = async (eid: string) => {
    setExpenses(prev => prev.filter(x => x.id !== eid));
    await supabase.from("trip_split_expenses").delete().eq("id", eid);
  };

  const balances = useMemo(() => {
    if (people.length === 0) return {} as Record<string, number>;
    const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const share = total / people.length;
    const paid: Record<string, number> = {};
    people.forEach(p => paid[p.id] = 0);
    expenses.forEach(e => { paid[e.payer_id] = (paid[e.payer_id] || 0) + Number(e.amount); });
    const out: Record<string, number> = {};
    people.forEach(p => out[p.id] = (paid[p.id] || 0) - share);
    return out;
  }, [people, expenses]);

  const settlements = useMemo(() => {
    const debtors = people.filter(p => (balances[p.id] || 0) < -0.01).map(p => ({ ...p, b: balances[p.id] }));
    const creditors = people.filter(p => (balances[p.id] || 0) > 0.01).map(p => ({ ...p, b: balances[p.id] }));
    const out: { from: string; to: string; amount: number }[] = [];
    debtors.sort((a, b) => a.b - b.b); creditors.sort((a, b) => b.b - a.b);
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amt = Math.min(-debtors[i].b, creditors[j].b);
      out.push({ from: debtors[i].name, to: creditors[j].name, amount: amt });
      debtors[i].b += amt; creditors[j].b -= amt;
      if (Math.abs(debtors[i].b) < 0.01) i++;
      if (Math.abs(creditors[j].b) < 0.01) j++;
    }
    return out;
  }, [balances, people]);

  return (
    <DashboardLayout>
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
            <Input placeholder="Nombre" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()} />
            <Button onClick={addPerson} className="shrink-0"><Plus className="w-4 h-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {people.map(p => (
              <span key={p.id} className="px-3 py-1.5 rounded-full bg-primary/10 text-sm flex items-center gap-2">
                {p.name}
                <button onClick={() => removePerson(p.id)}><Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" /></button>
              </span>
            ))}
          </div>
        </div>

        {people.length > 0 && (
          <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6">
            <h2 className="font-medium mb-3">Agregar gasto</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <Input placeholder="Descripción" value={desc} onChange={e => setDesc(e.target.value)} />
              <Input type="number" placeholder="Monto" value={amount} onChange={e => setAmount(e.target.value)} />
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
              <h2 className="font-medium mb-3">Balances</h2>
              {people.map(p => {
                const b = balances[p.id] || 0;
                return (
                  <div key={p.id} className="flex justify-between py-1.5 text-sm border-b border-border/30 last:border-0">
                    <span>{p.name}</span>
                    <span className={b >= 0 ? "text-emerald-400" : "text-destructive"}>
                      {b >= 0 ? "+" : ""}{b.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>

            {settlements.length > 0 && (
              <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6 border-primary/30">
                <h2 className="font-medium mb-3 text-primary">Cómo saldar</h2>
                {settlements.map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-1.5 text-sm">
                    <span className="font-medium">{s.from}</span> → <span className="font-medium">{s.to}</span>: <span className="text-primary">${s.amount.toFixed(2)}</span>
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
                      <span className="text-sm font-medium">${Number(e.amount).toFixed(2)}</span>
                      <button onClick={() => removeExp(e.id)}><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" /></button>
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
