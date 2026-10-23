import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Camera, HandCoins, Plus, Receipt, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFxTable } from "@/hooks/useFxTable";
import { destinationCurrency } from "@/lib/currencies";
import { tripDestinations } from "@/lib/booking";
import { parseLocalDate } from "@/lib/localDate";
import { formatMoney } from "@/lib/fx";
import { computeBalances, hasPayments, inCustomSplit, type Transfer } from "@/lib/split";
import { tripSpendSummary, type TripSpendItem } from "@/lib/tripSpend";
import {
  addGuest, claimGuest, loadTripExpenses, receiptUrl, registerPayment, splitErrorMessage, unlinkPerson,
  type TripExpensesData,
} from "@/lib/tripExpensesApi";
import { TripExpenseForm, type PersonView } from "@/components/tripExpenses/TripExpenseForm";
import { TripPersonalTab } from "@/components/tripExpenses/TripPersonalTab";
import { TripSharedTab } from "@/components/tripExpenses/TripSharedTab";

/**
 * Gastos del viaje, dos pestañas:
 *  - Gastos: lo que YO llevo gastado en este viaje (mis gastos + mi parte de lo compartido), en pesos,
 *    por categoría y por día, contra el presupuesto. Solo lo veo yo.
 *  - Gastos compartidos: estilo Splitwise con los miembros reales del viaje (y quien no tiene la app),
 *    quién debe a quién y "Liquidar". Lo ven todos los miembros.
 * "Escanear ticket" lee la foto con IA y llena el formulario; nada se guarda sin confirmar.
 */
export const TRIP_EXPENSE_TABS = [
  { id: "gastos", label: "Gastos", icon: Receipt },
  { id: "compartidos", label: "Gastos compartidos", icon: Users },
] as const;
type TabId = (typeof TRIP_EXPENSE_TABS)[number]["id"];

const EMPTY: TripExpensesData = { trip: null, people: [], members: [], expenses: [], payments: [], personal: [] };

