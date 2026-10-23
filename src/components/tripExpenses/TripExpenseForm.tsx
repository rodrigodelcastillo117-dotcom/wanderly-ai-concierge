import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Loader2, Receipt, ShieldAlert, Sparkles, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencySelect } from "@/components/CurrencySelect";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { EXPENSE_CATEGORIES, DEFAULT_EXPENSE_CATEGORY } from "@/lib/expenseCategories";
import { convert, formatMoney, fxLabel, type FxTable } from "@/lib/fx";
import { buildShares, parseSplitAmount, type SplitMode } from "@/lib/split";
import { localISODate } from "@/lib/localDate";
import {
  discardReceipt, savePersonalExpense, saveSharedExpense, splitErrorMessage, uploadAndScanReceipt, type ReceiptReading,
} from "@/lib/tripExpensesApi";

export type PersonView = {
  id: string;
  name: string;
  isMe: boolean;
  isMember: boolean;
  isOwner: boolean;
  avatar: string | null;
  /** Era miembro y ya no está en el viaje. */
  former: boolean;
  /** Nombre escrito a mano antes, si se ligó por nombre. */
  legacyName: string | null;
  linkedByName: boolean;
};

type Props = {
  client: any;
  tripId: string;
  userId: string;
  people: PersonView[];
  cities: string[];
  suggestedCurrency: string | null;
  usedCurrencies: string[];
  fx: FxTable | null;
  /** Foto elegida con "Escanear ticket" antes de abrir el formulario: se lee al abrir. */
  initialFile?: File | null;
  onClose: () => void;
  onSaved: (kind: "personal" | "compartido") => void;
};

const MODES: { id: SplitMode; label: string }[] = [
  { id: "equal", label: "Partes iguales" },
  { id: "exact", label: "Montos exactos" },
  { id: "percent", label: "Porcentajes" },
];

const CONF_TEXT: Record<ReceiptReading["confidence"], string> = {
  alta: "Leímos tu ticket. Revisa y confirma.",
  media: "Leímos tu ticket con dudas: revisa monto, moneda y fecha antes de guardar.",
  baja: "Lectura con poca confianza: revisa con cuidado monto, moneda y fecha antes de guardar.",
};

/**
 * Registrar un gasto del viaje. Por defecto es solo tuyo (lo pagaste tú y es para ti); al marcar a
 * más personas se vuelve compartido y se elige cómo dividirlo. Con "Escanear ticket" la IA llena los
 * campos y la persona confirma: nunca se guarda solo.
 */
