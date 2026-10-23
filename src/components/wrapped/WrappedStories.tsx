// Reproductor tipo "stories" de IATOS Wrapped, fácil y fluido: «Anterior», «Pausa» y «Siguiente» siempre
// visibles (además de tocar a los lados y mantener presionado para pausar), ← → y espacio en escritorio,
// Esc para salir. Avanza solo cada 8 s (salvo con "reducir movimiento"). Cada tarjeta se comparte como
// imagen («Compartir»); por defecto SIN fotos ni avatar.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Pause, Play, Share2, X, Download, Loader2, Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { WrappedCardView } from "@/components/wrapped/WrappedCardView";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { buildCardSpec, cardFilename, cardHasPhotos, stepIndex, type WrappedCardKind, type WrappedStats } from "@/lib/wrapped";
import type { ShareOutcome } from "@/lib/postcard";
import { WrappedVideoDialog } from "@/components/wrapped/WrappedVideoDialog";

// Ritmo cómodo (más de 6 s por tarjeta); se puede pausar con el botón «Pausa».
export const STORY_MS = 8000;
const HOLD_MS = 220;

export type ShareFn = (args: { kind: WrappedCardKind; index: number; includePhotos: boolean; download: boolean }) => Promise<ShareOutcome>;

async function defaultShare(stats: WrappedStats, { kind, index, includePhotos, download }: Parameters<ShareFn>[0]): Promise<ShareOutcome> {
  const { shareCardImage } = await import("@/lib/wrappedShare");
  return shareCardImage(buildCardSpec(kind, stats, { includePhotos }), stats.year, cardFilename(kind, index, stats.year), download);
}

