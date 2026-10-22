// "Comprar mi viaje": reserva en 3 pasos (cierre 2, grupo enlaces). Lista lo cotizado y, por cada cosa,
// dice a qué sitio lleva el botón, qué datos van precargados en ese enlace (leídos de la URL), qué hay
// que completar ahí y si alguien del viaje ya lo reservó (lo marca a mano: IATOS no ve la compra). En un
// viaje compartido todos los miembros ven quién lo marcó y cuándo (r2 grupo, useTripPurchaseMarks).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Car, Check, Compass, ExternalLink, Hotel, Plane, ShieldCheck, ShoppingBag, Undo2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { logBookingClick } from "@/lib/trackBooking";
import { buildPurchasePlan, itemPurchaseState, type PurchaseItem, type PurchaseMarkRow, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { canUnmark, markLabel } from "@/lib/purchaseMarks";
import { useTripPurchaseMarks } from "@/hooks/useTripPurchaseMarks";

const ICON = { vuelo: Plane, hospedaje: Hotel, auto: Car, actividad: Compass, restaurante: Utensils } as const;
const KIND_LABEL = { vuelo: "Vuelo", hospedaje: "Hospedaje", auto: "Auto", actividad: "Actividad", restaurante: "Restaurante" } as const;
const money = (n: number, cur: string | null) => `$${Math.round(n).toLocaleString("es-MX")} ${cur ?? "MXN"}`;

type Props = {
  trip: any;
  selVuelo: number;
  selHospedaje: number;
  selTours: Set<number>;
  serverOffers?: TripOfferActionsLike;
  bookings: PurchaseMarkRow[];
  userId: string | null;
  /** Dueño del viaje (puede quitar cualquier marca). Por defecto, trip.user_id. */
  ownerId?: string | null;
  quoteCreatedAt?: string | null;
  onChanged?: () => void;
};

export function TripPurchasePlan({ trip, selVuelo, selHospedaje, selTours, serverOffers = {}, bookings, userId, ownerId, quoteCreatedAt, onChanged }: Props) {
  const items = useMemo(
    () => buildPurchasePlan(trip, { selVuelo, selHospedaje, selTours }, serverOffers, { quoteCreatedAt }),
    [trip, selVuelo, selHospedaje, selTours, serverOffers, quoteCreatedAt],
  );
  const { rows, marks, mark: saveMark, unmark: removeMark } = useTripPurchaseMarks({ trip, userId, bookings });
  const owner = ownerId ?? trip?.user_id ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  if (!items.length) return null;
  const core = items.filter((i) => !i.optional);
  const doneCore = core.filter((i) => itemPurchaseState(i, rows, marks) !== "pendiente").length;

  async function mark(item: PurchaseItem) {
    if (!userId) return toast.error("Inicia sesión para guardar tu avance.");
    setBusy(item.key);
    const r = await saveMark(item);
    setBusy(null);
    if (!r.ok) return toast.error("No se pudo guardar", { description: "Intenta de nuevo en un momento." });
    toast.success("Marcado como reservado", { description: "Lo marcaste tú: IATOS no lo verificó con el sitio. Quienes viajan contigo lo verán marcado. Guarda tu confirmación en Documentos del viaje." });
    onChanged?.();
  }

  async function unmark(item: PurchaseItem) {
    setBusy(item.key);
    const r = await removeMark(item);
    setBusy(null);
    if (r.reason === "no_permitido") return toast.error("No se pudo deshacer", { description: "Solo quien lo marcó o quien creó el viaje puede quitarlo." });
    if (!r.ok) return toast.error("No se pudo deshacer", { description: "Intenta de nuevo en un momento." });
    onChanged?.();
  }

  return (
    <section id="trip-comprar" aria-labelledby="trip-comprar-title" className="scroll-mt-20 rounded-2xl border border-primary/25 bg-card/60 p-4 sm:p-6 focus:outline-none" data-testid="trip-comprar">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <ShoppingBag className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
          <h2 id="trip-comprar-title" className="font-display text-2xl sm:text-3xl">Comprar mi viaje</h2>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="trip-comprar-progreso">
          {doneCore} de {core.length} reservado{core.length === 1 ? "" : "s"}
        </p>
      </div>
      <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-3" aria-label="Reserva en 3 pasos">
        <li className="rounded-xl bg-surface/50 px-3 py-2"><span className="font-medium text-primary">1.</span> Abre cada sitio: tus datos van precargados.</li>
        <li className="rounded-xl bg-surface/50 px-3 py-2"><span className="font-medium text-primary">2.</span> Revisa el precio y paga en ese sitio.</li>
        <li className="rounded-xl bg-surface/50 px-3 py-2"><span className="font-medium text-primary">3.</span> Vuelve y toca “Ya lo reservé”.</li>
      </ol>
      <p className="mt-3 flex items-start gap-2 rounded-xl border border-border/60 bg-surface/40 px-3 py-2 text-xs text-muted-foreground" data-testid="trip-comprar-avisos">
        <ShieldCheck className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
        <span>IATOS no cobra ni emite boletos: pagas directo en cada sitio. El precio puede cambiar en el sitio; confirma fechas, personas y precio antes de pagar.</span>
      </p>

      <ul className="mt-4 space-y-3">
        {items.map((it) => {
          const st = itemPurchaseState(it, rows, marks);
          const mk = marks.get(it.key) ?? null;
          const mine = !!mk && (mk.source === "propia" || mk.markedBy === userId);
          const Icon = ICON[it.kind];
          return (
            <li key={it.key} className={`rounded-xl border p-3 sm:p-4 ${st === "pendiente" ? "border-border/60 bg-surface/30" : "border-emerald-500/40 bg-emerald-500/[0.06]"}`}
              data-testid={`comprar-${it.kind}`} data-state={st}>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-primary">
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {KIND_LABEL[it.kind]}{it.optional ? " · opcional" : ""}
                  </p>
                  <p className="font-medium break-words">{it.title.replace(/^(Vuelo|Hospedaje) · /, "")}</p>
                  {it.subtitle && <p className="text-xs text-muted-foreground break-words">{it.subtitle}</p>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {it.price ? <span className="font-display text-lg">{money(it.price, it.currency)}{it.estimate ? <span className="text-xs text-muted-foreground"> (estimado)</span> : null}</span> : null}
                    {it.priceNote && <span className="text-xs text-muted-foreground">{it.priceNote}</span>}
                  </div>
                  {(it.source.fuente || it.source.consultadoAt) && (
                    <PriceSourceBadge source={it.source.fuente} estado={it.source.estado} consultadoAt={it.source.consultadoAt} approximateDates={it.source.approximateDates} />
                  )}
                  {it.url ? (
                    <div className="space-y-0.5 pt-1 text-xs">
                      <p><span className="text-muted-foreground">Te lleva a:</span> <span className="font-medium">{it.site}</span></p>
                      <p data-testid={`comprar-${it.kind}-lleva`}>
                        <span className="text-muted-foreground">Va precargado:</span> {it.lleva.length ? it.lleva.join(" · ") : "nada (el sitio no lo recibe por enlace)"}
                      </p>
                      {it.completa && <p className="text-muted-foreground">{it.completa}</p>}
                    </div>
                  ) : (
                    <p className="pt-1 text-xs text-muted-foreground">No encontramos un enlace fiable para comprarlo en línea.</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 md:w-56">
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noopener noreferrer" data-testid={`comprar-${it.kind}-abrir`}
                      onClick={() => void logBookingClick({ category: it.category, provider: it.site ?? "Proveedor", title: it.title, bookingUrl: it.url!,
                        city: trip.destino ?? undefined, tripId: trip.id, startAt: trip.fecha_salida ?? undefined })}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
                      {it.buttonLabel ?? `Abrir en ${it.site}`} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                  ) : it.fallbackHref ? (
                    <Link to={it.fallbackHref} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-primary/40 px-3 py-2 text-sm text-primary">
                      Buscar en IATOS
                    </Link>
                  ) : null}
                  {st === "confirmado" ? (
                    <p className="inline-flex items-center justify-center gap-1 text-sm text-emerald-400"><Check className="w-4 h-4" /> Confirmado</p>
                  ) : st === "marcado" ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm">
                      <span className="inline-flex min-w-0 items-start gap-1 text-emerald-400" data-testid={`comprar-${it.kind}-marca`}>
                        <Check className="mt-0.5 w-4 h-4 shrink-0" aria-hidden="true" /><span className="break-words">{mk ? markLabel(mk, userId) : "Ya lo reservé"}</span>
                      </span>
                      {mk && canUnmark(mk, userId, owner) && (
                        <button type="button" onClick={() => void unmark(it)} disabled={busy === it.key} className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Marcar ${it.title} como pendiente`}>
                          <Undo2 className="w-3 h-3" aria-hidden="true" /> Deshacer
                        </button>
                      )}
                    </div>
                  ) : (
                    <button type="button" onClick={() => void mark(it)} disabled={busy === it.key} data-testid={`comprar-${it.kind}-marcar`}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
                      {busy === it.key ? "Guardando…" : "Ya lo reservé"}
                    </button>
                  )}
                  <p className="text-center text-[11px] text-muted-foreground">{st === "marcado" ? (mine ? "Marcado por ti · sin verificar" : "Marcado a mano · sin verificar") : st === "pendiente" ? "Pendiente" : "Con confirmación del proveedor"}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
