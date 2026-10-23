// Subir a Recuerdos: varias fotos y videos cortos a la vez, desde el celular o la computadora (con
// arrastrar y soltar en escritorio) o con la cámara. Cada archivo se prepara en el dispositivo (fecha
// del EXIF, reducido, comprimido y sin EXIF/GPS) y se le asigna el viaje por su fecha, salvo que la
// persona elija uno a mano.
import { useCallback, useRef, useState, type DragEvent } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, UploadCloud, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCameraCapture } from "@/components/camera/CameraCapture";
import { prepareRecuerdo, RECUERDO_ACCEPT, RECUERDO_LIMITS_TEXT, type PrepareDeps } from "@/lib/recuerdos/prepare";
import { uploadRecuerdo, type RecuerdosClient } from "@/lib/recuerdos/api";
import { tripForDate, type RecuerdoRow, type RecuerdoTrip } from "@/lib/recuerdos/model";

type Job = { id: number; name: string; status: "preparando" | "subiendo" | "listo" | "error"; message?: string; trip?: string | null };

export type UploadSummary = { ok: number; failed: number; byTrip: number };

export function RecuerdosUploader({ client, userId, trips, onUploaded, onDone, prepareDeps, isMobile }: {
  client: RecuerdosClient;
  userId: string;
  trips: RecuerdoTrip[];
  onUploaded: (row: RecuerdoRow) => void;
  onDone?: (s: UploadSummary) => void;
  prepareDeps?: PrepareDeps;
  isMobile?: boolean;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [choice, setChoice] = useState<string>("auto");
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const update = (id: number, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const run = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const list = files.map((f) => ({ file: f, job: { id: ++seq.current, name: f.name || "foto", status: "preparando" as const } }));
    setJobs((js) => [...list.map((l) => l.job), ...js].slice(0, 60));
    setBusy(true);
    let ok = 0, failed = 0, byTrip = 0;
    // De dos en dos: rápido sin saturar la memoria del celular.
    const queue = [...list];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { file, job } = next;
        try {
          const p = await prepareRecuerdo(file, prepareDeps);
          const auto = choice === "auto";
          const tripId = auto ? tripForDate(p.takenOn, trips) : choice === "ninguno" ? null : choice;
          update(job.id, { status: "subiendo" });
          const r = await uploadRecuerdo(client, userId, p, { id: tripId, source: auto ? "fecha" : "manual" });
          if ("error" in r) throw new Error(r.error);
          ok++;
          if (tripId && auto) byTrip++;
          const t = trips.find((x) => x.id === tripId);
          update(job.id, { status: "listo", trip: t?.destino ?? null });
          onUploaded(r.row);
        } catch (e) {
          failed++;
          update(job.id, { status: "error", message: (e as Error).message || "No se pudo subir." });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setBusy(false);
    onDone?.({ ok, failed, byTrip });
  }, [client, userId, trips, choice, onUploaded, onDone, prepareDeps]);

  const camera = useCameraCapture({
    facing: "environment", inputRef: camRef, title: "Tomar una foto", isMobile,
    onFile: (f) => void run([f]), onPickGallery: () => fileRef.current?.click(),
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void run(Array.from(e.dataTransfer?.files ?? []));
  };

  const active = jobs.filter((j) => j.status === "preparando" || j.status === "subiendo").length;
  return (
    <section aria-label="Subir fotos y videos" className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        data-testid="recuerdos-dropzone"
        className={`rounded-2xl border-2 border-dashed p-5 md:p-6 transition-colors ${drag ? "border-primary bg-primary/10" : "border-primary/35 bg-surface/50"}`}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <UploadCloud className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-display text-lg leading-tight">Sube tus fotos y videos</p>
              <p className="text-sm text-muted-foreground">
                <span className="hidden md:inline">Arrástralos aquí o elígelos. </span>Se ordenan solos por fecha y viaje; antes de subir les quitamos la ubicación.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{RECUERDO_LIMITS_TEXT}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
            <Button type="button" onClick={() => fileRef.current?.click()} className="h-11 bg-gradient-gold text-primary-foreground">
              <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" /> Elegir fotos y videos
            </Button>
            <Button type="button" variant="outline" onClick={camera.openCamera} className="h-11">
              <Camera className="mr-2 h-4 w-4" aria-hidden="true" /> Tomar foto
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="recuerdos-trip-choice" className="text-muted-foreground">Viaje:</label>
          <select id="recuerdos-trip-choice" value={choice} onChange={(e) => setChoice(e.target.value)}
            className="h-10 min-w-0 max-w-full rounded-full border border-border bg-background px-3 text-sm">
            <option value="auto">Automático, por la fecha de cada foto</option>
            <option value="ninguno">Sin viaje</option>
            {trips.map((t) => <option key={t.id} value={t.id}>{t.destino || "Viaje"}</option>)}
          </select>
        </div>
        <input ref={fileRef} type="file" multiple accept={RECUERDO_ACCEPT} className="hidden" aria-label="Elegir fotos y videos"
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void run(fs); }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Tomar foto con la cámara"
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void run(fs); }} />
        {camera.dialog}
      </div>

      {jobs.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface/40 p-3" aria-live="polite">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" /> Subiendo {active} de {jobs.length}…</> : "Listo"}
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2">
                {j.status === "listo" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  : j.status === "error" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 truncate">{j.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {j.status === "preparando" ? "Preparando…" : j.status === "subiendo" ? "Subiendo…" : j.status === "listo" ? (j.trip ? `En ${j.trip}` : "Guardada") : j.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
