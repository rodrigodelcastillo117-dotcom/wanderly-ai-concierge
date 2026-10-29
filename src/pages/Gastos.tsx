import { Suspense, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { lazyWithRetry } from "@/lib/lazyRetry";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Receipt, Upload, PieChart, PiggyBank, Users, Pencil, FileImage } from "lucide-react";
import { toast } from "sonner";
import { logInsight } from "@/lib/insights";
import { motion, AnimatePresence } from "framer-motion";
import { TripSavingsCalculator } from "@/components/TripSavingsCalculator";
import { localISODate } from "@/lib/localDate";
import { formatDateOnly } from "@/lib/dateUtils";
import { convert, convertedTotal, formatMoney, fxLabel, subtotalsByCurrency } from "@/lib/fx";
import { CurrencySelect } from "@/components/CurrencySelect";
import { currencyName, destinationCurrency } from "@/lib/currencies";
import { canonicalCategory, DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORIES } from "@/lib/expenseCategories";
import { useFxTable } from "@/hooks/useFxTable";
import { safeFileName, uploadProblem } from "@/lib/uploadRules";
import { ACTIVE_TRIP_COLUMNS, useActiveTrip } from "@/hooks/useActiveTrip";
import { isTripEnded, tripLabel } from "@/lib/activeTrip";
import { expenseReceiptUrl, loadMySharedParts } from "@/lib/tripExpensesApi";
import { shortTripName } from "@/lib/tripName";

// El Resumen usa recharts (~100 kB comprimidos): se carga solo al abrir esa pestaña.
const SmartSpendPanel = lazyWithRetry(() => import("@/components/SmartSpendPanel"));

/**
 * Tres pestañas, cada una responde UNA pregunta (antes: "Lista", "Smart Spend" y "Calculadora de
 * viaje", sin explicar qué era cada una):
 *  - Mis gastos: ¿qué gasté? (registrar y ver cada gasto)
 *  - Resumen: ¿en qué se me va el dinero? (por categoría y por viaje, en pesos)
 *  - Ahorro: ¿cuánto aparto al mes para mi próximo viaje? (sin necesidad de un viaje planeado)
 * No se juntan "Mis gastos" y "Resumen" porque la lista crece con el tiempo y el resumen quedaría
 * enterrado al final (o la lista, debajo de gráficas): separadas, cada una cabe en una pantalla.
 */
export const GASTOS_TABS = [
  { id: "gastos", label: "Mis gastos", icon: Receipt, title: "Mis gastos",
    explainer: "Anota cada gasto en cualquier moneda y guarda el recibo. En pesos, con tu parte de lo compartido." },
  { id: "resumen", label: "Resumen", icon: PieChart, title: "En qué se te va el dinero",
    explainer: "Tus gastos por categoría y por viaje, todo convertido a pesos." },
  { id: "ahorro", label: "Ahorro", icon: PiggyBank, title: "Ahorro para tu viaje",
    explainer: "Elige destino, fecha y costo: te decimos cuánto apartar cada mes. No necesitas un viaje planeado." },
] as const;
export type GastosTab = (typeof GASTOS_TABS)[number]["id"];
// Enlaces viejos (?tab=lista|smart|calc) siguen funcionando.
const LEGACY_TAB: Record<string, GastosTab> = { lista: "gastos", smart: "resumen", calc: "ahorro" };
const tabFrom = (v: string | null): GastosTab =>
  (GASTOS_TABS.some((t) => t.id === v) ? (v as GastosTab) : LEGACY_TAB[v ?? ""] ?? "gastos");


// Categorías y monedas: catálogos en lib/expenseCategories y lib/currencies (las filas con las
// categorías viejas —Alojamiento, Gastronomía…— se muestran con su categoría nueva).

type Expense = {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  expense_date: string;
  receipt_url: string | null;
  trip_id?: string | null;
  /** Mi parte de un gasto compartido del viaje (se edita en Gastos del viaje, no aquí). */
  shared?: { total: number; payerName: string; paidByMe: boolean };
};

