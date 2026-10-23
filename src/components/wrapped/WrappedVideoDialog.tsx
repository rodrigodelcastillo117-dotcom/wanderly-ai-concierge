// «Hazme mi video»: crea en el navegador un video vertical 9:16 con tus mejores fotos del año (las
// favoritas ⭐ de Recuerdos primero) y los textos de tu Wrapped. Nada se sube a otro servicio.
// Si el navegador no puede grabar, ofrece la presentación a pantalla completa y explica por qué no se
// puede descargar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Download, Loader2, Play, Share2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadImage } from "@/lib/postcard";
import type { WrappedStats } from "@/lib/wrapped";
import {
  buildVideoPlan, drawVideoFrame, recordSupport, recordVideo, videoFilename, VIDEO_H, VIDEO_W, type RecordSupport,
} from "@/lib/wrappedVideo";

type Phase = { p: "inicio" } | { p: "cargando" } | { p: "grabando"; progress: number } | { p: "listo"; blob: Blob; url: string } | { p: "error"; text: string } | { p: "presentacion" };

export type VideoEnv = {
  support?: RecordSupport;
  /** Para pruebas: el constructor de MediaRecorder. */
  MediaRecorder?: unknown;
  loadImg?: (url: string) => Promise<CanvasImageSource | null>;
};

