import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Lock, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/dateUtils";
import {
  SIGNED_URL_TTL_S, TRIP_DOC_BUCKET, TRIP_DOC_KINDS, TRIP_DOC_KIND_LABEL, TRIP_DOC_MIME, TRIP_DOC_VISIBILITY_LABEL,
  buildDocPath, canDeleteDoc, defaultDocVisibility, formatBytes, validateDocFile,
  type TripDocKind, type TripDocument, type TripDocVisibility,
} from "@/lib/tripDocuments";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

/**
 * "Documentos" del viaje: subir, ver la lista, descargar con un enlace firmado de 60 s y borrar
 * (solo quien lo subió o el dueño del viaje). Bucket privado: no hay enlaces públicos.
 */
export function TripDocuments({ tripId, ownerId }: { tripId: string; ownerId?: string | null }) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<TripDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [kind, setKind] = useState<TripDocKind>("boleto");
  // T-P2-4: "Solo yo" por omisión para pasaporte y visa; se puede cambiar antes de subir y después.
  const [visibility, setVisibility] = useState<TripDocVisibility>(defaultDocVisibility("boleto"));
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("trip_documents")
      .select("*").eq("trip_id", tripId).order("created_at", { ascending: false });
    // Tabla aún no creada en este ambiente: la sección lo dice en lugar de fallar.
    setUnavailable(!!error);
    setDocs(error ? [] : ((data as unknown as TripDocument[]) ?? []));
    setLoading(false);
  };

  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const upload = async (file: File | undefined) => {
    if (!file || !user) return;
    const problem = validateDocFile(file);
    if (problem) { toast.error(problem); return; }
    setUploading(true);
    const path = buildDocPath(tripId, newId(), file.name);
    try {
      const { error: upErr } = await supabase.storage.from(TRIP_DOC_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase.from("trip_documents").insert({
        trip_id: tripId, uploaded_by: user.id, kind, storage_path: path, filename: file.name.slice(0, 200),
        mime: file.type, size: file.size, visibility,
      } as never);
      if (rowErr) {
        // Sin fila no se ve en la lista: no se deja el archivo huérfano.
        await supabase.storage.from(TRIP_DOC_BUCKET).remove([path]);
        throw rowErr;
      }
      toast.success("Documento guardado en tu viaje");
      await load();
    } catch {
      toast.error("No pudimos guardar el documento. Intenta de nuevo.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (doc: TripDocument) => {
    // La pestaña se abre en el mismo gesto (iOS bloquea window.open después de un await) y se le
    // asigna el enlace firmado cuando llega.
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    setBusyId(doc.id);
    const { data, error } = await supabase.storage.from(TRIP_DOC_BUCKET).createSignedUrl(doc.storage_path, SIGNED_URL_TTL_S);
    setBusyId(null);
    if (error || !data?.signedUrl) {
      win?.close();
      toast.error("No pudimos abrir el documento.");
      return;
    }
    if (win) {
      try { win.opener = null; } catch { /* no crítico */ }
      win.location.href = data.signedUrl;
    } else {
      window.location.href = data.signedUrl;
    }
  };

  const toggleVisibility = async (doc: TripDocument) => {
    const next: TripDocVisibility = doc.visibility === "solo_yo" ? "viaje" : "solo_yo";
    setBusyId(doc.id);
    const { data, error } = await (supabase as any).rpc("set_trip_document_visibility", { p_id: doc.id, p_visibility: next });
    setBusyId(null);
    if (error || !data?.ok) { toast.error("No pudimos cambiar quién lo ve."); return; }
    setDocs((d) => d.map((x) => (x.id === doc.id ? { ...x, visibility: next } : x)));
    toast.success(next === "solo_yo" ? "Ahora solo tú lo ves" : "Ahora lo ve todo el viaje");
  };

  const remove = async (doc: TripDocument) => {
    setBusyId(doc.id);
    const { error: objErr } = await supabase.storage.from(TRIP_DOC_BUCKET).remove([doc.storage_path]);
    const { error: rowErr } = objErr ? { error: objErr } : await supabase.from("trip_documents").delete().eq("id", doc.id);
    setBusyId(null);
    setConfirmId(null);
    if (objErr || rowErr) { toast.error("No pudimos borrar el documento."); return; }
    setDocs((d) => d.filter((x) => x.id !== doc.id));
    toast.success("Documento borrado");
  };

  return (
    <section className="glass-card rounded-2xl" aria-labelledby="trip-docs-title">
      <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <FileText className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
        <h2 id="trip-docs-title" className="font-display text-lg sm:text-xl">Documentos</h2>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Lock className="w-3 h-3" aria-hidden="true" /> Privados: tú decides si los ve todo el viaje o solo tú
        </span>
      </div>
      <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-border/40 space-y-4">
        {unavailable ? (
          <p className="text-sm text-muted-foreground">Los documentos del viaje todavía no están disponibles.</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                Tipo de documento
                <select value={kind} onChange={(e) => { const k = e.target.value as TripDocKind; setKind(k); setVisibility(defaultDocVisibility(k)); }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  {TRIP_DOC_KINDS.map((k) => <option key={k} value={k}>{TRIP_DOC_KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                ¿Quién lo ve?
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as TripDocVisibility)}
                  aria-label="Quién ve el documento"
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="solo_yo">{TRIP_DOC_VISIBILITY_LABEL.solo_yo}</option>
                  <option value="viaje">{TRIP_DOC_VISIBILITY_LABEL.viaje}</option>
                </select>
              </label>
              <input ref={inputRef} type="file" className="hidden" accept={TRIP_DOC_MIME.join(",")}
                aria-label="Archivo del documento" data-testid="trip-doc-input"
                onChange={(e) => void upload(e.target.files?.[0])} />
              <Button type="button" variant="outline" disabled={uploading || !user} onClick={() => inputRef.current?.click()}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4 mr-2" aria-hidden="true" />}
                {uploading ? "Subiendo…" : "Subir documento"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              PDF o imagen de hasta 10 MB. Tu pasaporte no se envía a la IA. Los enlaces de descarga duran 60 segundos.
              Pasaporte y visa quedan en "Solo yo" salvo que elijas compartirlos con el viaje.
            </p>
            {loading ? (
              <p className="text-sm text-muted-foreground" aria-busy="true">Cargando documentos…</p>
            ) : docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay documentos en este viaje.</p>
            ) : (
              <ul className="space-y-2">
                {docs.map((d) => {
                  const deletable = canDeleteDoc(d, user?.id, ownerId);
                  return (
                    <li key={d.id} className="flex items-center gap-3 rounded-xl border border-border/50 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{d.filename}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {TRIP_DOC_KIND_LABEL[d.kind] ?? d.kind} · {formatBytes(d.size)} · {formatDateOnly(d.created_at?.slice(0, 10))}
                          {d.visibility === "solo_yo" && <> · <span className="text-primary">Solo tú</span></>}
                        </p>
                      </div>
                      {d.uploaded_by === user?.id && (
                        <Button type="button" size="sm" variant="ghost" disabled={busyId === d.id}
                          aria-label={d.visibility === "solo_yo" ? `Compartir ${d.filename} con el viaje` : `Dejar ${d.filename} solo para ti`}
                          title={d.visibility === "solo_yo" ? "Compartir con el viaje" : "Dejar solo para ti"}
                          onClick={() => void toggleVisibility(d)}>
                          {d.visibility === "solo_yo" ? <Users className="w-4 h-4" aria-hidden="true" /> : <Lock className="w-4 h-4" aria-hidden="true" />}
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" disabled={busyId === d.id}
                        aria-label={`Descargar ${d.filename}`} onClick={() => void download(d)}>
                        <Download className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {deletable && (confirmId === d.id ? (
                        <Button type="button" size="sm" variant="destructive" disabled={busyId === d.id}
                          onClick={() => void remove(d)}>Confirmar borrado</Button>
                      ) : (
                        <Button type="button" size="sm" variant="ghost" aria-label={`Borrar ${d.filename}`}
                          onClick={() => setConfirmId(d.id)}>
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
