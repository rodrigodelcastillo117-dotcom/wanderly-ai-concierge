import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2, Loader2, ImagePlus, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { MOMENTS_BUCKET, momentPhotoPath, preparePhotoFile, signPhotoPaths } from "@/lib/photoUpload";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { invalidateRecommendations } from "@/hooks/useAIRecommendations";
import { looksLikeFilename } from "../../../supabase/functions/_shared/tasteProfile";
import { IatoName } from "@/lib/iatoMark";

// "Mejores momentos": cada foto es una señal explícita de "esto me encantó". Con su viaje, lo que
// más te gustó y unas etiquetas, el perfil de gustos (_shared/tasteProfile.ts) le da la prioridad
// más alta; tag-moment agrega etiquetas de visión y recalcula el perfil al momento.

type Moment = {
  id: string;
  // Momentos nuevos: image_path en el bucket PRIVADO travel-moments-private (enlace firmado).
  // Los viejos conservan image_url pública hasta que se migran (scripts/privacidad).
  image_url: string | null;
  image_path?: string | null;
  caption: string | null;
  trip_name: string | null;
  trip_id?: string | null;
  destino?: string | null;
  tags?: string[] | null;
  created_at: string;
};

type TripOption = { id: string; destino: string | null; fecha_salida: string | null; fecha_regreso: string | null };

/** Lo que te encantó, en un toque: se guarda como etiqueta del momento (señal fuerte para Iato). */
export const MOMENT_TAGS = ["Playa", "Gastronomía", "Vida nocturna", "Naturaleza", "Cultura", "Arquitectura", "Aventura", "Relax", "Hotel", "Compras"];

export const IATO_MOMENT_NOTICE = "Iato lo tomará en cuenta para tus próximas sugerencias.";

const OTHER = "__otro__";

/** Nombre que se muestra: destino o viaje elegido; nunca el nombre del archivo ("IMG_1234"). */
export function momentLabel(m: Pick<Moment, "destino" | "trip_name">): string | null {
  if (m.destino?.trim()) return m.destino.trim();
  if (m.trip_name && !looksLikeFilename(m.trip_name)) return m.trip_name;
  return null;
}

const firstCity = (destino: string | null | undefined) => String(destino ?? "").split(/→|;|,/)[0].trim();
const yearOf = (d: string | null) => (d ? d.slice(0, 4) : "");

type Form = { tripId: string; destino: string; caption: string; tags: string[] };

