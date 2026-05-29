import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Calculator, PiggyBank, AlertTriangle, CheckCircle2, Plane, Wallet } from "lucide-react";

type Trip = {
  id: string;
  destino: string;
  pais_destino: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  total_estimado: number | null;
  moneda: string | null;
};

const FIXED_FIELDS: { key: string; label: string }[] = [
  { key: "renta", label: "Renta / hipoteca" },
  { key: "luz", label: "Luz" },
  { key: "agua", label: "Agua" },
  { key: "gas", label: "Gas" },
  { key: "internet", label: "Internet" },
  { key: "celular", label: "Celular" },
  { key: "supermercado", label: "Supermercado" },
  { key: "gasolina", label: "Gasolina" },
  { key: "transporte", label: "Transporte público / Uber" },
  { key: "seguros", label: "Seguros (auto, salud, vida)" },
  { key: "creditos", label: "Tarjetas / créditos" },
  { key: "colegiaturas", label: "Colegiaturas / cursos" },
  { key: "suscripciones", label: "Suscripciones (Netflix, Spotify, etc.)" },
  { key: "mantenimiento", label: "Mantenimiento / cuotas" },
];

const VAR_FIELDS: { key: string; label: string }[] = [
  { key: "restaurantes", label: "Restaurantes" },
  { key: "comidas_trabajo", label: "Comidas en el trabajo" },
  { key: "antros", label: "Antros / bares" },
  { key: "cine", label: "Cine / entretenimiento" },
  { key: "pareja", label: "Pareja (citas, regalos)" },
  { key: "shopping", label: "Shopping / ropa" },
  { key: "lujos", label: "Lujos / caprichos" },
  { key: "hobbies", label: "Hobbies / gym" },
  { key: "viajes_cortos", label: "Escapadas de fin de semana" },
  { key: "regalos", label: "Regalos / familia" },
  { key: "imprevistos", label: "Imprevistos / buffer" },
];

const STORAGE_KEY = "iatos_savings_calc_v1";

type State = {
  tripId: string;
  sueldo: string;
  extras: string;
  patrimonio: string;
  fijos: Record<string, string>;
  variables: Record<string, string>;
};

const defaultState = (): State => ({
  tripId: "",
  sueldo: "",
  extras: "",
  patrimonio: "",
  fijos: Object.fromEntries(FIXED_FIELDS.map(f => [f.key, ""])),
  variables: Object.fromEntries(VAR_FIELDS.map(f => [f.key, ""])),
});

const sum = (obj: Record<string, string>) =>
  Object.values(obj).reduce((acc, v) => acc + (Number(v) || 0), 0);

