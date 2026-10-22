// Botones de reserva de una opción (Fase 7 y complemento, punto 2): solo las acciones que la oferta
// realmente admite, con el texto exacto de cada una ("Comprar esta oferta" solo si es exacta). Es un
// componente autocontenido para que el grupo godtier pueda restilizar la página del viaje sin tocarlo.
import { useState } from "react";
import { ExternalLink, MapPin, MessageCircle, RefreshCw, Bookmark } from "lucide-react";
import { toast } from "sonner";
import type { BookingAction, BookingOffer } from "@/lib/booking";
import { bridge, type BridgeSource, newIdempotencyKey } from "@/lib/bookingBridgeApi";
import { BookingSheet } from "./BookingSheet";
import { RequestComposer } from "./RequestComposer";

const CHANNEL_KINDS = ["whatsapp", "email", "sms", "phone", "assisted_request", "prive_request"];

export function BookingActions({ offer, source, tripId, serverActions, className = "", max = 3, fallbackInternal = null }: {
  offer: BookingOffer;
  source: BridgeSource;
  tripId?: string | null;
  /** Acciones calculadas por booking-bridge con datos del servidor (catálogo, verificaciones). */
  serverActions?: BookingAction[] | null;
  className?: string;
  /** Cuántas acciones web se muestran como botones (el resto en "Más opciones"). */
  max?: number;
  /** Acción dentro de IATOS cuando no hay enlace externo fiable (p. ej. buscar vuelos reales). */
  fallbackInternal?: { label: string; href: string } | null;
}) {
  const actions = serverActions?.length ? serverActions : offer.actions;
  const o: BookingOffer = serverActions?.length ? { ...offer, actions } : offer;
  const [sheet, setSheet] = useState<BookingAction | null>(null);
  const [composer, setComposer] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [checking, setChecking] = useState(false);

  const web = actions.filter((a) => a.tier >= 1 && a.tier <= 4 && a.url);
  const channel = actions.find((a) => CHANNEL_KINDS.includes(a.kind));
  const maps = actions.find((a) => a.kind === "maps_listing" && a.url);
  const recheck = actions.find((a) => a.kind === "recheck_price");
  const save = actions.find((a) => a.kind === "save_for_later");
  const shown = more ? web : web.slice(0, max);

  async function doRecheck(e: React.MouseEvent) {
    e.stopPropagation();
    setChecking(true);
    const r = await bridge("recheck_price", { source });
    setChecking(false);
    const rc = r.recheck;
    if (!r.ok || !rc) return toast.error(r.message ?? "No se pudo comprobar el precio ahora.");
    if (!rc.ok) return toast(rc.message);
    if (rc.availability === "sold_out") return toast.error("La fuente ya no muestra precio para esas fechas (posiblemente agotado).");
    const p = rc.price_change;
    toast.success(
      p.direction === "same" ? "El precio sigue igual en la fuente." : p.direction === "up" ? `Subió ${Math.abs(p.delta ?? 0)} ${rc.currency}.` :
        p.direction === "down" ? `Bajó ${Math.abs(p.delta ?? 0)} ${rc.currency}.` : `Precio actual: ${rc.price ?? "no disponible"} ${rc.currency}.`,
      { description: "Comprobado ahora con la fuente original. El proveedor confirma el precio final." },
    );
  }

  async function doSave(e: React.MouseEvent) {
    e.stopPropagation();
    const r = await bridge("start_booking", { source, action_kind: "save_for_later", idempotency_key: newIdempotencyKey(), consent: true });
    if (r.ok) toast.success("Guardado en tu viaje", { description: "Aún no está reservado." });
    else toast.error(r.message ?? "No se pudo guardar.");
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      {shown.map((a, i) => (
        <button
          key={`${a.kind}-${a.url}`}
          type="button"
          onClick={(e) => { e.stopPropagation(); setSheet(a); }}
          className={i === 0
            ? "inline-flex items-center justify-center gap-1 rounded-md bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 px-3 py-1.5 text-xs transition"
            : "inline-flex items-center justify-center gap-1 rounded-md border border-border/60 hover:border-primary/40 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-primary transition"}
          title={a.mode === "PROVIDER_SEARCH" ? "Búsqueda en el proveedor: confirma ahí precio y disponibilidad" : undefined}
        >
          {a.label}{a.kind === "equivalent_search" && a.processor && !a.label.includes(a.processor) ? ` · ${a.processor}` : ""} <ExternalLink className="w-3 h-3" />
        </button>
      ))}
      {web.length > max && !more && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setMore(true); }} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
          Más opciones ({web.length - max})
        </button>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {channel && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setComposer(channel.kind); }} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            <MessageCircle className="w-3 h-3" /> {channel.label}
          </button>
        )}
        {maps && (
          <a href={maps.url!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
            <MapPin className="w-3 h-3" /> {maps.label}
          </a>
        )}
        {recheck && (
          <button type="button" onClick={doRecheck} disabled={checking} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
            <RefreshCw className={`w-3 h-3 ${checking ? "animate-spin" : ""}`} /> {checking ? "Comprobando…" : recheck.label}
          </button>
        )}
        {save && tripId && (
          <button type="button" onClick={doSave} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
            <Bookmark className="w-3 h-3" /> {save.label}
          </button>
        )}
      </div>
      {web.length === 0 && !channel && (fallbackInternal ? (
        <a href={fallbackInternal.href} onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 px-3 py-1.5 text-xs transition">
          {fallbackInternal.label}
        </a>
      ) : (
        <p className="text-[11px] text-muted-foreground">No encontramos una forma fiable de reservar en línea esta opción.</p>
      ))}
      {sheet && <BookingSheet open={!!sheet} onOpenChange={(v) => !v && setSheet(null)} offer={o} action={sheet} source={source} tripId={tripId} />}
      {composer && <RequestComposer open={!!composer} onOpenChange={(v) => !v && setComposer(null)} offer={o} source={source} initialKind={composer} tripId={tripId} />}
    </div>
  );
}
