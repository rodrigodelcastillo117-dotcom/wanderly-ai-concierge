import { useState } from "react";
import { ArrowRight, Crown, HandCoins, ImageIcon, Plus, Trash2, UserCheck, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { convertedTotal, formatMoney, fxLabel, type FxTable } from "@/lib/fx";
import { formatDateOnly } from "@/lib/dateUtils";
import { myLines, type SplitResult, type Transfer } from "@/lib/split";
import type { SharedExpense, SplitPaymentRow } from "@/lib/tripExpensesApi";
import type { PersonView } from "./TripExpenseForm";

type Props = {
  people: PersonView[];
  expenses: SharedExpense[];
  payments: SplitPaymentRow[];
  split: SplitResult;
  fx: FxTable | null;
  meId: string | null;
  iAmOwner: boolean;
  userId: string;
  busy: Set<string>;
  onAddGuest: (name: string) => Promise<boolean>;
  onRemovePerson: (id: string) => void;
  onClaim: (id: string) => void;
  onUnlink: (id: string) => void;
  onRemoveExpense: (id: string) => void;
  onRemovePayment: (id: string) => void;
  onSettle: (t: Transfer) => void;
  onViewReceipt: (path: string) => void;
  onAdd: () => void;
};

/**
 * Pestaña "Gastos compartidos" (estilo Splitwise): tu saldo, quién le debe a quién (el mínimo de
 * pagos para quedar a mano), las personas del viaje y cada gasto con su división. Lo ven todos los
 * miembros del viaje.
 */
export function TripSharedTab(p: Props) {
  const { people, expenses, payments, split, fx, meId, iAmOwner, userId, busy } = p;
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const name = (id: string) => (id === meId ? "Tú" : people.find((x) => x.id === id)?.name ?? "?");
  const person = (id: string) => people.find((x) => x.id === id);
  const monedas = Object.keys(split.totals);
  const enMxn = fx && monedas.length > 1 ? convertedTotal(monedas.map((c) => ({ amount: split.totals[c], currency: c })), "MXN", fx) : null;
  const mine = myLines(split, meId);
  const canSettle = (t: Transfer) => t.from === meId || t.to === meId || (!person(t.from)?.isMember && !person(t.to)?.isMember);
  const canDelete = (e: SharedExpense) => !e.created_by || e.created_by === userId || iAmOwner;

  const add = async () => {
    const n = newName.trim();
    if (!n || adding) return;
    setAdding(true);
    try { if (await p.onAddGuest(n)) setNewName(""); } finally { setAdding(false); }
  };

  return (
    <div className="space-y-4">
      {/* Tu saldo */}
      {meId && expenses.length > 0 && (
        <section aria-label="Tu saldo" className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 md:p-5">
          <p className="text-[10px] md:text-xs text-primary tracking-[0.2em] uppercase mb-2">Tu saldo</p>
          {mine.length === 0 ? (
            <p className="font-display text-xl">Estás a mano</p>
          ) : (
            <ul className="space-y-1">
              {mine.map((l, i) => (
                <li key={i} className={`font-display text-xl ${l.kind === "debes" ? "text-destructive" : "text-emerald-400"}`}>
                  {l.kind === "debes" ? `Debes ${formatMoney(l.amount, l.currency)} a ${name(l.other)}` : `${name(l.other)} te debe ${formatMoney(l.amount, l.currency)}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Quién debe a quién */}
      {expenses.length > 0 && (
        <section aria-label="Quién debe a quién" className="glass-card rounded-2xl p-4 md:p-5">
          <h2 className="text-sm font-medium mb-1">Quién debe a quién</h2>
          <p className="text-[11px] text-muted-foreground mb-3">
            Total: {monedas.map((c) => formatMoney(split.totals[c], c)).join(" · ")}
            {enMxn && (
              <span className="block">
                ≈ {formatMoney(Math.round(enMxn.total), "MXN", 0)} en total
                {enMxn.unconvertedCount > 0 && ` (sin contar ${Object.keys(enMxn.unconverted).join(", ")}: sin tipo de cambio disponible)`}
                {" · "}{fxLabel(fx!)}. Cada deuda se paga en la moneda del gasto.
              </span>
            )}
          </p>
          {split.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todos están a mano.</p>
          ) : (
            <ul className="space-y-2">
              {split.transfers.map((t, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-medium truncate">{name(t.from)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="font-medium truncate">{name(t.to)}</span>
                  <span className="text-primary ml-auto shrink-0">{formatMoney(t.amount, t.currency)}</span>
                  {canSettle(t) && (
                    <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => p.onSettle(t)} aria-label={`Liquidar: ${name(t.from)} paga ${formatMoney(t.amount, t.currency)} a ${name(t.to)}`}>
                      <HandCoins className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Liquidar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {monedas.map((c) => (
            <details key={c} className="mt-3 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Saldo de cada quien{monedas.length > 1 ? ` en ${c}` : ""}</summary>
              <ul className="mt-1">
                {people.map((x) => {
                  const b = split.balances[c]?.[x.id] || 0;
                  return (
                    <li key={x.id} className="flex justify-between py-1 border-b border-border/30 last:border-0">
                      <span>{x.isMe ? "Tú" : x.name}</span>
                      <span className={b >= 0 ? "text-emerald-400" : "text-destructive"}>{b >= 0 ? "+" : "−"}{formatMoney(Math.abs(b), c)}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </section>
      )}

      {/* Personas */}
      <section aria-label="Personas del viaje" className="glass-card rounded-2xl p-4 md:p-5">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-primary" aria-hidden="true" /> Personas</h2>
        <ul className="space-y-2 mb-3">
          {people.map((x) => (
            <li key={x.id} className="flex items-center gap-3">
              <FriendAvatar name={x.name} url={x.avatar} className="w-8 h-8" />
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate flex items-center gap-1.5">
                  {x.name}{x.isMe && <span className="text-[10px] text-primary">(tú)</span>}
                  {x.isOwner && <Crown className="w-3 h-3 text-primary" aria-label="Organiza el viaje" />}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {x.former ? "Ya no está en el viaje" : x.isMember ? "Miembro del viaje" : "Sin la app"}
                  {x.linkedByName && x.legacyName && x.legacyName !== x.name ? ` · antes «${x.legacyName}»` : ""}
                </p>
              </div>
              {x.linkedByName && (x.isMe || iAmOwner) && (
                <button type="button" onClick={() => p.onUnlink(x.id)} disabled={busy.has(x.id)} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                  {x.isMe ? "No soy yo" : "No es esta persona"}
                </button>
              )}
              {!x.isMember && meId && (
                <button type="button" onClick={() => p.onClaim(x.id)} disabled={busy.has(x.id)} aria-label={`Soy ${x.name}`}
                  className="text-[11px] text-primary inline-flex items-center gap-1 underline-offset-2 hover:underline"><UserCheck className="w-3.5 h-3.5" aria-hidden="true" /> Soy yo</button>
              )}
              {!x.isMember && (
                <button onClick={() => p.onRemovePerson(x.id)} disabled={busy.has(x.id)} aria-label={`Quitar a ${x.name}`} className="p-2 -m-1">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input aria-label="Nombre de la persona" placeholder="Agregar a alguien sin la app" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} maxLength={80} />
          <Button onClick={add} disabled={adding || !newName.trim()} className="shrink-0" aria-label="Agregar persona"><UserPlus className="w-4 h-4" aria-hidden="true" /></Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Los miembros del viaje aparecen solos. Para sumar a alguien con la app, invítalo con "Compartir" en el viaje.</p>
      </section>

      {/* Gastos compartidos */}
      <section aria-label="Lista de gastos compartidos" className="glass-card rounded-2xl p-4 md:p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">Gastos</h2>
          <Button size="sm" variant="ghost" onClick={p.onAdd}><Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Agregar</Button>
        </div>
        {expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay gastos compartidos. Registra uno y marca con quiénes lo divides.</p>
        ) : (
          <ul>
            {expenses.map((e) => {
              const myShare = e.shares.find((s) => s.person_id === meId)?.amount ?? null;
              const n = e.shares.length || people.length;
              return (
                <li key={e.id} className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{e.description}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {e.payer_id === meId ? "Pagaste tú" : `Pagó ${name(e.payer_id)}`} · entre {n} {n === 1 ? "persona" : "personas"}
                      {e.split_mode === "exact" ? " (montos exactos)" : e.split_mode === "percent" ? " (porcentajes)" : ""}
                      {e.expense_date ? ` · ${formatDateOnly(e.expense_date)}` : ""}{e.city ? ` · ${e.city}` : ""}
                    </p>
                    {myShare != null && <p className="text-[11px] text-primary">Tu parte: {formatMoney(myShare, e.currency)}</p>}
                  </div>
                  {e.receipt_path && (
                    <button type="button" onClick={() => p.onViewReceipt(e.receipt_path!)} aria-label={`Ver ticket de ${e.description}`} className="p-2 -m-1 text-muted-foreground hover:text-primary">
                      <ImageIcon className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                  <span className="text-sm font-medium shrink-0">{formatMoney(Number(e.amount), e.currency || "MXN")}</span>
                  {canDelete(e) && (
                    <button onClick={() => p.onRemoveExpense(e.id)} disabled={busy.has(e.id)} aria-label={`Eliminar gasto ${e.description ?? ""}`.trim()} className="p-2 -m-1">
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {payments.length > 0 && (
        <section aria-label="Pagos registrados" className="glass-card rounded-2xl p-4 md:p-5">
          <h2 className="text-sm font-medium mb-2">Pagos registrados</h2>
          <ul>
            {payments.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2 text-sm border-b border-border/30 last:border-0">
                <span className="truncate">
                  {x.from_person === meId ? `Le pagaste a ${name(x.to_person)}` : x.to_person === meId ? `${name(x.from_person)} te pagó` : `${name(x.from_person)} le pagó a ${name(x.to_person)}`}
                </span>
                {x.paid_on && <span className="text-[11px] text-muted-foreground shrink-0">{formatDateOnly(x.paid_on)}</span>}
                <span className="ml-auto shrink-0">{formatMoney(x.amount, x.currency)}</span>
                {(x.created_by === userId || iAmOwner) && (
                  <button onClick={() => p.onRemovePayment(x.id)} disabled={busy.has(x.id)} aria-label="Eliminar pago" className="p-2 -m-1">
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