export const Gastos = () => {
  const { user } = useAuth();
  const [ownItems, setItems] = useState<Expense[]>([]);
  const [sharedParts, setSharedParts] = useState<Expense[]>([]);
  // Mis gastos + mi parte de lo compartido, por fecha (lo mismo que suma Gastos del viaje).
  const items = useMemo(() => [...ownItems, ...sharedParts].sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date))), [ownItems, sharedParts]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Gasto que se está editando (null = uno nuevo). Antes un gasto no se podía corregir.
  const [editing, setEditing] = useState<Expense | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFrom(searchParams.get("tab"));
  const setTab = (next: GastosTab) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "gastos") sp.delete("tab"); else sp.set("tab", next);
    setSearchParams(sp, { replace: true });
  };
  const current = GASTOS_TABS.find((t) => t.id === tab)!;
  const startExpense = () => { setTab("gastos"); setOpen(true); };

  const [form, setForm] = useState({
    amount: "",
    currency: "MXN",
    category: DEFAULT_EXPENSE_CATEGORY,
    description: "",
    expense_date: localISODate(),
    file: null as File | null,
    // undefined = aún no elegido: se usa el viaje activo. "" = sin viaje.
    trip_id: undefined as string | undefined,
  });

  // El gasto se liga al viaje activo (el mismo que Iato y el Dashboard), y se puede cambiar.
  // Con presupuesto y moneda del viaje: el Resumen compara el gasto por día contra el presupuesto.
  const active = useActiveTrip<any>({ columns: `${ACTIVE_TRIP_COLUMNS}, total_estimado, moneda` });
  const tripOptions = active.trips.filter((t) => !isTripEnded(t, localISODate()) || t.id === active.trip?.id);
  const formTripId = form.trip_id !== undefined ? form.trip_id : active.trip?.id ?? "";
  const tripName = (id?: string | null) => { const t = active.trips.find((x) => x.id === id); return t ? shortTripName(t) : null; };
  // Moneda local del destino del viaje elegido: se sugiere arriba en el selector.
  const formTrip = active.trips.find((t) => t.id === formTripId) ?? null;
  const suggestedCurrency = destinationCurrency(formTrip);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .eq("user_id", user.id)
      .order("expense_date", { ascending: false });
    setItems((data as Expense[]) ?? []);
    // Mi parte de los gastos compartidos de mis viajes: cuenta en el total y en el Resumen igual que en
    // la pestaña Gastos del viaje (lo que pagué por otros no es gasto mío: es lo que me deben).
    const parts = await loadMySharedParts(supabase);
    setSharedParts(parts.map((r) => ({
      id: `share-${r.share_id}`, amount: r.amount, currency: r.currency, category: r.category, description: r.description,
      expense_date: r.expense_date, receipt_url: null, trip_id: r.trip_id,
      shared: { total: r.total, payerName: r.payer_name, paidByMe: r.paid_by_me },
    })));
  };

  useEffect(() => { load(); }, [user]);

  const fx = useFxTable();

  const handleSave = async () => {
    if (!user || !form.amount) return;
    if (!(Number(form.amount) > 0)) {
      toast.error("El monto debe ser mayor a 0");
      return;
    }
    setSaving(true);
    try {
      let receipt_url: string | null = editing?.receipt_url ?? null;
      if (form.file) {
        // El servidor también lo rechaza (límites del bucket); aquí se avisa con un mensaje claro.
        const problem = uploadProblem("recibos", form.file);
        if (problem) throw new Error(problem);
        const path = `${user.id}/${Date.now()}-${safeFileName(form.file.name)}`;
        const { error: upErr } = await supabase.storage.from("recibos").upload(path, form.file);
        if (upErr) throw upErr;
        receipt_url = path;
      }
      const row = {
        amount: Number(form.amount),
        currency: form.currency,
        category: form.category,
        description: form.description || null,
        expense_date: form.expense_date,
        receipt_url,
        trip_id: formTripId || null,
      };
      const { error } = editing
        ? await supabase.from("expenses").update(row).eq("id", editing.id)
        : await supabase.from("expenses").insert({ user_id: user.id, ...row });
      if (error) throw error;
      if (!editing) await logInsight("planned", "expense", form.category, { amount: form.amount });
      toast.success(editing ? "Gasto actualizado" : "Gasto registrado");
      setOpen(false);
      setEditing(null);
      setForm({ ...form, amount: "", description: "", file: null, trip_id: undefined });
      load();
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (x: Expense) => {
    setEditing(x);
    setForm({
      amount: String(x.amount), currency: x.currency, category: canonicalCategory(x.category), description: x.description ?? "",
      expense_date: String(x.expense_date).slice(0, 10), file: null, trip_id: x.trip_id ?? "",
    });
    setOpen(true);
  };
  const cancelForm = () => { setOpen(false); setEditing(null); setForm((f) => ({ ...f, amount: "", description: "", file: null, trip_id: undefined })); };

  // El recibo se guarda en el bucket privado "recibos": se abre con un enlace firmado de 5 minutos
  // (como «Ver ticket» en Gastos compartidos). Antes se guardaba y no había forma de verlo.
  const viewReceipt = async (path: string) => {
    const url = await expenseReceiptUrl(supabase, path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("No se pudo abrir el recibo. Intenta de nuevo.");
  };

  const [removingId, setRemovingId] = useState<string | null>(null);
  // Borrar pide confirmación y revisa el resultado: antes el gasto desaparecía aunque el borrado
  // fallara (y volvía al recargar).
  const remove = async (id: string) => {
    if (removingId) return;
    if (!window.confirm("¿Eliminar este gasto? No se puede deshacer.")) return;
    setRemovingId(id);
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) { toast.error("No se pudo eliminar el gasto. Intenta de nuevo."); return; }
      setItems((s) => s.filter((x) => x.id !== id));
    } finally {
      setRemovingId(null);
    }
  };

  // Nunca se suman monedas distintas como si fueran una: subtotal por moneda y, aparte, el total
  // convertido a MXN con el tipo de cambio indicado (fuente y fecha).
  const subtotals = subtotalsByCurrency(items);
  const currencies = Object.keys(subtotals);
  const enMxn = fx ? convertedTotal(items, "MXN", fx) : null;
  // Vista previa en pesos del monto que se está capturando (o aviso si no hay tipo de cambio).
  const formAmount = Number(form.amount);
  const formCur = form.currency.toUpperCase();
  const previewMxn = fx && formAmount > 0 && formCur !== "MXN" ? convert(formAmount, formCur, "MXN", fx) : null;
  const categoryHint = EXPENSE_CATEGORIES.find((c) => c.value === form.category)?.hint;

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-5xl">
        <div className="flex items-end justify-between mb-5 md:mb-6 flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl md:text-5xl mb-1 md:mb-2">Gastos</h1>
            <p className="text-sm md:text-base text-muted-foreground">Lo que gastas, en qué se te va y cuánto ahorrar para tu próximo viaje.</p>
          </div>
          {tab === "gastos" && (
            <Button onClick={() => { setEditing(null); setOpen(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4" /> Nuevo gasto
            </Button>
          )}
        </div>

        <div role="tablist" aria-label="Secciones de Gastos" className="grid grid-cols-3 sm:inline-grid p-1 rounded-full border border-border bg-surface w-full sm:w-auto">
          {GASTOS_TABS.map((t) => {
            const Icon = t.icon;
            const selected = tab === t.id;
            return (
              <button key={t.id} role="tab" id={`gastos-tab-${t.id}`} aria-selected={selected} aria-controls="gastos-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  // Patrón de pestañas: flechas, Inicio y Fin cambian de pestaña (y mueven el foco).
                  const i = GASTOS_TABS.findIndex((x) => x.id === t.id);
                  const n = GASTOS_TABS.length;
                  const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n
                    : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
                  if (to < 0) return;
                  e.preventDefault();
                  setTab(GASTOS_TABS[to].id);
                  document.getElementById(`gastos-tab-${GASTOS_TABS[to].id}`)?.focus();
                }}
                className={`px-3 sm:px-5 py-2 rounded-full text-sm transition flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> {t.label}
              </button>
            );
          })}
        </div>
        {/* Qué es esta pestaña, en una línea. */}
        <div className="mt-3 mb-5 md:mb-7" data-testid="gastos-explainer">
          <p className="font-display text-lg md:text-xl">{current.title}</p>
          <p className="text-sm text-muted-foreground">{current.explainer}</p>
        </div>

        <div role="tabpanel" id="gastos-panel" aria-labelledby={`gastos-tab-${tab}`}>
        {tab === "ahorro" ? (
          <TripSavingsCalculator />
        ) : tab === "resumen" ? (
          <Suspense fallback={<div className="glass-card rounded-2xl p-10 text-center text-sm text-muted-foreground">Cargando resumen…</div>}>
            <SmartSpendPanel items={items} trips={active.trips} activeTripId={active.trip?.id ?? null} onAddExpense={startExpense} />
          </Suspense>
        ) : (
        <>
        {items.length > 0 && (
        <div className="glass-card rounded-2xl p-6 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-primary tracking-[0.2em] uppercase mb-1">Total registrado</p>
            <p className="font-display text-2xl md:text-3xl break-words">
              {currencies.map((c) => formatMoney(subtotals[c], c)).join(" · ")}
            </p>
            {currencies.length > 1 && enMxn && (
              <p className="text-xs text-muted-foreground mt-1">
                ≈ {formatMoney(Math.round(enMxn.total), "MXN", 0)} en total
                {enMxn.unconvertedCount > 0 && ` (sin contar ${Object.keys(enMxn.unconverted).join(", ")}: sin tipo de cambio disponible)`}
                <span className="block text-[10px] text-muted-foreground/80">{fxLabel(fx!)}</span>
              </p>
            )}
          </div>
          <Receipt className="w-10 h-10 text-primary/60" />
        </div>
        )}

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
                  <label htmlFor="gasto-monto" className="text-xs text-muted-foreground mb-1 block">Monto</label>
                  <Input id="gasto-monto" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <label htmlFor="gasto-moneda" className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                  <CurrencySelect id="gasto-moneda" value={form.currency} onChange={(c) => setForm({ ...form, currency: c })}
                    suggested={suggestedCurrency} used={items.map((x) => x.currency)} />
                  {suggestedCurrency && suggestedCurrency !== formCur && (
                    <button type="button" onClick={() => setForm({ ...form, currency: suggestedCurrency })}
                      className="mt-1 text-[11px] text-primary underline-offset-2 hover:underline">
                      Usar {suggestedCurrency} ({currencyName(suggestedCurrency)}), la moneda de {formTrip ? shortTripName(formTrip) : ""}
                    </button>
                  )}
                </div>
                <div>
                  <label htmlFor="gasto-categoria" className="text-xs text-muted-foreground mb-1 block">Categoría</label>
                  <select id="gasto-categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
                  </select>
                  {categoryHint && <p className="text-[11px] text-muted-foreground mt-1">{categoryHint}</p>}
                </div>
                {formAmount > 0 && formCur !== "MXN" && fx && (
                  <p className="sm:col-span-2 text-[11px] text-muted-foreground -mt-2" role="status">
                    {previewMxn != null
                      ? <>≈ {formatMoney(Math.round(previewMxn), "MXN", 0)} · {fxLabel(fx)}</>
                      : <>Sin tipo de cambio disponible para {formCur}: el gasto se guarda en {formCur} y no se suma al total en pesos.</>}
                  </p>
                )}
                <div>
                  <label htmlFor="gasto-fecha" className="text-xs text-muted-foreground mb-1 block">Fecha</label>
                  <Input id="gasto-fecha" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="gasto-viaje" className="text-xs text-muted-foreground mb-1 block">Viaje</label>
                  <select id="gasto-viaje" value={formTripId} onChange={(e) => setForm({ ...form, trip_id: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Sin viaje</option>
                    {tripOptions.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="gasto-descripcion" className="text-xs text-muted-foreground mb-1 block">Descripción</label>
                  <Input id="gasto-descripcion" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Cena en Le Jules Verne" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="gasto-recibo" className="text-xs text-muted-foreground mb-1 flex items-center gap-2"><Upload className="w-3 h-3" aria-hidden="true" /> {editing?.receipt_url ? "Cambiar recibo (opcional)" : "Recibo (opcional)"}</label>
                  <Input id="gasto-recibo" type="file" accept="image/*,application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <Button onClick={handleSave} disabled={saving || !form.amount}>
                  {saving ? "Guardando…" : editing ? "Guardar cambios" : "Guardar"}
                </Button>
                <Button variant="ghost" onClick={cancelForm}>Cancelar</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {items.length === 0 ? (
            !open && (
              <div className="glass-card rounded-2xl p-6 md:p-10 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-primary/30 grid place-items-center mb-4">
                  <Receipt className="w-5 h-5 text-primary" aria-hidden="true" />
                </div>
                <p className="font-display text-2xl mb-2">Aún no registras gastos</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                  Anota la cena, el taxi o las compras en la moneda en que pagaste. Te mostramos el total en pesos y en qué se te va.
                </p>
                <Button onClick={() => setOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="w-4 h-4" aria-hidden="true" /> Registra tu primer gasto
                </Button>
              </div>
            )
          ) : items.map((x) => (
            <div key={x.id} className="glass-card rounded-xl p-3 sm:p-4 flex items-center gap-1.5 sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1 min-w-0">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary">{canonicalCategory(x.category)}</span>
                  {/* Fecha local: new Date("2026-10-01") es UTC y en México se mostraba el 30 sep. */}
                  <span className="text-xs text-muted-foreground">{formatDateOnly(x.expense_date)}</span>
                  {tripName(x.trip_id) && <span className="text-xs text-muted-foreground truncate">· {tripName(x.trip_id)}</span>}
                </div>
                <p className="text-sm truncate">{x.description ?? "—"}</p>
                {x.shared && (
                  <p className="text-[11px] text-muted-foreground">Tu parte de {formatMoney(x.shared.total, x.currency)} compartido · {x.shared.paidByMe ? "pagaste tú" : `pagó ${x.shared.payerName}`}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-display text-lg">{formatMoney(Number(x.amount), x.currency)}</p>
                {/* Equivalente en pesos con el mismo tipo de cambio del total (fuente y fecha arriba). */}
                {fx && String(x.currency).toUpperCase() !== "MXN" && (() => {
                  const v = convert(Number(x.amount), String(x.currency).toUpperCase(), "MXN", fx);
                  return v != null ? <p className="text-[11px] text-muted-foreground" data-testid="gasto-mxn">≈ {formatMoney(Math.round(v), "MXN", 0)}</p> : null;
                })()}
              </div>
              {!x.shared && x.receipt_url && (
                <button type="button" onClick={() => void viewReceipt(x.receipt_url!)} aria-label={`Ver recibo de ${x.description ?? canonicalCategory(x.category)}`}
                  className="text-muted-foreground hover:text-primary p-2">
                  <FileImage className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              {!x.shared && (
                <button type="button" onClick={() => startEdit(x)} aria-label={`Editar gasto ${x.description ?? canonicalCategory(x.category)}`}
                  className="text-muted-foreground hover:text-primary p-2">
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              {x.shared ? (
                <Link to={`/dashboard/viajes/${x.trip_id}/split?tab=compartidos`} aria-label={`Ver gasto compartido ${x.description ?? ""}`.trim()} className="text-muted-foreground hover:text-primary p-2">
                  <Users className="w-4 h-4" aria-hidden="true" />
                </Link>
              ) : (
              <button onClick={() => remove(x.id)} disabled={removingId === x.id} aria-label={`Eliminar gasto ${x.description ?? x.category ?? ""}`.trim()} className="text-muted-foreground hover:text-destructive p-2 disabled:opacity-40">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
              )}
            </div>
          ))}
        </div>
        </>
        )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Gastos;
