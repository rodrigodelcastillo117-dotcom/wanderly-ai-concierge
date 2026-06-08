import { useEffect, useState } from "react";
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

type Entry = { id: string; created_at: string; text: string; photo_url: string | null; author_id: string };

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
  const tipDiario = useTooltipShown("diario");

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
      setEntries((es as Entry[]) || []);
    })();
  }, [id]);

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
      let photo_url: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${userId}/${id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("journal-photos").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("journal-photos").getPublicUrl(path);
        photo_url = pub.publicUrl;
      }
      const { data, error } = await supabase
        .from("trip_journal_entries")
        .insert({ trip_id: id, author_id: userId, text: draft.trim(), photo_url })
        .select()
        .single();
      if (error) throw error;
      setEntries([data as Entry, ...entries]);
      setDraft(""); setFile(null); setPreview(null);
    } catch (e: any) {
      toast.error(e.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entryId: string) => {
    const prev = entries;
    setEntries(entries.filter(e => e.id !== entryId));
    const { error } = await supabase.from("trip_journal_entries").delete().eq("id", entryId);
    if (error) { setEntries(prev); toast.error("No se pudo borrar"); }
  };

  return (
    <DashboardLayout>
      <FeatureTooltip id="diario" icon="📔" text="Captura recuerdos durante el viaje. Iato puede usarlos para evolucionar tu Travel DNA." shouldShow={tipDiario.shouldShow} onDismiss={tipDiario.dismiss} />
      <div className="p-4 sm:p-6 md:p-10 max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <BookHeart className="w-7 h-7 text-primary" />
          <div className="min-w-0">
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Diario de viaje</p>
            <h1 className="font-display text-2xl sm:text-3xl truncate">{trip?.destino || "Cargando..."}</h1>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4 sm:p-5 mb-6 space-y-3">
          <Textarea placeholder="¿Qué viviste hoy?" value={draft} onChange={e => setDraft(e.target.value)} rows={3} />
          {preview && <img src={preview} className="rounded-xl max-h-48 object-cover" alt="" />}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
              <ImageIcon className="w-4 h-4" /> Foto
              <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <div className="flex-1" />
            <Button onClick={add} disabled={!draft.trim() || saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Agregar
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Aún no hay recuerdos. Empieza a escribir tu viaje.</p>}
          {entries.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="glass-card rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-xs text-primary">{new Date(e.created_at).toLocaleString("es-MX")}</div>
                {(e.author_id === userId || trip?.user_id === userId) && (
                  <button onClick={() => remove(e.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
              {e.photo_url && <img src={e.photo_url} className="rounded-xl mb-3 max-h-64 w-full object-cover" alt="" />}
              <p className="text-sm whitespace-pre-line">{e.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripJournal;
