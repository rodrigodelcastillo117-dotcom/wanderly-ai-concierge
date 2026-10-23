// Visor de Recuerdos: pantalla completa con las fotos de un día (o de un álbum). Deslizar o flechas para
// pasar, doble toque / «Acercar» para ampliar (y arrastrar para moverse), ⭐ favorita (el video de
// Wrapped usa primero esas), mover a otro viaje y borrar. Lo que viene de Mejores momentos o del diario
// solo se ve aquí (se edita donde nació); lo que compartió otro miembro del viaje, también.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Loader2, Star, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dateSourceLabel, dayLabel, sourceLabel, type RecuerdoItem, type RecuerdoTrip } from "@/lib/recuerdos/model";

export function RecuerdosViewer({ items, index, onIndex, onClose, urlOf, trips, onFavorite, onMove, onDelete }: {
  items: RecuerdoItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Enlace firmado del archivo completo (o null mientras se pide). */
  urlOf: (it: RecuerdoItem) => string | null;
  trips: RecuerdoTrip[];
  onFavorite: (it: RecuerdoItem, fav: boolean) => Promise<void> | void;
  onMove: (it: RecuerdoItem, tripId: string | null) => Promise<void> | void;
  onDelete: (it: RecuerdoItem) => Promise<boolean> | boolean;
}) {
  const it = items[Math.min(index, items.length - 1)];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const start = useRef<{ x: number; y: number; px: number; py: number; t: number } | null>(null);
  const lastTap = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const count = items.length;

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [index]);
  useEffect(() => { frame.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (confirm) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onIndex(Math.min(count - 1, index + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onIndex(Math.max(0, index - 1)); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [index, count, onIndex, onClose, confirm]);

  if (!it) return null;
  const url = it.legacyUrl ?? urlOf(it);
  const editable = it.source === "recuerdo" && it.mine;
  const origin = sourceLabel(it.source) ?? (!it.mine ? "Compartida por otro miembro del viaje" : null);
  const trip = trips.find((t) => t.id === it.tripId);

  const setZ = (z: number) => { const v = Math.max(1, Math.min(4, z)); setZoom(v); if (v === 1) setPan({ x: 0, y: 0 }); };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-viewer-control]")) return;
    start.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, t: Date.now() };
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || zoom === 1) return;
    setPan({ x: s.px + (e.clientX - s.x), y: s.py + (e.clientY - s.y) });
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (zoom === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { onIndex(dx < 0 ? Math.min(count - 1, index + 1) : Math.max(0, index - 1)); return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      const now = Date.now();
      if (now - lastTap.current < 320 && it.mediaType === "foto") setZ(zoom > 1 ? 1 : 2.5);
      lastTap.current = now;
    }
  };

  const ctrl = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold text-[#F5EBDD] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-[#F5EBDD]" role="dialog" aria-modal="true" aria-label={`Recuerdos del ${dayLabel(it.day)}`} data-testid="recuerdos-viewer">
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{dayLabel(it.day)}{trip ? ` · ${trip.destino ?? "Viaje"}` : ""}</p>
          <p className="truncate text-xs text-[#F5EBDD]/60">{index + 1} de {count} · {dateSourceLabel(it.dateSource)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div ref={frame} tabIndex={-1} className="relative flex-1 touch-none select-none overflow-hidden outline-none"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; }}>
        {!url ? (
          <div className="absolute inset-0 flex items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><span className="sr-only">Cargando</span></div>
        ) : it.mediaType === "video" ? (
          <video key={it.key} src={url} controls playsInline className="absolute inset-0 h-full w-full object-contain" data-viewer-control />
        ) : (
          <img key={it.key} src={url} alt={it.caption || `Foto del ${dayLabel(it.day)}`} draggable={false}
            className="absolute inset-0 h-full w-full object-contain transition-transform duration-150"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />
        )}
        {index > 0 && (
          <button type="button" data-viewer-control onClick={() => onIndex(index - 1)} aria-label="Anterior"
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 md:flex">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {index < count - 1 && (
          <button type="button" data-viewer-control onClick={() => onIndex(index + 1)} aria-label="Siguiente"
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 md:flex">
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="space-y-2 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        {(it.caption || origin) && (
          <p className="text-center text-xs text-[#F5EBDD]/70">{[it.caption, origin].filter(Boolean).join(" · ")}</p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-1">
          {it.mediaType === "foto" && (
            <>
              <button type="button" className={ctrl} onClick={() => setZ(zoom - 0.75)} disabled={zoom <= 1} aria-label="Alejar"><ZoomOut className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className={ctrl} onClick={() => setZ(zoom + 0.75)} disabled={zoom >= 4} aria-label="Acercar"><ZoomIn className="h-4 w-4" aria-hidden="true" /></button>
            </>
          )}
          {editable && (
            <>
              <button type="button" className={ctrl} aria-pressed={it.favorite} onClick={() => onFavorite(it, !it.favorite)}>
                <Star className={`h-4 w-4 ${it.favorite ? "fill-primary text-primary" : ""}`} aria-hidden="true" /> {it.favorite ? "Favorita" : "Marcar favorita"}
              </button>
              <label className="sr-only" htmlFor="recuerdo-move">Mover a otro viaje</label>
              <select id="recuerdo-move" value={it.tripId ?? ""} onChange={(e) => onMove(it, e.target.value || null)}
                className="h-11 max-w-[11rem] rounded-full border border-white/20 bg-black px-3 text-sm text-[#F5EBDD]">
                <option value="">Sin viaje</option>
                {trips.map((t) => <option key={t.id} value={t.id}>{t.destino || "Viaje"}</option>)}
              </select>
              <button type="button" className={`${ctrl} text-red-300`} onClick={() => setConfirm(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Borrar
              </button>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="w-[calc(100%-32px)] rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {it.mediaType === "video" ? "este video" : "esta foto"}?</AlertDialogTitle>
            <AlertDialogDescription>Se borra de Recuerdos para siempre (y de tu resumen de Wrapped). La de tu celular no se toca.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                setDeleting(true);
                const ok = await onDelete(it);
                setDeleting(false);
                setConfirm(false);
                if (ok && count <= 1) onClose();
                else if (ok && index >= count - 1) onIndex(Math.max(0, index - 1));
              }}>
              {deleting ? "Borrando…" : "Borrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
