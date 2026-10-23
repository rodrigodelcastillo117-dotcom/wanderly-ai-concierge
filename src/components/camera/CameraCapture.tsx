// Cámara reutilizable (Travel Avatar, Recuerdos y, si se quiere, el escaneo de tickets de gastos).
//   · En el celular o la tableta: el <input type="file" capture> de siempre (abre la cámara del sistema,
//     que ya funciona bien).
//   · En la computadora: `capture` no hace nada y se abría el selector de archivos. Ahora se abre un
//     diálogo con la cámara en vivo (getUserMedia): «Tomar foto», «Repetir» y «Usar esta foto». Si no
//     hay cámara o se niega el permiso, se dice claramente y se ofrece «Elegir de mi galería».
// La foto se entrega como File JPEG; quien la recibe decide qué hacer (validar, limpiar, subir).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Camera, ImageIcon, Loader2, RefreshCw, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type Facing = "user" | "environment";

type Nav = { userAgent?: string; maxTouchPoints?: number; platform?: string; userAgentData?: { mobile?: boolean }; mediaDevices?: { getUserMedia?: unknown } };

/** ¿Celular o tableta? Ahí `input capture` abre la cámara del sistema. */
export function isMobileCaptureDevice(nav: Nav | undefined = typeof navigator !== "undefined" ? (navigator as unknown as Nav) : undefined): boolean {
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPad con iPadOS se presenta como Mac de escritorio, pero tiene pantalla táctil.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export function cameraApiAvailable(nav: Nav | undefined = typeof navigator !== "undefined" ? (navigator as unknown as Nav) : undefined): boolean {
  return typeof nav?.mediaDevices?.getUserMedia === "function";
}

export type CameraError = "sin_soporte" | "permiso" | "sin_camara" | "ocupada" | "otro";

export function cameraErrorKind(e: unknown): CameraError {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "permiso";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "sin_camara";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "ocupada";
  return "otro";
}

export const CAMERA_ERROR_TEXT: Record<CameraError, string> = {
  sin_soporte: "Este navegador no puede usar la cámara desde la página.",
  permiso: "No diste permiso para usar la cámara. Puedes activarlo en el candado junto a la dirección de la página, o elegir una foto que ya tengas.",
  sin_camara: "No encontramos una cámara en esta computadora.",
  ocupada: "La cámara está ocupada por otra aplicación. Ciérrala e intenta de nuevo.",
  otro: "No pudimos abrir la cámara.",
};

type State = { s: "iniciando" } | { s: "en_vivo" } | { s: "tomada"; url: string; file: File } | { s: "error"; kind: CameraError };

export function CameraDialog({ open, onOpenChange, facing = "user", title = "Tomar una foto", onCapture, onPickGallery, getUserMedia }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facing?: Facing;
  title?: string;
  onCapture: (file: File) => void;
  /** «Elegir de mi galería» (cuando no hay cámara o no hay permiso). */
  onPickGallery?: () => void;
  /** Para pruebas; por defecto navigator.mediaDevices.getUserMedia. */
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
}) {
  const [state, setState] = useState<State>({ s: "iniciando" });
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) { stop(); return; }
    let cancelled = false;
    const gum = getUserMedia ?? (cameraApiAvailable() ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c) : null);
    if (!gum) { setState({ s: "error", kind: "sin_soporte" }); return; }
    setState({ s: "iniciando" });
    gum({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play?.()?.catch?.(() => {});
        }
        setState({ s: "en_vivo" });
      })
      .catch((e) => { if (!cancelled) setState({ s: "error", kind: cameraErrorKind(e) }); });
    return () => { cancelled = true; stop(); };
  }, [open, facing, attempt, getUserMedia, stop]);

  // El enlace de la vista previa se libera al repetir o cerrar.
  useEffect(() => () => { if (state.s === "tomada") URL.revokeObjectURL(state.url); }, [state]);

  // Al volver a "en vivo" el <video> se monta otra vez: se le vuelve a dar la cámara.
  useEffect(() => {
    if (state.s === "en_vivo" && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play?.()?.catch?.(() => {});
    }
  }, [state.s]);

  const shoot = () => {
    const v = videoRef.current;
    const w = v?.videoWidth || 0, h = v?.videoHeight || 0;
    if (!v || !w || !h) return;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    c.toBlob((b) => {
      if (!b) return;
      const file = new File([b], `foto-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      setState({ s: "tomada", url: URL.createObjectURL(b), file });
    }, "image/jpeg", 0.92);
  };

  const use = () => {
    if (state.s !== "tomada") return;
    onCapture(state.file);
    onOpenChange(false);
  };

  const mirror = facing === "user";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-32px)] max-w-lg rounded-3xl sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{title}</DialogTitle>
          <DialogDescription>
            {state.s === "error" ? "No se pudo usar la cámara." : "La foto solo se usa aquí; no se guarda en ningún otro lado sin que tú lo decidas."}
          </DialogDescription>
        </DialogHeader>
        {state.s === "error" ? (
          <div className="space-y-4" role="alert">
            <p className="text-sm">{CAMERA_ERROR_TEXT[state.kind]}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {onPickGallery && (
                <Button type="button" className="h-11 bg-gradient-gold text-primary-foreground" onClick={() => { onOpenChange(false); onPickGallery(); }}>
                  <ImageIcon className="mr-2 h-4 w-4" aria-hidden="true" /> Elegir de mi galería
                </Button>
              )}
              {state.kind !== "sin_soporte" && state.kind !== "sin_camara" && (
                <Button type="button" variant="outline" className="h-11" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Intentar de nuevo
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
              {state.s === "tomada" ? (
                <img src={state.url} alt="Foto tomada" className="h-full w-full object-cover" />
              ) : (
                <video ref={videoRef} autoPlay playsInline muted aria-label="Vista previa de la cámara" data-testid="camera-preview"
                  className="h-full w-full object-cover" style={mirror ? { transform: "scaleX(-1)" } : undefined} />
              )}
              {state.s === "iniciando" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80" role="status">
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> Abriendo la cámara…
                </div>
              )}
            </div>
            {state.s === "tomada" ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button type="button" variant="outline" className="h-11" onClick={() => { URL.revokeObjectURL(state.url); setState({ s: "en_vivo" }); }}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Repetir
                </Button>
                <Button type="button" className="h-11 bg-gradient-gold text-primary-foreground" onClick={use}>
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" /> Usar esta foto
                </Button>
              </div>
            ) : (
              <div className="flex justify-center">
                <Button type="button" className="h-12 rounded-full bg-gradient-gold px-8 text-primary-foreground" onClick={shoot} disabled={state.s !== "en_vivo"}>
                  <Camera className="mr-2 h-5 w-5" aria-hidden="true" /> Tomar foto
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Botón "Tomar una foto" para cualquier pantalla: en celular dispara el input con `capture`; en la
 * computadora abre CameraDialog. Devuelve `open()` y el diálogo para renderizarlo.
 */
export function useCameraCapture({ facing = "user", inputRef, onFile, onPickGallery, title, isMobile }: {
  facing?: Facing;
  /** El <input type="file" capture> que ya usa la pantalla (celular). */
  inputRef: RefObject<HTMLInputElement>;
  onFile: (file: File) => void;
  onPickGallery?: () => void;
  title?: string;
  /** Para pruebas. */
  isMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mobile = isMobile ?? isMobileCaptureDevice();
  const openCamera = useCallback(() => {
    if (mobile) inputRef.current?.click();
    else setOpen(true);
  }, [mobile, inputRef]);
  const dialog = (
    <CameraDialog open={open} onOpenChange={setOpen} facing={facing} title={title} onCapture={onFile} onPickGallery={onPickGallery} />
  );
  return { openCamera, dialog };
}
