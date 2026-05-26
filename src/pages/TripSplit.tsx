import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Users, Plus, Trash2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

type Person = { id: string; name: string };
type Expense = { id: string; payerId: string; amount: number; description: string; date: string };

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

  const pKey = `iatos:split:people:${id}`;
  const eKey = `iatos:split:exp:${id}`;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      setTrip(data);
    })();
    try { setPeople(JSON.parse(localStorage.getItem(pKey) || "[]")); } catch {}
    try { setExpenses(JSON.parse(localStorage.getItem(eKey) || "[]")); } catch {}
  }, [id]);

  const savePeople = (l: Person[]) => { setPeople(l); localStorage.setItem(pKey, JSON.stringify(l)); };
  const saveExp = (l: Expense[]) => { setExpenses(l); localStorage.setItem(eKey, JSON.stringify(l)); };

  const addPerson = () => {
    if (!newName.trim()) return;
    savePeople([...people, { id: crypto.randomUUID(), name: newName.trim() }]);
    setNewName("");
  };

  const addExp = () => {
    const a = parseFloat(amount);
    if (!a || !payer || !desc.trim()) return;
    saveExp([{ id: crypto.randomUUID(), payerId: payer, amount: a, description: desc, date: new Date().toISOString() }, ...expenses]);
    setAmount(""); setDesc("");
  };

  const balances = useMemo(() => {
    if (people.length === 0) return {} as Record<string, number>;
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const share = total / people.length;
    const paid: Record<string, number> = {};
    people.forEach(p => paid[p.id] = 0);
    expenses.forEach(e => { paid[e.payerId] = (paid[e.payerId] || 0) + e.amount; });
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
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="mb-6 flex items-center gap-3">
          <Users className="w-7 h-7 text-primary" />
          <div>
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Gastos compartidos</p>
            <h1 className="font-display text-3xl">{trip?.destino}</h1>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5 mb-6">
          <h2 className="font-medium mb-3">Personas</h2>
          <div className="flex gap-2 mb-3">
            <Input placeholder="Nombre" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()} />
            <Button onClick={addPerson}><Plus className="w-4 h-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {people.map(p => (
              <span key={p.id} className="px-3 py-1.5 rounded-full bg-primary/10 text-sm flex items-center gap-2">
                {p.name}
                <button onClick={() => savePeople(people.filter(x => x.id !== p.id))}><Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" /></button>
              </span>
            ))}
          </div>
        </div>

        {people.length > 0 && (
          <div className="glass-card rounded-2xl p-5 mb-6">
            <h2 className="font-medium mb-3">Agregar gasto</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
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
            <div className="glass-card rounded-2xl p-5 mb-6">
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
              <div className="glass-card rounded-2xl p-5 mb-6 border-primary/30">
                <h2 className="font-medium mb-3 text-primary">Cómo saldar</h2>
                {settlements.map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-1.5 text-sm">
                    <span className="font-medium">{s.from}</span> → <span className="font-medium">{s.to}</span>: <span className="text-primary">${s.amount.toFixed(2)}</span>
                  </motion.div>
                ))}
              </div>
            )}

            <div className="glass-card rounded-2xl p-5">
              <h2 className="font-medium mb-3">Gastos</h2>
              {expenses.map(e => {
                const p = people.find(x => x.id === e.payerId);
                return (
                  <div key={e.id} className="flex justify-between items-center py-2 border-b border-border/30 last:border-0">
                    <div>
                      <div className="text-sm">{e.description}</div>
                      <div className="text-xs text-muted-foreground">Pagó {p?.name || "?"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">${e.amount.toFixed(2)}</span>
                      <button onClick={() => saveExp(expenses.filter(x => x.id !== e.id))}><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" /></button>
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
