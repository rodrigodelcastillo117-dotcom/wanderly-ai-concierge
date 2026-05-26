import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, BookHeart, Plus, Trash2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";

type Entry = { id: string; date: string; text: string; photo?: string };

const TripJournal = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<any>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();

  const key = `iatos:journal:${id}`;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("trips").select("*").eq("id", id).single();
      setTrip(data);
    })();
    try { setEntries(JSON.parse(localStorage.getItem(key) || "[]")); } catch {}
  }, [id]);

  const save = (list: Entry[]) => {
    setEntries(list);
    localStorage.setItem(key, JSON.stringify(list));
  };

  const add = () => {
    if (!draft.trim()) return;
    const e: Entry = { id: crypto.randomUUID(), date: new Date().toISOString(), text: draft, photo };
    save([e, ...entries]);
    setDraft(""); setPhoto(undefined);
  };

  const remove = (id: string) => save(entries.filter(e => e.id !== id));

  const onFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => setPhoto(r.result as string);
    r.readAsDataURL(f);
  };

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10 max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="mb-6 flex items-center gap-3">
          <BookHeart className="w-7 h-7 text-primary" />
          <div>
            <p className="text-primary text-xs tracking-[0.2em] uppercase">Diario de viaje</p>
            <h1 className="font-display text-3xl">{trip?.destino}</h1>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5 mb-6 space-y-3">
          <Textarea placeholder="¿Qué viviste hoy?" value={draft} onChange={e => setDraft(e.target.value)} rows={3} />
          {photo && <img src={photo} className="rounded-xl max-h-48 object-cover" alt="" />}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
              <ImageIcon className="w-4 h-4" /> Foto
              <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            <div className="flex-1" />
            <Button onClick={add} disabled={!draft.trim()}><Plus className="w-4 h-4 mr-1" /> Agregar</Button>
          </div>
        </div>

        <div className="space-y-3">
          {entries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Aún no hay recuerdos. Empieza a escribir tu viaje.</p>}
          {entries.map((e, i) => (
            <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="glass-card rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-xs text-primary">{new Date(e.date).toLocaleString("es-MX")}</div>
                <button onClick={() => remove(e.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
              </div>
              {e.photo && <img src={e.photo} className="rounded-xl mb-3 max-h-64 w-full object-cover" alt="" />}
              <p className="text-sm whitespace-pre-line">{e.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TripJournal;