const fmtMoney = (n: number, currency = "MXN") =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export const TripSavingsCalculator = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [state, setState] = useState<State>(defaultState);

  // Load persisted
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setState({ ...defaultState(), ...parsed, fijos: { ...defaultState().fijos, ...(parsed.fijos ?? {}) }, variables: { ...defaultState().variables, ...(parsed.variables ?? {}) } });
      }
    } catch {/* */}
  }, []);

  // Persist on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {/* */}
  }, [state]);

  // Fetch trips
  useEffect(() => {
    if (!user) return;
    supabase.from("trips")
      .select("id,destino,pais_destino,fecha_salida,fecha_regreso,total_estimado,moneda")
      .eq("user_id", user.id)
      .order("fecha_salida", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as Trip[];
        setTrips(list);
        setState(s => s.tripId ? s : { ...s, tripId: list[0]?.id ?? "" });
      });
  }, [user]);

  const trip = trips.find(t => t.id === state.tripId) ?? null;

  const computed = useMemo(() => {
    const sueldo = Number(state.sueldo) || 0;
    const extras = Number(state.extras) || 0;
    const patrimonio = Number(state.patrimonio) || 0;
    const fijos = sum(state.fijos);
    const variables = sum(state.variables);
    const ingreso = sueldo + extras;
    const capacidadAhorro = ingreso - fijos - variables;

    const costoViaje = Number(trip?.total_estimado ?? 0);
    const faltante = Math.max(0, costoViaje - patrimonio);

    let meses = 0;
    let fechaViaje: Date | null = null;
    if (trip?.fecha_salida) {
      fechaViaje = new Date(trip.fecha_salida + "T00:00:00");
      const now = new Date();
      meses = (fechaViaje.getFullYear() - now.getFullYear()) * 12 + (fechaViaje.getMonth() - now.getMonth());
      if (fechaViaje.getDate() < now.getDate()) meses -= 1;
      meses = Math.max(0, meses);
    }

    const ahorroRequerido = meses > 0 ? faltante / meses : faltante;
    const ratio = capacidadAhorro > 0 ? ahorroRequerido / capacidadAhorro : Infinity;

    let estado: "ok" | "ajustado" | "imposible" | "pagado" | "sin_fecha" = "ok";
    if (faltante === 0 && costoViaje > 0) estado = "pagado";
    else if (!fechaViaje) estado = "sin_fecha";
    else if (capacidadAhorro <= 0 || ratio > 1) estado = "imposible";
    else if (ratio > 0.7) estado = "ajustado";

    // Sugerencia automática de recortes para llegar al ahorro requerido
    let recorteSugerido = 0;
    if (estado === "imposible" && fechaViaje && meses > 0) {
      recorteSugerido = ahorroRequerido - Math.max(0, capacidadAhorro);
    }

    return {
      ingreso, sueldo, extras, patrimonio, fijos, variables,
      capacidadAhorro, costoViaje, faltante, meses, fechaViaje,
      ahorroRequerido, ratio, estado, recorteSugerido,
      currency: trip?.moneda || "MXN",
    };
  }, [state, trip]);

  const setFijo = (k: string, v: string) => setState(s => ({ ...s, fijos: { ...s.fijos, [k]: v } }));
  const setVar = (k: string, v: string) => setState(s => ({ ...s, variables: { ...s.variables, [k]: v } }));

  return (
    <section className="glass-card rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Calculator className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-[10px] tracking-[0.3em] text-primary uppercase">Smart Spend</p>
          <h2 className="font-display text-2xl md:text-3xl">Calculadora de viaje</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Te digo cuánto ahorrar cada mes para irte sin culpa.
          </p>
        </div>
      </div>

      {trips.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Crea un viaje primero para calcular cuánto necesitas ahorrar.
        </p>
      ) : (
        <>
          {/* Selector de viaje */}
          <div className="mb-6">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 block">Viaje a financiar</label>
            <select
              value={state.tripId}
              onChange={(e) => setState(s => ({ ...s, tripId: e.target.value }))}
              className="w-full rounded-xl bg-surface border border-border px-3 py-2.5 text-sm focus:border-primary outline-none"
            >
              {trips.map(t => (
                <option key={t.id} value={t.id}>
                  {t.destino}{t.pais_destino ? `, ${t.pais_destino}` : ""} · {t.fecha_salida ?? "sin fecha"} · {t.total_estimado ? fmtMoney(Number(t.total_estimado), t.moneda || "MXN") : "sin estimado"}
                </option>
              ))}
            </select>
            {trip && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5">
                  <Plane className="w-3 h-3 text-primary" /> {trip.destino}
                </span>
                {trip.fecha_salida && (
                  <span className="px-3 py-1.5 rounded-full border border-border bg-surface">
                    Salida: {new Date(trip.fecha_salida + "T00:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                )}
                {trip.total_estimado && (
                  <span className="px-3 py-1.5 rounded-full border border-border bg-surface">
                    Costo estimado: <strong className="text-primary">{fmtMoney(Number(trip.total_estimado), trip.moneda || "MXN")}</strong>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Ingresos + patrimonio */}
          <div className="grid md:grid-cols-3 gap-3 mb-6">
            <NumField label="Sueldo neto mensual" value={state.sueldo} onChange={(v) => setState(s => ({ ...s, sueldo: v }))} placeholder="35000" />
            <NumField label="Otros ingresos / freelance" value={state.extras} onChange={(v) => setState(s => ({ ...s, extras: v }))} placeholder="5000" />
            <NumField label="Patrimonio / ahorro actual" value={state.patrimonio} onChange={(v) => setState(s => ({ ...s, patrimonio: v }))} placeholder="20000" hint="Lo que ya tienes para el viaje" />
          </div>

          {/* Fijos */}
          <details className="mb-4 rounded-xl border border-border bg-surface/40" open>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Gastos fijos del mes</span>
              <span className="text-xs text-muted-foreground">{fmtMoney(computed.fijos, computed.currency)}</span>
            </summary>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 p-4 pt-2">
              {FIXED_FIELDS.map(f => (
                <NumField key={f.key} label={f.label} value={state.fijos[f.key] ?? ""} onChange={(v) => setFijo(f.key, v)} compact />
              ))}
            </div>
          </details>

          {/* Variables */}
          <details className="mb-6 rounded-xl border border-border bg-surface/40" open>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2"><PiggyBank className="w-4 h-4 text-primary" /> Gastos variables (placeres del mes)</span>
              <span className="text-xs text-muted-foreground">{fmtMoney(computed.variables, computed.currency)}</span>
            </summary>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 p-4 pt-2">
              {VAR_FIELDS.map(f => (
                <NumField key={f.key} label={f.label} value={state.variables[f.key] ?? ""} onChange={(v) => setVar(f.key, v)} compact />
              ))}
            </div>
          </details>

          {/* Resultado */}
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 md:p-6">
            <div className="grid md:grid-cols-4 gap-4 mb-5">
              <Stat label="Ingreso mensual" value={fmtMoney(computed.ingreso, computed.currency)} />
              <Stat label="Gastos totales" value={fmtMoney(computed.fijos + computed.variables, computed.currency)} />
              <Stat label="Capacidad de ahorro" value={fmtMoney(computed.capacidadAhorro, computed.currency)} accent={computed.capacidadAhorro > 0 ? "good" : "bad"} />
              <Stat label={computed.meses > 0 ? `Meses al viaje` : "Sin fecha"} value={computed.meses > 0 ? `${computed.meses}` : "—"} />
            </div>

            <div className="rounded-xl bg-background/40 border border-border p-4 md:p-5">
              {computed.estado === "pagado" && (
                <Verdict
                  icon={<CheckCircle2 className="w-6 h-6 text-emerald-400" />}
                  title="Ya lo tienes pagado"
                  body={`Tu patrimonio (${fmtMoney(computed.patrimonio, computed.currency)}) cubre el viaje (${fmtMoney(computed.costoViaje, computed.currency)}). Reserva con calma.`}
                />
              )}
              {computed.estado === "sin_fecha" && computed.costoViaje > 0 && (
                <Verdict
                  icon={<AlertTriangle className="w-6 h-6 text-amber-400" />}
                  title="Falta fijar fecha de salida"
                  body={`Necesitas ${fmtMoney(computed.faltante, computed.currency)} más. Pon fecha al viaje para calcular el ahorro mensual.`}
                />
              )}
              {computed.estado === "ok" && (
                <Verdict
                  icon={<CheckCircle2 className="w-6 h-6 text-emerald-400" />}
                  title={`Ahorra ${fmtMoney(computed.ahorroRequerido, computed.currency)} cada mes`}
                  body={`Durante ${computed.meses} meses para juntar los ${fmtMoney(computed.faltante, computed.currency)} que te faltan. Tu capacidad real es ${fmtMoney(computed.capacidadAhorro, computed.currency)}/mes — vas holgado (${(computed.ratio * 100).toFixed(0)}% de tu margen).`}
                />
              )}
              {computed.estado === "ajustado" && (
                <Verdict
                  icon={<AlertTriangle className="w-6 h-6 text-amber-400" />}
                  title={`Ajustado: ahorra ${fmtMoney(computed.ahorroRequerido, computed.currency)} cada mes`}
                  body={`Eso usa el ${(computed.ratio * 100).toFixed(0)}% de tu capacidad de ahorro (${fmtMoney(computed.capacidadAhorro, computed.currency)}/mes). Cualquier imprevisto te puede tronar el plan. Considera bajar variables o mover la fecha 1-2 meses.`}
                />
              )}
              {computed.estado === "imposible" && (
                <Verdict
                  icon={<AlertTriangle className="w-6 h-6 text-destructive" />}
                  title={`No alcanza con tu ritmo actual`}
                  body={`Necesitas ahorrar ${fmtMoney(computed.ahorroRequerido, computed.currency)}/mes pero tu margen real es ${fmtMoney(Math.max(0, computed.capacidadAhorro), computed.currency)}/mes. Recorta al menos ${fmtMoney(computed.recorteSugerido, computed.currency)}/mes en variables, sube ingresos, o mueve la salida ${Math.ceil(computed.faltante / Math.max(1, computed.capacidadAhorro))} meses adelante.`}
                />
              )}
              {computed.costoViaje === 0 && (
                <p className="text-sm text-muted-foreground">Este viaje todavía no tiene costo estimado. Termina de planearlo y vuelve.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

const NumField = ({
  label, value, onChange, placeholder, hint, compact,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; compact?: boolean }) => (
  <label className="block">
    <span className={`block text-[11px] uppercase tracking-wider text-muted-foreground ${compact ? "mb-0.5" : "mb-1.5"}`}>{label}</span>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
      <input
        inputMode="decimal"
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "0"}
        className={`w-full rounded-lg bg-background/60 border border-border pl-6 pr-2 ${compact ? "py-1.5 text-sm" : "py-2.5"} focus:border-primary outline-none`}
      />
    </div>
    {hint && <span className="block text-[10px] text-muted-foreground mt-0.5">{hint}</span>}
  </label>
);

const Stat = ({ label, value, accent }: { label: string; value: string; accent?: "good" | "bad" }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={`font-display text-xl md:text-2xl mt-1 ${accent === "good" ? "text-emerald-400" : accent === "bad" ? "text-destructive" : ""}`}>{value}</p>
  </div>
);

const Verdict = ({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) => (
  <div className="flex items-start gap-3">
    <div className="shrink-0 mt-0.5">{icon}</div>
    <div>
      <p className="font-display text-lg md:text-xl mb-1">{title}</p>
      <p className="text-sm text-foreground/80 leading-relaxed">{body}</p>
    </div>
  </div>
);
