import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Receipt, Upload, PieChart, Calculator } from "lucide-react";
import { toast } from "sonner";
import { logInsight } from "@/lib/insights";
import { motion, AnimatePresence } from "framer-motion";
import SmartSpendPanel from "@/components/SmartSpendPanel";
import { TripSavingsCalculator } from "@/components/TripSavingsCalculator";


const CATEGORIAS = ["Alojamiento", "Gastronomía", "Experiencias", "Transporte", "Otros"] as const;
const MONEDAS = ["MXN", "USD", "EUR"] as const;

type Expense = {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  expense_date: string;
  receipt_url: string | null;
};

export const Gastos = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Expense[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"lista" | "smart" | "calc">("lista");

  const [form, setForm] = useState({
    amount: "",
    currency: "MXN",
    category: "Gastronomía",
    description: "",
    expense_date: new Date().toISOString().slice(0, 10),
    file: null as File | null,
  });

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .eq("user_id", user.id)
      .order("expense_date", { ascending: false });
    setItems((data as Expense[]) ?? []);
  };

  useEffect(() => { load(); }, [user]);

  const handleSave = async () => {
    if (!user || !form.amount) return;
    setSaving(true);
    try {
      let receipt_url: string | null = null;
      if (form.file) {
        const path = `${user.id}/${Date.now()}-${form.file.name}`;
        const { error: upErr } = await supabase.storage.from("recibos").upload(path, form.file);
        if (upErr) throw upErr;
        receipt_url = path;
      }
      const { error } = await supabase.from("expenses").insert({
        user_id: user.id,
        amount: Number(form.amount),
        currency: form.currency,
        category: form.category,
        description: form.description || null,
        expense_date: form.expense_date,
        receipt_url,
      });
      if (error) throw error;
      await logInsight("planned", "expense", form.category, { amount: form.amount });
      toast.success("Gasto registrado");
      setOpen(false);
      setForm({ ...form, amount: "", description: "", file: null });
      load();
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await supabase.from("expenses").delete().eq("id", id);
    setItems((s) => s.filter((x) => x.id !== id));
  };

  const total = items.reduce((s, x) => s + Number(x.amount), 0);

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-5xl">
        <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl md:text-5xl mb-2">Gastos</h1>
            <p className="text-muted-foreground">Registra, categoriza y analiza cada gasto de tu viaje.</p>
          </div>
          {tab === "lista" && (
            <Button onClick={() => setOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4" /> Nuevo gasto
            </Button>
          )}
        </div>

        <div className="inline-flex p-1 rounded-full border border-border bg-surface mb-8">
          <button
            onClick={() => setTab("lista")}
            className={`px-5 py-2 rounded-full text-sm transition flex items-center gap-2 ${tab === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Receipt className="w-4 h-4" /> Lista
          </button>
          <button
            onClick={() => setTab("smart")}
            className={`px-5 py-2 rounded-full text-sm transition flex items-center gap-2 ${tab === "smart" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <PieChart className="w-4 h-4" /> Smart Spend
          </button>
          <button
            onClick={() => setTab("calc")}
            className={`px-5 py-2 rounded-full text-sm transition flex items-center gap-2 ${tab === "calc" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Calculator className="w-4 h-4" /> Calculadora de viaje
          </button>
        </div>

        {tab === "calc" ? (
          <TripSavingsCalculator />
        ) : tab === "smart" ? (
          <SmartSpendPanel />
        ) : (
        <>


        <div className="glass-card rounded-2xl p-6 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-primary tracking-[0.2em] uppercase mb-1">Total registrado</p>
            <p className="font-display text-3xl">${total.toLocaleString("es-MX")}</p>
          </div>
          <Receipt className="w-10 h-10 text-primary/60" />
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="glass-card rounded-2xl p-6 mb-6 overflow-hidden"
            >
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Monto</label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {MONEDAS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Categoría</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Fecha</label>
                  <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Descripción</label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Cena en Le Jules Verne" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-2"><Upload className="w-3 h-3" /> Recibo (opcional)</label>
                  <Input type="file" accept="image/*,application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <Button onClick={handleSave} disabled={saving || !form.amount}>
                  {saving ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Aún no hay gastos registrados.</p>
          ) : items.map((x) => (
            <div key={x.id} className="glass-card rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary">{x.category}</span>
                  <span className="text-xs text-muted-foreground">{new Date(x.expense_date).toLocaleDateString("es-MX")}</span>
                </div>
                <p className="text-sm truncate">{x.description ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg">${Number(x.amount).toLocaleString("es-MX")}</p>
                <p className="text-xs text-muted-foreground">{x.currency}</p>
              </div>
              <button onClick={() => remove(x.id)} className="text-muted-foreground hover:text-destructive p-2">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Gastos;