export const BestMomentsPanel = () => {
  const { user } = useAuth();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [editing, setEditing] = useState<Moment | null>(null);
  const [form, setForm] = useState<Form>({ tripId: "", destino: "", caption: "", tags: [] });
  const [signed, setSigned] = useState<Map<string, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogOpen = pending.length > 0 || !!editing;

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [{ data }, { data: tripRows }] = await Promise.all([
      supabase.from("travel_moments").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      // Solo tus viajes que ya empezaron: los momentos son de lo que ya viviste.
      supabase.from("trips").select("id, destino, fecha_salida, fecha_regreso").eq("user_id", user.id)
        .lte("fecha_salida", today).order("fecha_salida", { ascending: false }).limit(40),
    ]);
    const list = (data as Moment[]) ?? [];
    // Enlaces firmados antes de tocar el estado: todo se actualiza en un solo render.
    const urls = await signPhotoPaths(supabase as never, MOMENTS_BUCKET, list.map((m) => m.image_path));
    setMoments(list);
    setTrips((tripRows as TripOption[]) ?? []);
    setSigned(urls);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const openForFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (inputRef.current) inputRef.current.value = "";
    if (!list.length) return;
    setForm({ tripId: trips[0]?.id ?? OTHER, destino: "", caption: "", tags: [] });
    setPending(list);
  };

  const openForEdit = (m: Moment) => {
    const known = !!m.trip_id && trips.some((t) => t.id === m.trip_id);
    setForm({
      tripId: known ? m.trip_id! : OTHER,
      destino: known ? "" : (momentLabel(m) ?? ""),
      caption: m.caption ?? "",
      tags: (m.tags ?? []).map((t) => MOMENT_TAGS.find((x) => x.toLowerCase() === t) ?? t),
    });
    setEditing(m);
  };

  const closeDialog = () => {
    if (uploading) return;
    setPending([]);
    setEditing(null);
  };

  /** Datos del momento según el formulario. */
  const fields = () => {
    const trip = trips.find((t) => t.id === form.tripId) ?? null;
    const destino = trip ? firstCity(trip.destino) : form.tripId === OTHER ? form.destino.trim() : "";
    return {
      trip_id: trip?.id ?? null,
      destino: destino || null,
      trip_name: (trip?.destino ?? destino) || null,
      caption: form.caption.trim() || null,
      tags: form.tags.map((t) => t.toLowerCase()),
    };
  };

  // Etiquetado con visión + perfil de gustos al día, sin bloquear la pantalla.
  const learnFrom = (ids: string[]) => {
    invalidateRecommendations();
    for (const id of ids) {
      supabase.functions.invoke("tag-moment", { body: { moment_id: id } })
        .then(() => invalidateRecommendations())
        .catch(() => { /* el momento cuenta igual con su viaje y su texto */ });
    }
  };

  const save = async () => {
    if (!user) return;
    setUploading(true);
    const count = editing ? 1 : pending.length;
    try {
      const data = fields();
      if (editing) {
        const { error } = await supabase.from("travel_moments").update(data).eq("id", editing.id);
        if (error) throw error;
        learnFrom([editing.id]);
      } else {
        const ids: string[] = [];
        for (const file of pending) {
          // Igual que la Bóveda: JPEG reescrito sin EXIF/GPS; nombre UUID en un bucket privado.
          const clean = await preparePhotoFile(file);
          const path = momentPhotoPath(user.id);
          const { error: upErr } = await supabase.storage.from(MOMENTS_BUCKET).upload(path, clean, { contentType: "image/jpeg", upsert: false });
          if (upErr) throw upErr;
          const { data: row, error: insErr } = await supabase.from("travel_moments")
            .insert({ user_id: user.id, image_path: path, ...data } as never).select("id").single();
          if (insErr) {
            await supabase.storage.from(MOMENTS_BUCKET).remove([path]);
            throw insErr;
          }
          if (row?.id) ids.push(row.id);
        }
        learnFrom(ids);
      }
      toast.success(editing ? "Momento actualizado" : count > 1 ? "Momentos guardados" : "Momento guardado", {
        description: IATO_MOMENT_NOTICE,
      });
      setPending([]);
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (m: Moment) => {
    if (!user) return;
    try {
      if (m.image_path) {
        const { error: objErr } = await supabase.storage.from(MOMENTS_BUCKET).remove([m.image_path]);
        if (objErr) throw objErr;
      } else if (m.image_url) {
        // Momento viejo en el bucket público.
        const marker = "/travel-moments/";
        const idx = m.image_url.indexOf(marker);
        if (idx >= 0) {
          const path = decodeURIComponent(m.image_url.slice(idx + marker.length).split(/[?#]/)[0]);
          await supabase.storage.from("travel-moments").remove([path]);
        }
      }
      await supabase.from("travel_moments").delete().eq("id", m.id);
      setMoments(prev => prev.filter(x => x.id !== m.id));
      invalidateRecommendations();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo eliminar");
    }
  };

  const toggleTag = (t: string) =>
    setForm((f) => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t].slice(0, 6) }));

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label="Elegir fotos de tus mejores momentos"
        onChange={(e) => openForFiles(e.target.files)}
      />

      {loading ? (
        <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Cargando…</div>
      ) : moments.length === 0 ? (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full rounded-2xl border border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.08] transition py-10 flex flex-col items-center gap-2 text-primary/90"
        >
          {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-7 h-7" />}
          <p className="text-sm font-medium">{uploading ? "Subiendo…" : "Sube fotos de tus mejores viajes"}</p>
          <p className="text-[11px] text-muted-foreground"><IatoName /> aprende de lo que más te gustó para sugerirte mejor</p>
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {moments.map(m => {
              const label = momentLabel(m);
              return (
                <div
                  key={m.id}
                  className="group relative aspect-square rounded-xl overflow-hidden border border-primary/20 bg-black"
                >
                  <img src={(m.image_path ? signed.get(m.image_path) : m.image_url) ?? undefined} alt={label ?? "Momento"} className="w-full h-full object-cover transition group-hover:scale-105" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-90 pointer-events-none" />
                  <button
                    onClick={() => openForEdit(m)}
                    className="absolute bottom-0 left-0 right-0 p-2 text-left"
                    title="Editar este momento"
                  >
                    <p className="text-[11px] text-white font-medium truncate">{label ?? "¿De qué viaje es?"}</p>
                    {m.caption && <p className="text-[9px] text-white/70 truncate">{m.caption}</p>}
                  </button>
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                    <button
                      onClick={() => openForEdit(m)}
                      className="w-7 h-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-primary/80"
                      title="Editar"
                      aria-label="Editar momento"
                    >
                      <Pencil className="w-3.5 h-3.5 text-white" />
                    </button>
                    <button
                      onClick={() => remove(m)}
                      className="w-7 h-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-red-500/80"
                      title="Eliminar"
                      aria-label="Eliminar momento"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="aspect-square rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.08] transition flex flex-col items-center justify-center gap-1.5 text-primary/90 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              <span className="text-[10px]">{uploading ? "Subiendo…" : "Añadir foto"}</span>
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary" /> <IatoName /> usa tus momentos para entender lo que te encanta.
          </p>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{!editing && pending.length > 1 ? `${pending.length} momentos` : "Tu momento"}</DialogTitle>
            <DialogDescription>Cuéntale a <IatoName /> qué fue lo que más te gustó: así entiende mejor qué sugerirte.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="moment-trip" className="text-xs text-muted-foreground">¿De qué viaje es?</label>
              <select
                id="moment-trip"
                value={form.tripId}
                onChange={(e) => setForm((f) => ({ ...f, tripId: e.target.value }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>{firstCity(t.destino) || "Viaje"}{t.fecha_salida ? ` · ${yearOf(t.fecha_salida)}` : ""}</option>
                ))}
                <option value={OTHER}>Otro viaje (escríbelo)</option>
                <option value="">Prefiero no decir</option>
              </select>
            </div>
            {form.tripId === OTHER && (
              <div>
                <label htmlFor="moment-destino" className="text-xs text-muted-foreground">Destino</label>
                <input
                  id="moment-destino"
                  value={form.destino}
                  maxLength={80}
                  placeholder="Ej. Mykonos"
                  onChange={(e) => setForm((f) => ({ ...f, destino: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            )}
            <div>
              <label htmlFor="moment-caption" className="text-xs text-muted-foreground">¿Qué te encantó? (opcional)</label>
              <input
                id="moment-caption"
                value={form.caption}
                maxLength={280}
                placeholder="Ej. El atardecer en Little Venice"
                onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div role="group" aria-labelledby="moment-tags-label">
              <p id="moment-tags-label" className="text-xs text-muted-foreground mb-1.5">Lo que más disfrutaste</p>
              <div className="flex flex-wrap gap-1.5">
                {MOMENT_TAGS.map((t) => {
                  const on = form.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTag(t)}
                      className={`px-2.5 py-1 rounded-full text-[11px] border transition ${on ? "bg-primary/15 border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button onClick={save} disabled={uploading} className="w-full bg-gradient-gold text-primary-foreground">
              {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {uploading ? "Guardando…" : editing ? "Guardar cambios" : pending.length > 1 ? "Guardar momentos" : "Guardar momento"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">{IATO_MOMENT_NOTICE}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
