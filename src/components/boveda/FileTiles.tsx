import { useEffect, useRef, useState } from "react";
import { Camera, FileText, Loader2, Lock, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { signedUrl } from "@/lib/boveda/api";
import { SIDE_LABEL, LIMITS, type VaultFile } from "@/lib/boveda/types";
import { formatBytes } from "@/lib/tripDocuments";

/** Campo oculto que abre la cámara trasera del celular (o el selector de fotos en escritorio). */
export function CaptureInputs({ onFiles, disabled, compact = false }: { onFiles: (files: File[]) => void; disabled?: boolean; compact?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const any = useRef<HTMLInputElement>(null);
  const pick = (list: FileList | null, el: HTMLInputElement | null) => {
    const files = Array.from(list ?? []);
    if (el) el.value = "";
    if (files.length) onFiles(files);
  };
  const base = "flex-1 inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition disabled:opacity-50";
  return (
    <div className="flex gap-2">
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" data-testid="vault-camera-input"
        aria-label="Tomar foto del documento" onChange={(e) => pick(e.target.files, e.currentTarget)} />
      <input ref={any} type="file" accept="image/*,application/pdf" multiple className="hidden" data-testid="vault-file-input"
        aria-label="Subir foto o PDF" onChange={(e) => pick(e.target.files, e.currentTarget)} />
      <button type="button" disabled={disabled} onClick={() => cam.current?.click()}
        className={`${base} ${compact ? "h-10" : "h-11"} border-primary/50 bg-primary/10 text-primary hover:bg-primary/15`}>
        <Camera className="w-4 h-4" aria-hidden="true" /> Tomar foto
      </button>
      <button type="button" disabled={disabled} onClick={() => any.current?.click()}
        className={`${base} ${compact ? "h-10" : "h-11"} border-border bg-surface hover:border-primary/40`}>
        <Upload className="w-4 h-4" aria-hidden="true" /> Foto o PDF
      </button>
    </div>
  );
}

function FileTile({ file, onDelete }: { file: VaultFile; onDelete?: (f: VaultFile) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const isPdf = file.mime === "application/pdf";

  // Al ocultar la pestaña, la foto vuelve a protegerse.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") setUrl(null); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  const reveal = async () => {
    if (isPdf) {
      const win = window.open("", "_blank");
      setBusy(true);
      const u = await signedUrl(file);
      setBusy(false);
      if (!u) { win?.close(); toast.error("No pudimos abrir el PDF."); return; }
      if (win) { try { win.opener = null; } catch { /* no crítico */ } win.location.href = u; } else window.location.href = u;
      return;
    }
    if (url) { setUrl(null); return; }
    setBusy(true);
    const u = await signedUrl(file);
    setBusy(false);
    if (!u) { toast.error("No pudimos mostrar la foto."); return; }
    setUrl(u);
  };

  return (
    <div className="relative rounded-xl overflow-hidden border border-border/60 bg-surface aspect-[4/3]">
      <button type="button" onClick={reveal} className="absolute inset-0 w-full h-full grid place-items-center text-center"
        aria-label={isPdf ? "Abrir PDF" : url ? "Ocultar foto" : `Ver foto (${SIDE_LABEL[file.side]})`}>
        {url ? (
          <img src={url} alt={`Foto del documento (${SIDE_LABEL[file.side]})`} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-2 text-muted-foreground">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : isPdf ? <FileText className="w-5 h-5 text-primary" aria-hidden="true" /> : <Lock className="w-5 h-5 text-primary" aria-hidden="true" />}
            <span className="text-[11px] font-medium text-foreground">{isPdf ? "Abrir PDF" : SIDE_LABEL[file.side]}</span>
            <span className="text-[10px]">{isPdf ? formatBytes(file.size) : "Protegida · toca para ver"}</span>
          </span>
        )}
      </button>
      {onDelete && (
        <button type="button" onClick={() => (confirm ? onDelete(file) : setConfirm(true))} onBlur={() => setConfirm(false)}
          aria-label={confirm ? "Confirmar: borrar archivo" : "Borrar archivo"}
          className={`absolute top-1.5 right-1.5 h-7 rounded-full grid place-items-center text-[10px] font-semibold backdrop-blur ${confirm ? "px-2 bg-destructive text-white" : "w-7 bg-black/60 text-white/80 hover:text-white"}`}>
          {confirm ? "Borrar" : <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

export function FileTiles({ files, onDelete }: { files: VaultFile[]; onDelete?: (f: VaultFile) => void }) {
  if (!files.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {files.map((f) => <FileTile key={f.id} file={f} onDelete={onDelete} />)}
    </div>
  );
}

export const FILES_HINT = `Fotos o PDF de hasta 10 MB (máx. ${LIMITS.filesPerItem} por elemento). Quitamos la ubicación y los datos ocultos de cada foto antes de subirla. Solo tú las ves; los enlaces duran 60 segundos.`;
