import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp, FileText, Loader2, Lock, Plane, BedDouble, Trash2, Check, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { localISODate } from "@/lib/localDate";
import { buildDocPath, formatBytes, TRIP_DOC_BUCKET } from "@/lib/tripDocuments";
import { notifyAvatarUpdated } from "@/hooks/useMyAvatar";
import {
  buildImportPayload, docKindFor, draftFromParse, formatPaid, IMPORT_MAX_BYTES, IMPORT_MAX_FILES, IMPORT_TYPES,
  isPastTrip, NO_PRICE_LABEL, PAID_LABEL, paidTotals, validateDraft, type ImportDraft,
} from "@/lib/tripImport";

type Step = "subir" | "leyendo" | "revisar" | "guardando" | "listo" | "duplicado";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function readError(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: { clone?: () => { json: () => Promise<any> } } })?.context;
    const body = ctx?.clone ? await ctx.clone().json() : null;
    return typeof body?.error === "string" ? body.error : fallback;
  } catch { return fallback; }
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
    {children}
  </label>
);

const PriceField = ({ value, moneda, perPerson, onChange, label }: {
  value: number | null; moneda: string; perPerson?: number | null; onChange: (v: number | null) => void; label: string;
}) => (
  <div className="space-y-1">
    <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      <Input
        inputMode="decimal"
        aria-label={`${label} en ${moneda}`}
        value={value === null ? "" : String(value)}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          onChange(raw === "" ? null : Number(raw));
        }}
        className="h-10 bg-input"
      />
      <span className="text-xs text-muted-foreground w-10 shrink-0">{moneda}</span>
    </div>
    <p className={`text-[11px] ${value === null ? "text-muted-foreground" : "text-primary"}`}>
      {value === null
        ? perPerson ? `${NO_PRICE_LABEL} el total · ${formatPaid(perPerson, moneda)} por persona` : NO_PRICE_LABEL
        : PAID_LABEL}
    </p>
  </div>
);

const ImportPastTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<Step>("subir");
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [result, setResult] = useState<{ tripId: string; pasado: boolean; souvenir?: { nombre: string; lugar: string; emoji: string } | null; docsFailed?: number } | null>(null);
  const [dupTrip, setDupTrip] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!IMPORT_TYPES.includes((f.type || "").toLowerCase())) { toast.error(`${f.name}: sube PDF o imágenes (JPG, PNG, WEBP, HEIC).`); continue; }
      if (f.size > IMPORT_MAX_BYTES) { toast.error(`${f.name} pesa más de 10 MB.`); continue; }
      if (next.length >= IMPORT_MAX_FILES) { toast.error(`Máximo ${IMPORT_MAX_FILES} archivos por viaje.`); break; }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  };

  const read = async () => {
    if (!files.length) return;
    setStep("leyendo");
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type, data_base64: await fileToBase64(f) })));
      const { data, error } = await supabase.functions.invoke("parse-trip-file", { body: { files: payload, modo: "importar" } });
      if (error) throw new Error(await readError(error, "No pudimos leer tus documentos. Intenta de nuevo."));
      if (!data?.ok) throw new Error(data?.error ?? "No pudimos leer tus documentos.");
      setDraft(draftFromParse(data));
      setStep("revisar");
    } catch (e) {
      toast.error((e as Error).message);
      setStep("subir");
    }
  };

  const patch = (p: Partial<ImportDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft || !user) return;
    const errs = validateDraft(draft);
    if (errs.length) { toast.error(errs[0]); return; }
    setStep("guardando");
    const today = localISODate();
    try {
      const { p_trip, p_refs } = buildImportPayload(draft, { archivos: files.length, today });
      const { data, error } = await (supabase as any).rpc("import_past_trip", { p_trip, p_refs });
      if (error) throw new Error("No pudimos guardar el viaje. Intenta de nuevo.");
      if (data?.code === "duplicado") { setDupTrip(String(data.trip_id)); setStep("duplicado"); return; }
      if (!data?.ok) throw new Error(data?.campo ? `Revisa: ${data.campo}.` : "No pudimos guardar el viaje.");
      const tripId = String(data.trip_id);

      // Los documentos originales se guardan en PRIVADO dentro del viaje (trip-documents).
      let docsFailed = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const path = buildDocPath(tripId, newId(), f.name);
        const up = await supabase.storage.from(TRIP_DOC_BUCKET).upload(path, f, { contentType: f.type, upsert: false });
        if (up.error) { docsFailed++; continue; }
        const kind = docKindFor(draft.documentos.find((d) => d.archivo === i)?.tipo);
        const { error: rowErr } = await supabase.from("trip_documents").insert({
          trip_id: tripId, uploaded_by: user.id, kind, storage_path: path, filename: f.name.slice(0, 200), mime: f.type, size: f.size,
        });
        if (rowErr) { docsFailed++; await supabase.storage.from(TRIP_DOC_BUCKET).remove([path]); }
      }

      // Travel DNA de Iato (en segundo plano) y, si ya pasó, el recuerdo del avatar.
      void supabase.functions.invoke("evolucionar-dna", { body: {} }).catch(() => null);
      let souvenir: { nombre: string; lugar: string; emoji: string } | null = null;
      const pasado = isPastTrip(draft, today);
      if (pasado) {
        const { data: ev } = await supabase.functions.invoke("avatar-evolve", { body: { trip_id: tripId } }).catch(() => ({ data: null }));
        if (ev?.ok && ev.souvenir && (ev.status === "aplicado" || ev.status === "sin_avatar")) {
          souvenir = ev.souvenir;
          notifyAvatarUpdated(ev.url ?? null);
        }
      }
      setResult({ tripId, pasado, souvenir, docsFailed });
      setStep("listo");
    } catch (e) {
      toast.error((e as Error).message);
      setStep("revisar");
    }
  };

  const totals = draft ? paidTotals(draft) : {};
  const errs = draft ? validateDraft(draft) : [];

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-3xl mx-auto space-y-6">
        <header>
          <p className="text-[11px] tracking-[0.3em] uppercase text-primary mb-2 flex items-center gap-1.5"><Sparkles className="w-3 h-3" aria-hidden="true" /> Viajes pasados</p>
          <h1 className="font-display text-3xl md:text-4xl leading-tight">Sube un viaje que ya hiciste</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Boletos, pases de abordar, confirmaciones de hotel (PDF o capturas). La IA arma el viaje con <strong className="text-foreground font-medium">lo que de verdad pagaste</strong>, lo guarda en Mis viajes y tu avatar gana un detalle del destino.
          </p>
        </header>

        {(step === "subir" || step === "leyendo") && (
          <section className="glass-card rounded-3xl p-5 md:p-7 space-y-5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              disabled={step === "leyendo"}
              className="w-full rounded-2xl border-2 border-dashed border-primary/40 hover:border-primary/70 bg-black/20 p-8 text-center transition"
            >
              <FileUp className="w-10 h-10 text-primary mx-auto mb-3" aria-hidden="true" />
              <span className="block font-display text-xl">Elige tus documentos</span>
              <span className="block text-xs text-muted-foreground mt-1">PDF, JPG, PNG, WEBP o HEIC · hasta {IMPORT_MAX_FILES} archivos de 10 MB</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={IMPORT_TYPES.join(",")}
              className="hidden"
              aria-label="Elegir documentos del viaje"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            {files.length > 0 && (
              <ul className="space-y-2" aria-label="Documentos elegidos">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2">
                    <FileText className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                    <span className="text-sm truncate flex-1">{f.name}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                    <button type="button" aria-label={`Quitar ${f.name}`} disabled={step === "leyendo"} onClick={() => setFiles(files.filter((_, k) => k !== i))} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5">
                      <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
              Tus documentos se guardan en privado dentro del viaje (solo tú y quien invites). Nadie más los ve.
            </p>
            <Button onClick={read} disabled={!files.length || step === "leyendo"} className="w-full h-12 bg-gradient-gold text-primary-foreground gold-glow">
              {step === "leyendo" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Leyendo tus documentos…</> : <>Leer mis documentos</>}
            </Button>
          </section>
        )}

        {draft && (step === "revisar" || step === "guardando") && (
          <section className="space-y-5" aria-label="Revisa lo que entendimos">
            <div className="glass-card rounded-3xl p-5 md:p-7 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-display text-2xl">Revisa lo que entendimos</h2>
                {isPastTrip(draft, localISODate()) && <span className="text-[10px] uppercase tracking-[0.2em] rounded-full border border-primary/50 text-primary px-2.5 py-1">Viaje pasado</span>}
              </div>
              <p className="text-xs text-muted-foreground">Corrige lo que haga falta antes de guardar. Los precios solo vienen de tus documentos.</p>
              {draft.avisos.length > 0 && (
                <ul className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                  {draft.avisos.map((a, i) => (
                    <li key={i} className="text-xs text-amber-200/90 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />{a}</li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Destino"><Input value={draft.destino} onChange={(e) => patch({ destino: e.target.value })} className="h-10 bg-input" /></Field>
                <Field label="País"><Input value={draft.pais_destino} placeholder="Opcional" onChange={(e) => patch({ pais_destino: e.target.value })} className="h-10 bg-input" /></Field>
                <Field label="Salida"><Input type="date" value={draft.fecha_salida} onChange={(e) => patch({ fecha_salida: e.target.value })} className="h-10 bg-input" /></Field>
                <Field label="Regreso"><Input type="date" value={draft.fecha_regreso} onChange={(e) => patch({ fecha_regreso: e.target.value })} className="h-10 bg-input" /></Field>
                <Field label="Desde"><Input value={draft.ciudad_origen} placeholder="Ciudad de origen" onChange={(e) => patch({ ciudad_origen: e.target.value })} className="h-10 bg-input" /></Field>
                <Field label="Viajeros"><Input type="number" min={1} max={20} value={draft.num_viajeros} onChange={(e) => patch({ num_viajeros: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} className="h-10 bg-input" /></Field>
              </div>
            </div>

            <div className="glass-card rounded-3xl p-5 md:p-7 space-y-4">
              <h3 className="font-display text-xl flex items-center gap-2"><Plane className="w-4 h-4 text-primary" aria-hidden="true" /> Vuelos <span className="text-sm text-muted-foreground">· {draft.vuelos.length}</span></h3>
              {!draft.vuelos.length && <p className="text-xs text-muted-foreground">No encontramos vuelos en tus documentos.</p>}
              {draft.vuelos.map((v, i) => (
                <div key={i} className="rounded-2xl border border-white/10 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Aerolínea"><Input value={v.aerolinea} onChange={(e) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, aerolinea: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Vuelo"><Input value={v.numero_vuelo} placeholder="AM0402" onChange={(e) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, numero_vuelo: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="De"><Input value={v.from} onChange={(e) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="A"><Input value={v.to} onChange={(e) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Fecha"><Input type="date" value={v.fecha} onChange={(e) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, fecha: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Reserva (PNR)"><Input value={v.confirmacion} onChange={(e) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, confirmacion: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <PriceField label="Precio" value={v.precio} perPerson={v.precio_por_persona} moneda={v.moneda} onChange={(p) => patch({ vuelos: draft.vuelos.map((x, k) => (k === i ? { ...x, precio: p } : x)) })} />
                  <div className="flex items-end justify-end">
                    <button type="button" onClick={() => patch({ vuelos: draft.vuelos.filter((_, k) => k !== i) })} className="text-xs text-muted-foreground hover:text-destructive min-h-10">Quitar vuelo</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="glass-card rounded-3xl p-5 md:p-7 space-y-4">
              <h3 className="font-display text-xl flex items-center gap-2"><BedDouble className="w-4 h-4 text-primary" aria-hidden="true" /> Hospedaje <span className="text-sm text-muted-foreground">· {draft.hoteles.length}</span></h3>
              {!draft.hoteles.length && <p className="text-xs text-muted-foreground">No encontramos hospedaje en tus documentos.</p>}
              {draft.hoteles.map((h, i) => (
                <div key={i} className="rounded-2xl border border-white/10 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Hotel"><Input value={h.nombre} onChange={(e) => patch({ hoteles: draft.hoteles.map((x, k) => (k === i ? { ...x, nombre: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Ciudad"><Input value={h.ciudad} onChange={(e) => patch({ hoteles: draft.hoteles.map((x, k) => (k === i ? { ...x, ciudad: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Llegada"><Input type="date" value={h.check_in} onChange={(e) => patch({ hoteles: draft.hoteles.map((x, k) => (k === i ? { ...x, check_in: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Salida"><Input type="date" value={h.check_out} onChange={(e) => patch({ hoteles: draft.hoteles.map((x, k) => (k === i ? { ...x, check_out: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  <Field label="Confirmación"><Input value={h.confirmacion} onChange={(e) => patch({ hoteles: draft.hoteles.map((x, k) => (k === i ? { ...x, confirmacion: e.target.value } : x)) })} className="h-10 bg-input" /></Field>
                  {h.costo_cero
                    ? <p className="text-xs text-primary self-end pb-2">Sin costo (según tu documento)</p>
                    : <PriceField label="Total" value={h.precio} moneda={h.moneda} onChange={(p) => patch({ hoteles: draft.hoteles.map((x, k) => (k === i ? { ...x, precio: p } : x)) })} />}
                </div>
              ))}
            </div>

            <div className="glass-card rounded-3xl p-5 md:p-7 space-y-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Total pagado</span>
                <span className="font-display text-2xl gold-text" data-testid="import-total">
                  {Object.keys(totals).length ? Object.entries(totals).map(([m, v]) => formatPaid(v, m)).join(" + ") : "Sin precios en tus documentos"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {Object.keys(totals).length ? `${PAID_LABEL}: suma de los montos que aparecen en tus documentos, en su moneda original.` : "Puedes escribir lo que pagaste si lo sabes; si no, se queda vacío."}
              </p>
              {errs.length > 0 && <p className="text-xs text-amber-200/90" role="alert">{errs[0]}</p>}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button variant="outline" onClick={() => { setDraft(null); setStep("subir"); }} disabled={step === "guardando"} className="h-12">Volver a subir</Button>
                <Button onClick={save} disabled={step === "guardando" || errs.length > 0} className="flex-1 h-12 bg-gradient-gold text-primary-foreground gold-glow">
                  {step === "guardando" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Guardando…</> : <><Check className="w-4 h-4 mr-2" aria-hidden="true" /> Guardar en Mis viajes</>}
                </Button>
              </div>
            </div>
          </section>
        )}

        {step === "duplicado" && (
          <section className="glass-card rounded-3xl p-6 md:p-8 text-center space-y-3" role="status">
            <h2 className="font-display text-2xl">Este viaje ya está en Mis viajes</h2>
            <p className="text-sm text-muted-foreground">Uno de estos boletos o reservas ya lo habías guardado, así que no lo duplicamos.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {dupTrip && <Button onClick={() => navigate(`/dashboard/viajes/${dupTrip}`)} className="bg-gradient-gold text-primary-foreground">Ver ese viaje</Button>}
              <Button variant="outline" onClick={() => { setFiles([]); setDraft(null); setStep("subir"); }}>Subir otro</Button>
            </div>
          </section>
        )}

        {step === "listo" && result && (
          <section className="glass-card rounded-3xl p-6 md:p-8 text-center space-y-4 border border-primary/30" role="status">
            <Check className="w-10 h-10 text-primary mx-auto" aria-hidden="true" />
            <h2 className="font-display text-2xl">Tu viaje a {draft?.destino} quedó en Mis viajes</h2>
            <p className="text-sm text-muted-foreground">
              {result.pasado ? "Lo marcamos como viaje pasado, con lo que pagaste según tus documentos." : "Lo guardamos con lo que pagaste según tus documentos."}
              {result.docsFailed ? ` ${result.docsFailed} documento(s) no se pudieron guardar; súbelos desde el viaje.` : ""}
            </p>
            {result.souvenir && (
              <p className="text-sm text-foreground">
                <span className="text-xl mr-1" aria-hidden="true">{result.souvenir.emoji}</span>
                Tu avatar ganó un detalle de {result.souvenir.lugar}: {result.souvenir.nombre}.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={() => navigate(`/dashboard/viajes/${result.tripId}`)} className="bg-gradient-gold text-primary-foreground gold-glow">Ver mi viaje</Button>
              <Button variant="outline" onClick={() => { setFiles([]); setDraft(null); setResult(null); setStep("subir"); }}>Subir otro viaje</Button>
            </div>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ImportPastTrip;