export function WrappedStories({ stats, cards, onClose, onShare, initialIndex = 0, autoplay, otherYears = [], openVideo = false }: {
  stats: WrappedStats;
  /** Otros años con viajes (enlaces en la tarjeta de cierre). */
  otherYears?: number[];
  cards: WrappedCardKind[];
  onClose: () => void;
  onShare?: ShareFn;
  initialIndex?: number;
  /** Por defecto: avanza solo salvo que el sistema pida reducir movimiento. */
  autoplay?: boolean;
  /** Abrir de entrada «Hazme mi video» (enlace desde Recuerdos: /wrapped?video=1). */
  openVideo?: boolean;
}) {
  const reduce = usePrefersReducedMotion();
  const auto = autoplay ?? !reduce;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, cards.length - 1)));
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [progress, setProgress] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [includePhotos, setIncludePhotos] = useState(false);
  const [sharing, setSharing] = useState<null | "share" | "download">(null);
  const [shareDone, setShareDone] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(openVideo);
  const holdTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; t: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const count = cards.length;
  const kind = cards[index];
  const spec = useMemo(() => buildCardSpec(kind, stats, { includePhotos: true }), [kind, stats]);
  const running = auto && !paused && !held && !shareOpen && !videoOpen;
  const canNativeShare = typeof navigator !== "undefined" && typeof (navigator as Navigator & { canShare?: unknown }).canShare === "function" && typeof navigator.share === "function";

  const go = useCallback((dir: 1 | -1) => {
    setIndex((i) => stepIndex(i, count, dir));
  }, [count]);

  // Avance automático (el progreso vive en un ref: nada de efectos dentro de un setState).
  const progressRef = useRef(0);
  useEffect(() => { progressRef.current = 0; setProgress(0); }, [index]);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      const next = Math.min(1, progressRef.current + dt / STORY_MS);
      progressRef.current = next;
      setProgress(next);
      if (next >= 1) {
        if (index < count - 1) setIndex(stepIndex(index, count, 1));
        return; // en la última tarjeta se queda quieta
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, index, count]);

  // Pestaña oculta: pausa.
  useEffect(() => {
    const on = () => { if (document.hidden) setPaused(true); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // Teclado.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // Con el diálogo de compartir abierto, Esc lo cierra a él (no sale de las stories).
      if (shareOpen || videoOpen || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.("[role=dialog]") || document.querySelector("[role=dialog]")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === " " && !(e.target as HTMLElement | null)?.closest?.("button, a, input")) { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [go, onClose, shareOpen, videoOpen]);

  useEffect(() => { frameRef.current?.focus({ preventScroll: true }); }, []);

  const isControl = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("[data-story-control]");
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (isControl(e.target) || e.button > 0) return;
    pressStart.current = { x: e.clientX, t: Date.now() };
    holdTimer.current = window.setTimeout(() => setHeld(true), HOLD_MS);
  };
  const endPress = (e: RPointerEvent<HTMLDivElement>, cancel = false) => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const start = pressStart.current;
    pressStart.current = null;
    if (held) { setHeld(false); return; }
    if (!start || cancel || isControl(e.target)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (start.x - rect.left) / Math.max(1, rect.width);
    go(x < 0.3 ? -1 : 1);
  };

  const doShare = async (download: boolean) => {
    setSharing(download ? "download" : "share");
    setShareDone(null);
    try {
      const out = await (onShare ?? ((a) => defaultShare(stats, a)))({ kind, index, includePhotos: includePhotos && cardHasPhotos(kind, stats), download });
      if (out === "downloaded") setShareDone("Listo: la imagen se guardó en tus descargas.");
      else if (out === "shared") setShareOpen(false);
      else if (out === "failed") toast.error("No pudimos crear la imagen. Intenta de nuevo.");
    } finally {
      setSharing(null);
    }
  };

  // Cada vez que se abre, «Incluir mis fotos» empieza APAGADO: compartir fotos siempre es a propósito.
  const openShare = () => { setIncludePhotos(false); setShareDone(null); setShareOpen(true); };

  const photosHere = cardHasPhotos(kind, stats);
  const ctrl = "inline-flex min-h-11 items-center justify-center gap-1 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" data-testid="wrapped-stories">
      <div
        ref={frameRef}
        tabIndex={-1}
        role="region"
        aria-roledescription="historia"
        aria-label={`Tu ${stats.year} en viajes`}
        className="relative h-[100dvh] w-full overflow-hidden outline-none md:h-[min(calc(100dvh-48px),900px)] md:w-auto md:aspect-[9/16] md:rounded-[28px] md:ring-1 md:ring-primary/25 md:shadow-[0_30px_120px_-30px_rgba(201,169,97,0.35)] touch-manipulation"
        style={{ containerType: "size" }}
        onPointerDown={onPointerDown}
        onPointerUp={(e) => endPress(e)}
        onPointerCancel={(e) => endPress(e, true)}
        onPointerLeave={(e) => { if (pressStart.current) endPress(e, true); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="h-full w-full" style={{ ["--u" as string]: "min(1cqw, 0.5625cqh)" }}>
          <WrappedCardView key={index} spec={spec} year={stats.year} still={reduce} index={index} total={count}
            reserveBottom={`calc(${otherYears.length && kind === "outro" ? 116 : 76}px + env(safe-area-inset-bottom))`} />

          {/* Barra de progreso */}
          <div className="absolute inset-x-0 top-0 z-10 flex gap-1 px-3 pt-[max(12px,env(safe-area-inset-top))]" aria-hidden="true">
            {cards.map((c, k) => (
              <div key={c + k} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-[#E8D5A0]" data-testid={`wrapped-progress-${k}`}
                  style={{ width: k < index ? "100%" : k > index ? "0%" : `${auto ? Math.round(progress * 100) : 100}%` }} />
              </div>
            ))}
          </div>

          {/* Arriba: compartir y salir */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-end gap-1 px-2 pt-[max(22px,calc(env(safe-area-inset-top)+10px))]">
            <p className="sr-only" aria-live="polite">Tarjeta {index + 1} de {count}</p>
            <button type="button" data-story-control onClick={() => setVideoOpen(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-primary/50 bg-black/50 px-3.5 text-sm font-semibold text-primary backdrop-blur hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <Clapperboard className="h-4 w-4" aria-hidden="true" /> Video
            </button>
            <button type="button" data-story-control onClick={openShare}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-primary/50 bg-black/50 px-3.5 text-sm font-semibold text-primary backdrop-blur hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <Share2 className="h-4 w-4" aria-hidden="true" /> Compartir
            </button>
            <button type="button" data-story-control onClick={onClose} aria-label="Cerrar"
              className="flex h-11 w-11 items-center justify-center rounded-full text-[#F5EBDD] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Abajo: anterior, pausa y siguiente siempre visibles (además de tocar a los lados) */}
          <div data-story-control className="absolute inset-x-0 bottom-0 z-20 cursor-default bg-gradient-to-t from-black/80 to-transparent px-4 pt-6 pb-[max(14px,calc(env(safe-area-inset-bottom)+8px))]">
            {kind === "outro" && otherYears.length > 0 && (
              <nav aria-label="Otros años" className="mb-2 flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs text-[#F5EBDD]/60">Ver otro año:</span>
                {otherYears.slice(0, 4).map((y) => (
                  <Link key={y} to={`/wrapped/${y}`} className="inline-flex min-h-9 items-center rounded-full border border-white/20 px-3 text-xs font-semibold text-[#F5EBDD] hover:border-primary/60">{y}</Link>
                ))}
              </nav>
            )}
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => go(-1)} disabled={index === 0} className={`${ctrl} pl-2 pr-3.5 text-[#F5EBDD]/85 hover:bg-white/10`}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
              </button>
              {auto ? (
                <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused}
                  className={`${ctrl} px-3.5 text-[#F5EBDD]/85 hover:bg-white/10`}>
                  {paused || held ? <><Play className="h-4 w-4" aria-hidden="true" /> Seguir</> : <><Pause className="h-4 w-4" aria-hidden="true" /> Pausa</>}
                </button>
              ) : (
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#F5EBDD]/50">{index + 1} / {count}</span>
              )}
              <button type="button" onClick={() => go(1)} disabled={index >= count - 1} className={`${ctrl} pl-3.5 pr-2 text-primary hover:bg-primary/10`}>
                Siguiente <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <WrappedVideoDialog open={videoOpen} onOpenChange={setVideoOpen} stats={stats} />

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="w-[calc(100%-32px)] max-w-sm rounded-3xl border-primary/25 bg-[#0d0b08] sm:rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Compartir esta tarjeta</DialogTitle>
            <DialogDescription>Se crea una imagen vertical lista para tus historias.</DialogDescription>
          </DialogHeader>
          {photosHere ? (
            <div className="rounded-2xl border border-white/10 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="wrapped-include-photos" className="text-sm font-semibold">Incluir mis fotos</label>
                <Switch id="wrapped-include-photos" checked={includePhotos} onCheckedChange={setIncludePhotos} />
              </div>
              <p className="text-xs text-muted-foreground" data-testid="wrapped-photos-note">
                {includePhotos
                  ? "La imagen llevará las fotos que ves en esta tarjeta."
                  : "Tus fotos y tu avatar son privados: no se incluyen en la imagen."}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Esta tarjeta no lleva fotos.</p>
          )}
          <div className="flex flex-col gap-2">
            {canNativeShare && (
              <button type="button" onClick={() => doShare(false)} disabled={!!sharing}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] px-5 text-sm font-bold text-[#0A0A0A] disabled:opacity-60">
                {sharing === "share" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-5 w-5" aria-hidden="true" />} Compartir imagen
              </button>
            )}
            <button type="button" onClick={() => doShare(true)} disabled={!!sharing}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold disabled:opacity-60 ${canNativeShare ? "border border-primary/40 text-primary" : "bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] text-[#0A0A0A]"}`}>
              {sharing === "download" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} Descargar imagen
            </button>
            {shareDone && <p role="status" className="flex items-center justify-center gap-1.5 text-sm text-primary"><Check className="h-4 w-4" aria-hidden="true" /> {shareDone}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