export function TripExpenseForm({ client, tripId, userId, people, cities, suggestedCurrency, usedCurrencies, fx, initialFile, onClose, onSaved }: Props) {
  const me = people.find((p) => p.isMe) ?? null;
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>(suggestedCurrency || "MXN");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(DEFAULT_EXPENSE_CATEGORY);
  const [date, setDate] = useState(localISODate());
  const [city, setCity] = useState<string>(cities.length === 1 ? cities[0] : "");
  const [payer, setPayer] = useState<string>(me?.id ?? "");
  const [participants, setParticipants] = useState<string[]>(me ? [me.id] : []);
  const [mode, setMode] = useState<SplitMode>("equal");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ path: string; receipt: ReceiptReading | null; message?: string; file: File } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saved = useRef(false);
  const scanPath = useRef<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialFile) void onPickFile(initialFile); }, [initialFile]);
  // Si se cierra sin guardar, la foto subida para leerla se borra.
  useEffect(() => () => { if (!saved.current && scanPath.current) void discardReceipt(client, scanPath.current); }, [client]);

  const payers = people.filter((p) => p.isMe || !p.isMember);
  const others = people.filter((p) => !p.isMe && !p.former);
  const isShared = !!me && (payer !== me.id || participants.some((id) => id !== me.id));
  const total = parseSplitAmount(amount);
  const plan = useMemo(() => (total ? buildShares(total, mode, participants, inputs) : null), [total, mode, participants, inputs]);
  const cur = currency.toUpperCase();
  const previewMxn = fx && total && cur !== "MXN" ? convert(total, cur, "MXN", fx) : null;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  const labelOf = (id: string) => (id === me?.id ? "Yo" : nameOf(id));

  const toggle = (id: string) => {
    setParticipants((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const everyone = () => setParticipants(people.filter((p) => !p.former).map((p) => p.id));

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (scanPath.current) { void discardReceipt(client, scanPath.current); scanPath.current = null; }
    setScanning(true);
    setScan(null);
    try {
      const out = await uploadAndScanReceipt(client, { tripId, userId, file, currencyHint: suggestedCurrency });
      scanPath.current = out.path;
      if (out.ok) {
        const r = out.receipt;
        setAmount(String(r.total));
        if (r.currency) setCurrency(r.currency);
        if (r.merchant) setDescription(r.merchant);
        if (r.date) setDate(r.date);
        setScan({ path: out.path, receipt: r, file });
      } else {
        const fail = out as Extract<typeof out, { ok: false }>;
        if (fail.path) setScan({ path: fail.path, receipt: null, message: fail.message, file });
        else toast.error(fail.message);
      }
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    if (saving || scanning) return;
    if (total == null) { toast.error("El monto debe ser mayor a 0"); return; }
    const desc = (description.trim() || category).slice(0, 200);
    setSaving(true);
    try {
      if (!isShared) {
        const { error } = await savePersonalExpense(client, userId, tripId, {
          amount: total, currency: cur, category, description: desc, expense_date: date, city: city || null,
        }, scan?.file ?? null);
        if (error) { toast.error(splitErrorMessage(error)); return; }
        // La foto ya se guardó en tus recibos personales: la copia para leerla se borra.
        if (scan?.path) await discardReceipt(client, scan.path);
        saved.current = true;
        toast.success("Gasto guardado");
        onSaved("personal");
        return;
      }
      if (!plan || !plan.ok) {
        toast.error(plan && !plan.ok ? (plan as Extract<typeof plan, { ok: false }>).error : "Revisa la división");
        return;
      }
      const r = scan?.receipt ?? null;
      const { error } = await saveSharedExpense(client, tripId, {
        payer_id: payer, amount: total, currency: cur, description: desc, category, expense_date: date, city: city || null,
        merchant: r?.merchant ?? null, tip: r?.tip ?? null, tax: r?.tax ?? null, receipt_path: scan?.path ?? null, split_mode: mode,
        scan: r ? { confianza: r.confidence, puntaje: r.confidenceScore, avisos: r.warnings.slice(0, 5), conceptos: r.items.slice(0, 30),
          subtotal: r.subtotal, leido_total: r.total, leido_moneda: r.currency, leido_fecha: r.date } : null,
      }, plan.shares);
      if (error) { toast.error(splitErrorMessage(error)); return; }
      saved.current = true;
      toast.success("Gasto compartido guardado");
      onSaved("compartido");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (scan?.path) void discardReceipt(client, scan.path);
    scanPath.current = null;
    onClose();
  };

  const remainingText = () => {
    if (!total || !plan || plan.ok) return null;
    const r = (plan as Extract<typeof plan, { ok: false }>).remaining;
    if (r == null) return null;
    if (mode === "percent") return r > 0 ? `Falta ${r} % por repartir` : `Sobra ${Math.abs(r)} %`;
    return r > 0 ? `Faltan ${formatMoney(r, cur)} por repartir` : `Sobran ${formatMoney(Math.abs(r), cur)}`;
  };

  return (
    <section aria-label="Nuevo gasto" className="glass-card rounded-2xl p-4 sm:p-5 mb-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">Nuevo gasto</h2>
        <button type="button" onClick={cancel} aria-label="Cancelar" className="p-2 -m-2 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" aria-hidden="true" /></button>
      </div>

      {/* Foto del ticket: la IA llena el formulario y tú confirmas. */}
      <div className="rounded-xl border border-dashed border-primary/40 p-3">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" aria-label="Foto del ticket"
          data-testid="ticket-file" onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
        {scanning ? (
          <p className="text-sm flex items-center gap-2" role="status"><Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" /> Leyendo tu ticket…</p>
        ) : scan?.receipt ? (
          <div role="status" className="space-y-1.5">
            <p className={`text-sm flex items-start gap-2 ${scan.receipt.confidence === "alta" ? "" : "text-amber-500"}`}>
              {scan.receipt.confidence === "alta" ? <Sparkles className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden="true" /> : <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{CONF_TEXT[scan.receipt.confidence]}</span>
            </p>
            {scan.receipt.warnings.length > 0 && (
              <ul className="text-[11px] text-muted-foreground list-disc pl-5">{scan.receipt.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
            {(scan.receipt.tip != null || scan.receipt.tax != null) && (
              <p className="text-[11px] text-muted-foreground">
                {scan.receipt.tip != null && <>Propina en el ticket: {formatMoney(scan.receipt.tip, scan.receipt.currency || cur)}. </>}
                {scan.receipt.tax != null && <>IVA: {formatMoney(scan.receipt.tax, scan.receipt.currency || cur)}.</>}
              </p>
            )}
            {scan.receipt.items.length > 0 && (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">Conceptos leídos ({scan.receipt.items.length})</summary>
                <ul className="mt-1 space-y-0.5">{scan.receipt.items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-3"><span className="truncate">{it.quantity && it.quantity !== 1 ? `${it.quantity} × ` : ""}{it.name}</span>
                    <span>{it.amount != null ? formatMoney(it.amount, scan.receipt!.currency || cur) : "—"}</span></li>
                ))}</ul>
              </details>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-primary underline-offset-2 hover:underline">Usar otra foto</button>
          </div>
        ) : scan ? (
          <div role="status" className="space-y-1">
            <p className="text-sm text-amber-500 flex items-start gap-2"><ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> {scan.message}</p>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-primary underline-offset-2 hover:underline">Intentar con otra foto</button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full flex items-center gap-3 text-left">
            <span className="w-9 h-9 rounded-full bg-primary/15 grid place-items-center shrink-0"><Camera className="w-4 h-4 text-primary" aria-hidden="true" /></span>
            <span className="min-w-0"><span className="block text-sm">Escanear ticket</span>
              <span className="block text-[11px] text-muted-foreground">Toma una foto o elige un archivo: la IA llena los datos y tú confirmas.</span></span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="tg-monto" className="text-xs text-muted-foreground mb-1 block">Monto</label>
          <Input id="tg-monto" type="number" min="0.01" step="0.01" inputMode="decimal" aria-label="Monto del gasto" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {previewMxn != null && fx && <p className="text-[11px] text-muted-foreground mt-1">≈ {formatMoney(Math.round(previewMxn), "MXN", 0)} · {fxLabel(fx)}</p>}
        </div>
        <div>
          <label htmlFor="tg-moneda" className="text-xs text-muted-foreground mb-1 block">Moneda</label>
          <CurrencySelect id="tg-moneda" ariaLabel="Moneda del gasto" value={currency} onChange={setCurrency} suggested={suggestedCurrency} used={usedCurrencies} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="tg-desc" className="text-xs text-muted-foreground mb-1 block">Descripción o comercio</label>
          <Input id="tg-desc" aria-label="Descripción del gasto" placeholder="Cena en Trastevere" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </div>
        <div>
          <label htmlFor="tg-cat" className="text-xs text-muted-foreground mb-1 block">Categoría</label>
          <select id="tg-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tg-fecha" className="text-xs text-muted-foreground mb-1 block">Fecha</label>
            <Input id="tg-fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="tg-ciudad" className="text-xs text-muted-foreground mb-1 block">Ciudad</label>
            <select id="tg-ciudad" value={city} onChange={(e) => setCity(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Sin ciudad</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {me && (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="¿Quién pagó?">
            <p className="text-xs text-muted-foreground mb-1.5">¿Quién pagó?</p>
            <div className="flex flex-wrap gap-2">
              {payers.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={payer === p.id} onClick={() => setPayer(p.id)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition ${payer === p.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}>
                  {p.isMe ? "Yo" : p.name}
                </button>
              ))}
            </div>
            {others.some((p) => p.isMember) && <p className="text-[11px] text-muted-foreground mt-1">Si pagó otro miembro del viaje, que lo registre esa persona desde su app.</p>}
          </div>

          <div role="group" aria-label="¿Entre quiénes?">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground">¿Entre quiénes se divide?</p>
              {people.length > 1 && <button type="button" onClick={everyone} className="text-[11px] text-primary underline-offset-2 hover:underline">Todos</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {people.filter((p) => !p.former).map((p) => {
                const on = participants.includes(p.id);
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(p.id)}
                    className={`pl-1 pr-3 py-1 rounded-full text-sm border flex items-center gap-1.5 transition ${on ? "bg-primary/15 border-primary text-foreground" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                    <FriendAvatar name={p.name} url={p.avatar} className="w-6 h-6" />
                    {p.isMe ? "Yo" : p.name}
                    {on && <Check className="w-3.5 h-3.5 text-primary" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          {isShared && participants.length > 0 && (
            <div className="space-y-2">
              <div role="radiogroup" aria-label="¿Cómo se divide?" className="grid grid-cols-3 p-1 rounded-full border border-border bg-surface">
                {MODES.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                    className={`px-2 py-1.5 rounded-full text-xs sm:text-sm whitespace-nowrap ${mode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{m.label}</button>
                ))}
              </div>
              {mode !== "equal" && (
                <div className="space-y-1.5">
                  {participants.map((id) => (
                    <div key={id} className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{labelOf(id)}</span>
                      <Input aria-label={`${mode === "percent" ? "Porcentaje" : "Monto"} de ${labelOf(id)}`}
                        type="number" min="0" step={mode === "percent" ? "0.1" : "0.01"} inputMode="decimal" className="w-28 h-9"
                        value={inputs[id] ?? ""} onChange={(e) => setInputs((prev) => ({ ...prev, [id]: e.target.value }))} />
                      <span className="text-xs text-muted-foreground w-8">{mode === "percent" ? "%" : cur}</span>
                    </div>
                  ))}
                </div>
              )}
              {plan?.ok && (
                <p className="text-[11px] text-muted-foreground" data-testid="split-preview">
                  {plan.shares.map((s) => `${s.person_id === me?.id ? "Tú" : nameOf(s.person_id)} ${formatMoney(s.amount, cur)}`).join(" · ")}
                </p>
              )}
              {remainingText() && <p className="text-[11px] text-amber-500" role="status">{remainingText()}</p>}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        {isShared
          ? <><Users className="w-3.5 h-3.5" aria-hidden="true" /> Compartido: lo ven los miembros del viaje. Tu parte cuenta en tu total.</>
          : <><Receipt className="w-3.5 h-3.5" aria-hidden="true" /> Solo tuyo: no lo ve nadie más.</>}
      </p>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || scanning} aria-busy={saving} className="flex-1 sm:flex-none">
          {saving ? "Guardando…" : "Guardar gasto"}
        </Button>
        <Button variant="ghost" onClick={cancel}>Cancelar</Button>
      </div>
    </section>
  );
}
