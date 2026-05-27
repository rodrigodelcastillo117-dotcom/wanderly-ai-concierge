import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowLeftRight, DollarSign, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const CURRENCIES = ["MXN","USD","EUR","GBP","JPY","CAD","BRL","ARS","CLP","COP","PEN","CHF","AUD","CNY","KRW","THB","IDR","INR","TRY","AED"];

const Currency = () => {
  const navigate = useNavigate();
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("MXN");
  const [amount, setAmount] = useState("100");
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [updated, setUpdated] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const load = async (base: string) => {
    setLoading(true);
    try {
      // Open exchangerate-api (no key, CORS open)
      const r = await fetch(`https://open.er-api.com/v6/latest/${base}`).then(r => r.json());
      if (r?.rates) {
        setRates(r.rates);
        setUpdated(new Date().toLocaleString("es-MX"));
        try { localStorage.setItem(`iatos:fx:${base}`, JSON.stringify({ rates: r.rates, updated: Math.floor(Date.now() / 1000) })); } catch {}
        toast.success("Tasas actualizadas");
      } else throw new Error();
    } catch {
      // Fallback to cache
      try {
        const cached = localStorage.getItem(`iatos:fx:${base}`);
        if (cached) {
          const { rates, updated } = JSON.parse(cached);
          setRates(rates);
          setUpdated(new Date(updated * 1000).toLocaleString("es-MX") + " (caché)");
          toast.info("Usando tasas en caché (offline)");
        } else toast.error("No hay conexión y no hay caché");
      } catch {}
    }
    setLoading(false);
  };

  useEffect(() => { load(from); }, [from]);

  const result = rates && rates[to] ? (parseFloat(amount || "0") * rates[to]).toFixed(2) : "—";
  const swap = () => { setFrom(to); setTo(from); };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 md:p-10 max-w-2xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <DollarSign className="w-7 h-7 text-primary" />
          <div>
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Conversor</p>
            <h1 className="font-display text-3xl md:text-4xl">Moneda en vivo</h1>
          </div>
        </div>

        <div className="glass-card rounded-3xl p-5 sm:p-7 space-y-5">
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="text-3xl h-16 text-center font-display" />

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
            <select value={from} onChange={e => setFrom(e.target.value)} className="bg-background border border-border rounded-lg p-3 text-lg w-full">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button variant="ghost" size="icon" onClick={swap} className="mx-auto">
              <ArrowLeftRight className="w-5 h-5 text-primary" />
            </Button>
            <select value={to} onChange={e => setTo(e.target.value)} className="bg-background border border-border rounded-lg p-3 text-lg w-full">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="text-center py-4">
            <div className="text-xs text-muted-foreground mb-1">Equivalente</div>
            <div className="text-4xl md:text-5xl font-display text-primary break-all">{result}</div>
            <div className="text-sm text-muted-foreground mt-1">{to}</div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Actualizado: {updated || "—"}</span>
            <Button variant="ghost" size="sm" onClick={() => load(from)} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </div>
        </div>

        {rates && (
          <div className="mt-6 glass-card rounded-2xl p-5">
            <h3 className="text-sm font-medium mb-3">1 {from} equivale a</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              {CURRENCIES.filter(c => c !== from).slice(0, 12).map(c => (
                <div key={c} className="flex justify-between border-b border-border/30 py-1.5">
                  <span className="text-muted-foreground">{c}</span>
                  <span className="font-medium">{rates[c]?.toFixed(2) ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Currency;
