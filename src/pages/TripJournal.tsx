import { formatInstantDateTime } from "@/lib/localDate";
import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BookHeart, Plus, Trash2, Image as ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { FeatureTooltip } from "@/components/Tooltip";
import { useTooltipShown } from "@/hooks/useTooltipShown";
import { JOURNAL_BUCKET, journalPhotoPath, preparePhotoFile, signPhotoPaths } from "@/lib/photoUpload";
import { useVoiceNote, type TranscribeFn } from "@/hooks/useVoiceNote";
import { appendTranscript } from "@/lib/voiceNote";
import { VoiceNoteButton, VoiceNoteStatus } from "@/components/journal/VoiceNoteButton";
import { JournalLearnings, type JournalLearning } from "@/components/journal/JournalLearnings";

const LEARNING_COLS = "id, entry_id, trip_id, categoria, sentimiento, texto, lugar, ciudad, cita, created_at, edited_at";

// Nota de voz → texto en el servidor (Safari/iPhone, Firefox). El audio no se guarda.
const transcribeOnServer: TranscribeFn = async ({ base64, mime, seconds }) => {
  const { data, error } = await supabase.functions.invoke("transcribir-nota", { body: { audio_base64: base64, mime, seconds } });
  if (error) {
    let msg = "";
    try { msg = (await (error as any).context?.json?.())?.error ?? ""; } catch { /* sin cuerpo */ }
    throw new Error(msg || "No pudimos pasar tu nota a texto. Intenta de nuevo o escríbela.");
  }
  return String((data as any)?.text ?? "");
};

// photo_path: ruta en journal-photos (bucket PRIVADO); la foto se muestra con un enlace firmado.
type Entry = { id: string; created_at: string; text: string; photo_path: string | null; author_id: string };

