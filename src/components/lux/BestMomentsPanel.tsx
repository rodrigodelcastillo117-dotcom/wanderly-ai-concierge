import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Trash2, Loader2, ImagePlus } from "lucide-react";
import { toast } from "sonner";

type Moment = {
  id: string;
  image_url: string;
  caption: string | null;
  trip_name: string | null;
  created_at: string;
};

export const BestMomentsPanel = () => {
  const { user } = useAuth();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("travel_moments")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setMoments((data as Moment[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("travel-moments").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("travel-moments").getPublicUrl(path);
        const tripName = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
        const { error: insErr } = await supabase.from("travel_moments").insert({
          user_id: user.id, image_url: pub.publicUrl, trip_name: tripName, caption: null,
        });
        if (insErr) throw insErr;
      }
      toast.success("Momentos agregados");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo subir");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (m: Moment) => {
    if (!user) return;
    try {
      const marker = "/travel-moments/";
      const idx = m.image_url.indexOf(marker);
      if (idx >= 0) {
        const path = m.image_url.slice(idx + marker.length);
        await supabase.storage.from("travel-moments").remove([path]);
      }
      await supabase.from("travel_moments").delete().eq("id", m.id);
      setMoments(prev => prev.filter(x => x.id !== m.id));
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo eliminar");
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
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
          <p className="text-[11px] text-muted-foreground">IATOS recordará tus mejores momentos</p>
        </button>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {moments.map(m => (
            <div
              key={m.id}
              className="group relative aspect-square rounded-xl overflow-hidden border border-primary/20 bg-black"
            >
              <img src={m.image_url} alt={m.trip_name ?? "Momento"} className="w-full h-full object-cover transition group-hover:scale-105" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-90" />
              <div className="absolute bottom-0 left-0 right-0 p-2">
                <p className="text-[11px] text-white font-medium truncate">{m.trip_name ?? "Viaje"}</p>
                {m.caption && <p className="text-[9px] text-white/70 truncate">{m.caption}</p>}
              </div>
              <button
                onClick={() => remove(m)}
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-red-500/80"
                title="Eliminar"
              >
                <Trash2 className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          ))}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="aspect-square rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.08] transition flex flex-col items-center justify-center gap-1.5 text-primary/90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            <span className="text-[10px]">{uploading ? "Subiendo…" : "Añadir foto"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