export function WrappedVideoDialog({ open, onOpenChange, stats, env = {} }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stats: WrappedStats;
  env?: VideoEnv;
}) {
  const plan = useMemo(() => buildVideoPlan(stats), [stats]);
  const support = useMemo(() => env.support ?? recordSupport(), [env.support]);
  const unsupportedReason = "reason" in support ? support.reason : null;
  const supportMime = "mime" in support ? support.mime : "video/webm";
  const [phase, setPhase] = useState<Phase>({ p: "inicio" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imgs = useRef<Array<CanvasImageSource | null>>([]);
  const favorites = stats.photos.filter((p) => p.favorite).length;
  const usedPhotos = plan.scenes.filter((s) => s.kind === "photo").length;

  // Al cerrar: se cancela lo que esté en curso y se libera el video.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    setPhase((ph) => { if (ph.p === "listo") URL.revokeObjectURL(ph.url); return { p: "inicio" }; });
  }, [open]);

  const loadImg = env.loadImg;
  const loadAll = useCallback(async () => {
    const load = loadImg ?? ((u: string) => loadImage(u, 10000));
    imgs.current = await Promise.all(plan.photos.map((u) => load(u).catch(() => null)));
  }, [plan, loadImg]);

  const start = async () => {
    if (!support.ok) { setPhase({ p: "presentacion" }); return; }
    setPhase({ p: "cargando" });
    await loadAll();
    const canvas = canvasRef.current;
    if (!canvas) { setPhase({ p: "error", text: "No pudimos preparar el video." }); return; }
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ p: "grabando", progress: 0 });
    try {
      const MR = (env.MediaRecorder ?? (globalThis as { MediaRecorder?: unknown }).MediaRecorder) as Parameters<typeof recordVideo>[2]["MediaRecorder"];
      const blob = await recordVideo(plan, imgs.current, {
        canvas, MediaRecorder: MR, mime: supportMime, signal: ac.signal,
        onProgress: (p) => setPhase((ph) => (ph.p === "grabando" ? { p: "grabando", progress: p } : ph)),
      });
      setPhase({ p: "listo", blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      if ((e as Error).message === "cancelado") return;
      setPhase({ p: "error", text: "No pudimos grabar el video en este navegador. Puedes ver la presentación a pantalla completa." });
    }
  };

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = videoFilename(stats.year, blob.type || supportMime); a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean }) : null;
  const shareFile = (blob: Blob) => new File([blob], videoFilename(stats.year, blob.type || "video/webm"), { type: blob.type || "video/webm" });
  const canShare = (blob: Blob) => { try { return !!nav?.share && !!nav.canShare?.({ files: [shareFile(blob)] }); } catch { return false; } };
  const share = async (blob: Blob) => {
    try { await nav!.share({ files: [shareFile(blob)], title: `Mi ${stats.year} en viajes`, text: `Mi ${stats.year} en viajes con IATOS` }); }
    catch (e) { if ((e as { name?: string })?.name !== "AbortError") download(blob); }
  };

  const closeSlideshow = useCallback(() => { setPhase({ p: "inicio" }); onOpenChange(false); }, [onOpenChange]);
  const gold = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] px-5 text-sm font-bold text-[#0A0A0A] disabled:opacity-60";
  const outline = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-primary/40 px-5 text-sm font-bold text-primary";
  const recording = phase.p === "grabando" || phase.p === "cargando";

  return (
    <>
      <Dialog open={open && phase.p !== "presentacion"} onOpenChange={(o) => { if (!o && recording) abortRef.current?.abort(); onOpenChange(o); }}>
        <DialogContent className="w-[calc(100%-32px)] max-w-sm rounded-3xl border-primary/25 bg-[#0d0b08] sm:rounded-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Hazme mi video</DialogTitle>
            <DialogDescription>
              Un video vertical de {Math.round(plan.total)} segundos con {usedPhotos ? `${usedPhotos} de tus fotos` : "los datos de tu año"} y tus tarjetas del Wrapped. Se crea en tu dispositivo: tus fotos no se suben a ningún lado.
            </DialogDescription>
          </DialogHeader>

          <div className={`mx-auto w-40 overflow-hidden rounded-2xl ring-1 ring-primary/30 ${phase.p === "grabando" ? "" : "hidden"}`} aria-hidden="true">
            <canvas ref={canvasRef} width={VIDEO_W} height={VIDEO_H} className="block h-auto w-full" />
          </div>

          {phase.p === "inicio" && (
            <div className="space-y-3">
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>{favorites ? `Empieza con tus ${favorites} ${favorites === 1 ? "favorita" : "favoritas"} ⭐ de Recuerdos.` : "Tip: marca tus favoritas ⭐ en Recuerdos y el video empezará con ellas."}</li>
                <li>Sin música: aún no tenemos una pista con licencia clara para incluirla.</li>
                {unsupportedReason && <li className="text-amber-300">{unsupportedReason} Puedes ver la presentación aquí, pero no descargarla. Para descargarla, abre IATOS en Chrome, Edge, Firefox o Safari recientes.</li>}
              </ul>
              <button type="button" className={gold} onClick={() => void start()} style={{ width: "100%" }}>
                {support.ok ? <><Clapperboard className="h-4 w-4" aria-hidden="true" /> Crear mi video</> : <><Play className="h-4 w-4" aria-hidden="true" /> Ver presentación</>}
              </button>
            </div>
          )}
          {phase.p === "cargando" && <p role="status" className="flex items-center justify-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparando tus fotos…</p>}
          {phase.p === "grabando" && (
            <div className="space-y-2" role="status" aria-live="polite">
              <p className="text-center text-sm">Creando tu video… {Math.round(phase.progress * 100)} %</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(phase.progress * 100)}%` }} /></div>
              <p className="text-center text-xs text-muted-foreground">Tarda lo mismo que dura el video. Deja esta pantalla abierta.</p>
            </div>
          )}
          {phase.p === "listo" && (
            <div className="space-y-3">
              <video src={phase.url} controls playsInline className="mx-auto max-h-[45dvh] rounded-2xl" data-testid="wrapped-video-result" />
              <div className="flex flex-col gap-2">
                {canShare(phase.blob) && <button type="button" className={gold} onClick={() => void share(phase.blob)}><Share2 className="h-4 w-4" aria-hidden="true" /> Compartir</button>}
                <button type="button" className={canShare(phase.blob) ? outline : gold} onClick={() => download(phase.blob)}><Download className="h-4 w-4" aria-hidden="true" /> Descargar</button>
              </div>
            </div>
          )}
          {phase.p === "error" && (
            <div className="space-y-3" role="alert">
              <p className="text-sm">{phase.text}</p>
              <button type="button" className={gold} style={{ width: "100%" }} onClick={() => setPhase({ p: "presentacion" })}><Play className="h-4 w-4" aria-hidden="true" /> Ver presentación</button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {open && phase.p === "presentacion" && (
        <Slideshow plan={plan} loadAll={loadAll} images={imgs} reason={unsupportedReason}
          onClose={closeSlideshow} />
      )}
    </>
  );
}

/** Presentación a pantalla completa (mismo dibujo que el video, en vivo y en bucle). */
function Slideshow({ plan, loadAll, images, reason, onClose }: {
  plan: ReturnType<typeof buildVideoPlan>;
  loadAll: () => Promise<void>;
  images: React.MutableRefObject<Array<CanvasImageSource | null>>;
  reason: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    void loadAll().then(() => {
      if (stopped) return;
      const t0 = performance.now();
      const tick = (now: number) => {
        if (stopped) return;
        drawVideoFrame(ctx, plan, ((now - t0) / 1000) % plan.total, images.current as never);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { stopped = true; cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); };
  }, [plan, loadAll, images, onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label="Presentación de tu año" data-testid="wrapped-slideshow">
      <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-[#F5EBDD] hover:bg-white/10">
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      <canvas ref={ref} width={VIDEO_W} height={VIDEO_H} className="h-[calc(100dvh-72px)] max-w-full object-contain" style={{ aspectRatio: "9 / 16" }} />
      {reason && <p className="px-4 py-2 text-center text-xs text-[#F5EBDD]/70">{reason} Por eso no se puede descargar; aquí puedes verla completa.</p>}
    </div>
  );
}