const TripJournal = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [signed, setSigned] = useState<Map<string, string>>(new Map());
  const [learnings, setLearnings] = useState<JournalLearning[]>([]);
  const [learningNow, setLearningNow] = useState(0);
  const tipDiario = useTooltipShown("diario");
  const voice = useVoiceNote({
    onText: useCallback((t: string) => setDraft((d) => appendTranscript(d, t)), []),
    transcribe: transcribeOnServer,
    onError: useCallback((m: string) => toast.error(m), []),
  });
  const voiceBusy = voice.status === "grabando" || voice.status === "pidiendo" || voice.status === "transcribiendo";

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);
      const { data: t } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
      setTrip(t);
      const { data: es } = await supabase
        .from("trip_journal_entries")
        .select("*")
        .eq("trip_id", id)
        .order("created_at", { ascending: false });
      const list = (es as unknown as Entry[]) || [];
      const urls = await signPhotoPaths(supabase as never, JOURNAL_BUCKET, list.map((e) => e.photo_path));
      setEntries(list);
      setSigned(urls);
      // Lo aprendido de MIS entradas de este viaje (RLS: cada quien ve solo lo suyo).
      if (u.user?.id) {
        const { data: ls } = await (supabase as any).from("journal_learnings").select(LEARNING_COLS)
          .eq("trip_id", id).eq("user_id", u.user.id).order("created_at", { ascending: true });
        setLearnings(Array.isArray(ls) ? ls : []);
      }
    })();
  }, [id]);

  // Aprender de la entrada en segundo plano: no bloquea "Agregar" y si falla no pasa nada visible.
  const learnFrom = (entryId: string) => {
    setLearningNow((n) => n + 1);
    supabase.functions.invoke("aprender-diario", { body: { entry_id: entryId } })
      .then(({ data }) => {
        const got = Array.isArray((data as any)?.learnings) ? ((data as any).learnings as JournalLearning[]) : [];
        if (got.length) setLearnings((prev) => [...prev.filter((l) => l.entry_id !== entryId), ...got]);
      })
      .catch(() => { /* se reintenta la próxima vez; la entrada ya está guardada */ })
      .finally(() => setLearningNow((n) => Math.max(0, n - 1)));
  };

  const removeLearning = async (learningId: string) => {
    const prev = learnings;
    setLearnings(learnings.filter((l) => l.id !== learningId));
    const { error } = await (supabase as any).from("journal_learnings").delete().eq("id", learningId);
    if (error) { setLearnings(prev); toast.error("No se pudo borrar. Intenta de nuevo."); }
  };

  const editLearning = async (learningId: string, texto: string) => {
    const { error } = await (supabase as any).from("journal_learnings").update({ texto }).eq("id", learningId);
    if (error) { toast.error("No se pudo guardar. Intenta de nuevo."); return false; }
    setLearnings((ls) => ls.map((l) => (l.id === learningId ? { ...l, texto, edited_at: new Date().toISOString() } : l)));
    return true;
  };

  const onFile = (f: File) => {
    setFile(f);
    const r = new FileReader();
    r.onload = () => setPreview(r.result as string);
    r.readAsDataURL(f);
  };

  const add = async () => {
    if (!draft.trim() || !id || !userId) return;
    setSaving(true);
    try {
      let photo_path: string | null = null;
      if (file) {
        // Igual que la Bóveda: JPEG reescrito sin EXIF/GPS (lanza con un mensaje claro si no se puede).
        const clean = await preparePhotoFile(file);
        photo_path = journalPhotoPath(userId, id);
        const { error: upErr } = await supabase.storage.from(JOURNAL_BUCKET)
          .upload(photo_path, clean, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw upErr;
      }
      const { data, error } = await supabase
        .from("trip_journal_entries")
        .insert({ trip_id: id, author_id: userId, text: draft.trim(), photo_path } as never)
        .select()
        .single();
      if (error) {
        // Sin entrada la foto no se vería: no se deja huérfana.
        if (photo_path) await supabase.storage.from(JOURNAL_BUCKET).remove([photo_path]);
        throw error;
      }
      if (photo_path && preview) setSigned((m) => new Map(m).set(photo_path!, preview));
      setEntries([data as unknown as Entry, ...entries]);
      setDraft(""); setFile(null); setPreview(null);
      if ((data as any)?.id) learnFrom((data as any).id);
    } catch (e: any) {
      toast.error(e.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  // Borrar la entrada también borra su foto del almacenamiento (antes quedaba pública para siempre).
  const remove = async (entryId: string) => {
    const prev = entries;
    const entry = entries.find((e) => e.id === entryId);
    setEntries(entries.filter(e => e.id !== entryId));
    if (entry?.photo_path) {
      const { error: objErr } = await supabase.storage.from(JOURNAL_BUCKET).remove([entry.photo_path]);
      if (objErr) { setEntries(prev); toast.error("No se pudo borrar la foto. Intenta de nuevo."); return; }
    }
    const { error } = await supabase.from("trip_journal_entries").delete().eq("id", entryId);
    if (error) { setEntries(prev); toast.error("No se pudo borrar"); return; }
    // Lo aprendido de esa entrada se borra con ella (ON DELETE CASCADE).
    setLearnings((ls) => ls.filter((l) => l.entry_id !== entryId));
  };

  return (
    <DashboardLayout>
      <FeatureTooltip id="diario" icon="📔" text="Escribe o dicta tus recuerdos. IATOS aprende qué te gustó y qué no para tus próximos viajes." shouldShow={tipDiario.shouldShow} onDismiss={tipDiario.dismiss} />
      <div className="p-4 sm:p-6 md:p-10 max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <BookHeart className="w-7 h-7 text-primary" />
          <div className="min-w-0">
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Diario de viaje</p>
            <h1 className="font-display text-2xl sm:text-3xl truncate">{trip?.destino || "Cargando..."}</h1>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6 space-y-3">
          <Textarea aria-label="Entrada del diario" placeholder="¿Qué viviste hoy?" value={draft} onChange={e => setDraft(e.target.value)} rows={3} />
          {preview && <img src={preview} className="rounded-xl max-h-48 object-cover" alt="" />}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
              <ImageIcon className="w-4 h-4" /> Foto
              <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <VoiceNoteButton voice={voice} />
            <div className="flex-1" />
            <Button onClick={add} disabled={!draft.trim() || saving || voiceBusy}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Agregar
            </Button>
          </div>
          <VoiceNoteStatus voice={voice} />
        </div>

        <JournalLearnings items={learnings} learning={learningNow > 0} onDelete={removeLearning} onEdit={editLearning} />

        <div className="space-y-3">
          {entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Aún no hay recuerdos. Empieza a escribir tu viaje.</p>}
          {entries.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="glass-card rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-xs text-primary" data-testid="diario-fecha">{formatInstantDateTime(e.created_at)}</div>
                {(e.author_id === userId || trip?.user_id === userId) && (
                  <button onClick={() => remove(e.id)} aria-label="Eliminar esta entrada del diario" className="text-muted-foreground hover:text-destructive p-2 -m-2"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                )}
              </div>
              {e.photo_path && signed.get(e.photo_path) && <img src={signed.get(e.photo_path)} className="rounded-xl mb-3 max-h-64 w-full object-cover" alt="" />}
              <p className="text-sm whitespace-pre-line">{e.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripJournal;