const TripSplit = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [search, setSearch] = useSearchParams();
  const tab: TabId = search.get("tab") === "compartidos" ? "compartidos" : "gastos";
  const setTab = (t: TabId) => {
    const sp = new URLSearchParams(search);
    if (t === "gastos") sp.delete("tab"); else sp.set("tab", t);
    setSearch(sp, { replace: true });
  };
  const [data, setData] = useState<TripExpensesData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [settle, setSettle] = useState<(Transfer & { input: string }) | null>(null);
  const [settling, setSettling] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const fx = useFxTable();
  const tipSplit = useTooltipShown("split");

  const reload = useCallback(async () => {
    if (!id) return;
    const d = await loadTripExpenses(supabase, id, user?.id ?? null);
    setData(d);
    setLoaded(true);
  }, [id, user?.id]);
  useEffect(() => { void reload(); }, [reload]);

  const mark = (k: string, on: boolean) => setBusy((prev) => { const n = new Set(prev); if (on) n.add(k); else n.delete(k); return n; });

  // Personas: miembros primero (yo, quien organiza, los demás), luego quien no tiene la app.
  const people: PersonView[] = useMemo(() => {
    const members = new Map(data.members.map((m) => [m.user_id, m]));
    const list = data.people.map((p) => {
      const m = p.member_id ? members.get(p.member_id) : undefined;
      return {
        id: p.id,
        name: m?.name || p.name,
        isMe: !!user && p.member_id === user.id,
        isMember: !!p.member_id,
        isOwner: !!m?.is_owner,
        avatar: m?.avatar_url ?? null,
        former: !!p.member_id && data.members.length > 0 && !m,
        legacyName: p.linked_by_name ? p.name : null,
        linkedByName: !!p.linked_by_name,
      };
    });
    const rank = (x: PersonView) => (x.isMe ? 0 : x.isOwner ? 1 : x.isMember && !x.former ? 2 : x.former ? 4 : 3);
    return list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);
  }, [data.people, data.members, user]);
  const me = people.find((p) => p.isMe) ?? null;
  const iAmOwner = !!me?.isOwner || (!!user && data.trip?.user_id === user.id);

  const split = useMemo(() => computeBalances(people, data.expenses, data.payments), [people, data.expenses, data.payments]);

  // Pestaña Gastos: mis gastos del viaje + mi parte de cada gasto compartido.
  const myItems: TripSpendItem[] = useMemo(() => {
    const personal: TripSpendItem[] = data.personal.map((x) => ({
      id: x.id, kind: "personal", amount: Number(x.amount), currency: x.currency, category: x.category, date: x.expense_date,
      city: x.city ?? null, description: x.description,
    }));
    const shared: TripSpendItem[] = me ? data.expenses.flatMap((e) => {
      const s = e.shares.find((sh) => sh.person_id === me.id);
      if (!s) return [];
      return [{
        id: e.id, kind: "compartido" as const, amount: s.amount, currency: e.currency, category: e.category ?? null,
        date: e.expense_date ?? (e.created_at ? e.created_at.slice(0, 10) : null), city: e.city ?? null, description: e.description,
        total: Number(e.amount), payerName: people.find((p) => p.id === e.payer_id)?.name ?? "?", paidByMe: e.payer_id === me.id,
      }];
    }) : [];
    return [...personal, ...shared].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }, [data.personal, data.expenses, me, people]);
  const summary = useMemo(() => (fx ? tripSpendSummary(myItems, fx, data.trip) : null), [myItems, fx, data.trip]);

  const cities = useMemo(() => tripDestinations(data.trip), [data.trip]);
  const tripDays = useMemo(() => {
    const a = parseLocalDate(data.trip?.fecha_salida), b = parseLocalDate(data.trip?.fecha_regreso);
    return a && b && b >= a ? Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1 : null;
  }, [data.trip]);

  const openForm = (file: File | null = null) => {
    setInitialFile(file);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  // ───── Acciones ─────
  const onAddGuest = async (name: string) => {
    if (!id) return false;
    const { error } = await addGuest(supabase, id, name);
    if (error) { toast.error("No se pudo agregar"); return false; }
    await reload();
    return true;
  };

  const onRemovePerson = async (pid: string) => {
    if (busy.has(pid)) return;
    const person = people.find((p) => p.id === pid);
    // Con pagos no se puede quitar (la base tampoco lo deja): se explica por qué.
    if (hasPayments(pid, data.expenses, data.payments)) {
      toast.error(`${person?.name ?? "Esta persona"} tiene pagos registrados`, { description: "Borra primero sus gastos para quitarla." });
      return;
    }
    if (inCustomSplit(pid, data.expenses)) {
      toast.error(`${person?.name ?? "Esta persona"} está en un gasto dividido por montos o porcentajes`, { description: "Edita o borra ese gasto primero." });
      return;
    }
    mark(pid, true);
    try {
      const { error } = await supabase.from("trip_split_people").delete().eq("id", pid);
      if (error) { toast.error(splitErrorMessage(error)); return; }
      await reload();
    } finally { mark(pid, false); }
  };

  const onClaim = async (pid: string) => {
    const person = people.find((p) => p.id === pid);
    if (!window.confirm(`¿"${person?.name}" eres tú? Sus gastos y pagos pasan a tu nombre.`)) return;
    mark(pid, true);
    try {
      const { error } = await claimGuest(supabase, pid);
      if (error) { toast.error(splitErrorMessage(error)); return; }
      toast.success("Listo: ahora esos gastos son tuyos");
      await reload();
    } finally { mark(pid, false); }
  };

  const onUnlink = async (pid: string) => {
    mark(pid, true);
    try {
      const { error } = await unlinkPerson(supabase, pid);
      if (error) { toast.error(splitErrorMessage(error)); return; }
      await reload();
    } finally { mark(pid, false); }
  };

  const onRemoveExpense = async (eid: string) => {
    if (busy.has(eid)) return;
    if (!window.confirm("¿Eliminar este gasto compartido? Cambian los saldos de todos.")) return;
    mark(eid, true);
    try {
      // Si falla, el gasto se queda en la lista y se avisa (antes desaparecía y volvía al recargar).
      const { error } = await supabase.from("trip_split_expenses").delete().eq("id", eid);
      if (error) { toast.error("No se pudo eliminar el gasto. Intenta de nuevo."); return; }
      setData((d) => ({ ...d, expenses: d.expenses.filter((x) => x.id !== eid) }));
    } finally { mark(eid, false); }
  };

  const onRemovePersonal = async (eid: string) => {
    if (busy.has(eid)) return;
    if (!window.confirm("¿Eliminar este gasto? No se puede deshacer.")) return;
    mark(eid, true);
    try {
      const { error } = await supabase.from("expenses").delete().eq("id", eid);
      if (error) { toast.error("No se pudo eliminar el gasto. Intenta de nuevo."); return; }
      setData((d) => ({ ...d, personal: d.personal.filter((x) => x.id !== eid) }));
    } finally { mark(eid, false); }
  };

  const onRemovePayment = async (pid: string) => {
    if (busy.has(pid)) return;
    if (!window.confirm("¿Eliminar este pago? La deuda vuelve a aparecer.")) return;
    mark(pid, true);
    try {
      const { error } = await supabase.from("trip_split_payments").delete().eq("id", pid);
      if (error) { toast.error(splitErrorMessage(error)); return; }
      setData((d) => ({ ...d, payments: d.payments.filter((x) => x.id !== pid) }));
    } finally { mark(pid, false); }
  };

  const confirmSettle = async () => {
    if (!settle || !id || settling) return;
    const amount = Math.round(Number(String(settle.input).replace(",", ".")) * 100) / 100;
    if (!(amount > 0)) { toast.error("El monto debe ser mayor a 0"); return; }
    setSettling(true);
    try {
      const { error } = await registerPayment(supabase, id, { from_person: settle.from, to_person: settle.to, amount, currency: settle.currency });
      if (error) { toast.error(splitErrorMessage(error)); return; }
      toast.success("Pago registrado");
      setSettle(null);
      await reload();
    } finally { setSettling(false); }
  };

  const onViewReceipt = async (path: string) => {
    const url = await receiptUrl(supabase, path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("No se pudo abrir el ticket.");
  };

  const nameOf = (pid: string) => (pid === me?.id ? "Tú" : people.find((p) => p.id === pid)?.name ?? "?");

  return (
    <DashboardLayout>
      <FeatureTooltip id="split" icon="💰" text="Anota tus gastos del viaje y divide los compartidos con tu grupo. Iato lleva la cuenta." shouldShow={tipSplit.shouldShow} onDismiss={tipSplit.dismiss} />
      <div className="p-4 sm:p-6 md:p-10 max-w-3xl mx-auto">
        <div className="mb-4 flex items-center gap-3">
          <Receipt className="w-7 h-7 text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Gastos del viaje</p>
            <h1 className="font-display text-2xl sm:text-3xl truncate">{data.trip?.destino}</h1>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <input ref={scanRef} type="file" accept="image/*,application/pdf" className="hidden" aria-label="Elegir foto del ticket"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) openForm(f); }} />
          <Button onClick={() => scanRef.current?.click()} variant="outline" className="flex-1 sm:flex-none" disabled={!user || !loaded}>
            <Camera className="w-4 h-4 mr-2" aria-hidden="true" /> Escanear ticket
          </Button>
          <Button onClick={() => openForm(null)} className="flex-1 sm:flex-none bg-primary text-primary-foreground hover:bg-primary/90" disabled={!user || !loaded}>
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Nuevo gasto
          </Button>
        </div>

        {formOpen && id && user && (
          <TripExpenseForm key={formKey} client={supabase} tripId={id} userId={user.id} people={people} cities={cities}
            suggestedCurrency={destinationCurrency(data.trip)} usedCurrencies={[...data.expenses.map((e) => e.currency), ...data.personal.map((e) => e.currency)]}
            fx={fx} initialFile={initialFile} onClose={() => setFormOpen(false)}
            onSaved={(kind) => { setFormOpen(false); setTab(kind === "personal" ? "gastos" : "compartidos"); void reload(); }} />
        )}

        <div role="tablist" aria-label="Gastos del viaje" className="grid grid-cols-2 p-1 rounded-full border border-border bg-surface mb-4">
          {TRIP_EXPENSE_TABS.map((t, i) => {
            const Icon = t.icon;
            const selected = tab === t.id;
            return (
              <button key={t.id} role="tab" id={`trip-gastos-tab-${t.id}`} aria-selected={selected} aria-controls="trip-gastos-panel" tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const next = TRIP_EXPENSE_TABS[(i + 1) % TRIP_EXPENSE_TABS.length].id;
                  setTab(next);
                  document.getElementById(`trip-gastos-tab-${next}`)?.focus();
                }}
                className={`px-3 py-2 rounded-full text-sm transition flex items-center justify-center gap-1.5 whitespace-nowrap ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground -mt-2 mb-4" data-testid="trip-gastos-explainer">
          {tab === "gastos"
            ? "Lo que tú llevas gastado en este viaje, en pesos. Solo lo ves tú."
            : "Lo que se divide entre el grupo: quién pagó, quién debe y cómo quedar a mano. Lo ven todos los del viaje."}
        </p>

        {settle && (
          <section aria-label="Registrar pago" className="glass-card rounded-2xl p-4 mb-4 border-primary/40">
            <p className="text-sm font-medium mb-2 flex items-center gap-2"><HandCoins className="w-4 h-4 text-primary" aria-hidden="true" /> Registrar pago</p>
            <p className="text-sm mb-3">{settle.from === me?.id ? `Le pagas a ${nameOf(settle.to)}` : settle.to === me?.id ? `${nameOf(settle.from)} te paga` : `${nameOf(settle.from)} le paga a ${nameOf(settle.to)}`}</p>
            <div className="flex gap-2 items-center">
              <Input aria-label="Monto del pago" type="number" min="0.01" step="0.01" inputMode="decimal" value={settle.input}
                onChange={(e) => setSettle({ ...settle, input: e.target.value })} className="w-36" />
              <span className="text-sm text-muted-foreground">{settle.currency}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Regístralo cuando el pago ya se hizo (efectivo, transferencia…). La deuda de {formatMoney(settle.amount, settle.currency)} baja en lo que pongas.</p>
            <div className="flex gap-2 mt-3">
              <Button onClick={confirmSettle} disabled={settling} aria-busy={settling}>{settling ? "Guardando…" : "Registrar pago"}</Button>
              <Button variant="ghost" onClick={() => setSettle(null)}>Cancelar</Button>
            </div>
          </section>
        )}

        <div role="tabpanel" id="trip-gastos-panel" aria-labelledby={`trip-gastos-tab-${tab}`}>
          {!loaded ? (
            <div className="glass-card rounded-2xl p-8 text-center text-sm text-muted-foreground">Cargando gastos…</div>
          ) : tab === "gastos" ? (
            <TripPersonalTab items={myItems} summary={summary} fx={fx} removing={busy} onRemovePersonal={onRemovePersonal}
              onAdd={() => openForm(null)} onOpenShared={() => setTab("compartidos")} tripDays={tripDays} />
          ) : (
            <TripSharedTab people={people} expenses={data.expenses} payments={data.payments} split={split} fx={fx}
              meId={me?.id ?? null} iAmOwner={iAmOwner} userId={user?.id ?? ""} busy={busy}
              onAddGuest={onAddGuest} onRemovePerson={onRemovePerson} onClaim={onClaim} onUnlink={onUnlink}
              onRemoveExpense={onRemoveExpense} onRemovePayment={onRemovePayment}
              onSettle={(t) => setSettle({ ...t, input: String(t.amount) })} onViewReceipt={onViewReceipt} onAdd={() => openForm(null)} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripSplit;
