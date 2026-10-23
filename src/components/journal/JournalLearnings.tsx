// "IATOS aprendió de tu viaje": lo que la IA sacó de TUS entradas del diario, a la vista y bajo tu
// control (corregir o borrar cada punto). Solo tú lo ves (RLS de journal_learnings). Lo usamos en
// tus próximos planes a través de tu perfil de gustos / Travel DNA.
import { useState } from "react";
import { Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type JournalLearning = {
  id: string;
  entry_id: string;
  trip_id: string;
  categoria: string;
  sentimiento: "positivo" | "negativo";
  texto: string;
  lugar: string | null;
  ciudad: string | null;
  cita: string;
  created_at: string;
  edited_at?: string | null;
};

type Props = {
  items: JournalLearning[];
  learning: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string, texto: string) => Promise<boolean>;
};

export function JournalLearnings({ items, learning, onDelete, onEdit }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  if (!items.length && !learning) return null;

  const likes = items.filter((i) => i.sentimiento === "positivo");
  const dislikes = items.filter((i) => i.sentimiento === "negativo");

  const save = async (id: string) => {
    const t = value.trim();
    if (t.length < 2) return;
    setSaving(true);
    const ok = await onEdit(id, t);
    setSaving(false);
    if (ok) setEditing(null);
  };

  const row = (i: JournalLearning) => {
    const pos = i.sentimiento === "positivo";
    const where = [i.lugar && !i.texto.toLowerCase().includes(i.lugar.toLowerCase()) ? i.lugar : null, i.ciudad].filter(Boolean).join(" · ");
    return (
      <li key={i.id} className="group flex items-start gap-2 py-1.5">
        <span className={cn("mt-0.5 shrink-0 rounded-full p-0.5", pos ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")} aria-hidden="true">
          {pos ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
        </span>
        {editing === i.id ? (
          <form className="flex-1 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(i.id); }}>
            <input
              autoFocus value={value} maxLength={140} onChange={(e) => setValue(e.target.value)}
              aria-label="Corregir lo aprendido"
              className="flex-1 min-w-0 bg-transparent border-b border-primary/40 text-sm focus:outline-none py-0.5"
            />
            <button type="submit" disabled={saving || value.trim().length < 2} className="text-xs text-primary disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Guardar"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground">Cancelar</button>
          </form>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-snug">
                <span className="sr-only">{pos ? "Te gusta: " : "No te gusta: "}</span>{i.texto}
              </p>
              {where && <p className="text-[11px] text-muted-foreground leading-tight">{where}</p>}
            </div>
            <button type="button" onClick={() => { setEditing(i.id); setValue(i.texto); }}
              aria-label={`Corregir: ${i.texto}`} className="p-1.5 -m-1 text-muted-foreground hover:text-primary">
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onDelete(i.id)}
              aria-label={`Borrar: ${i.texto}`} className="p-1.5 -m-1 text-muted-foreground hover:text-destructive">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="iatos-aprendio" className="glass-card rounded-2xl p-4 sm:p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
        <h2 id="iatos-aprendio" className="text-sm font-medium">IATOS aprendió de tu viaje</h2>
        {learning && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-label="Aprendiendo de tu entrada" />}
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        {items.length
          ? "De lo que escribiste. Solo tú lo ves; lo usamos para tus próximos planes. Corrige o borra lo que no sea cierto."
          : "Leyendo tu entrada para aprender qué te gustó y qué no…"}
      </p>
      {!!likes.length && <ul aria-label="Lo que te gustó">{likes.map(row)}</ul>}
      {!!dislikes.length && <ul aria-label="Lo que no te gustó" className={cn(likes.length && "mt-1 pt-1 border-t border-white/5")}>{dislikes.map(row)}</ul>}
    </section>
  );
}

export default JournalLearnings;
