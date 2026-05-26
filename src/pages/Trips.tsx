import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Users, Sparkles, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import santorini from "@/assets/hero-santorini.jpg";

const cache = new Map<string, string | null>();

const TripCard = ({ t }: { t: any }) => {
  const [img, setImg] = useState<string | null>(cache.get(t.destino) ?? null);

  useEffect(() => {
    if (cache.has(t.destino)) return;
    const key = `pexels:${t.destino}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      cache.set(t.destino, stored);
      setImg(stored);
      return;
    }
    const url = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/pexels-image?query=${encodeURIComponent(
      `${t.destino} ${t.pais_destino ?? ""} travel`,
    )}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        const image = d?.image ?? null;
        cache.set(t.destino, image);
        if (image) localStorage.setItem(key, image);
        setImg(image);
      })
      .catch(() => {});
  }, [t.destino, t.pais_destino]);

  return (
    <div className="relative glass-card rounded-2xl overflow-hidden hover:gold-border transition group">
      {t.shared && (
        <div className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-[10px] font-medium">
          <Users className="w-3 h-3" /> Compartido
        </div>
      )}
      <Link
        to={`/dashboard/viajes/${t.id}/editar`}
        aria-label="Editar viaje"
        className="absolute top-3 right-3 z-10 p-2 rounded-full bg-background/60 backdrop-blur hover:bg-primary/20 text-muted-foreground hover:text-primary transition"
      >
        <Pencil className="w-3.5 h-3.5" />
      </Link>
      <Link to={`/dashboard/viajes/${t.id}`} className="block">
        <div className="relative h-44 w-full overflow-hidden bg-surface">
          {img ? (
            <img
              src={img}
              alt={t.destino}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-surface" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        </div>
        <div className="p-5">
          <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1 pr-8">{t.pais_destino}</p>
          <h3 className="font-display text-2xl mb-3 group-hover:text-primary transition">{t.destino}</h3>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{new Date(t.fecha_salida).toLocaleDateString("es-MX")}</span>
            <span className="text-foreground font-medium">${Number(t.total_estimado).toLocaleString("es-MX")}</span>
          </div>
        </div>
      </Link>
    </div>
  );
};

const Trips = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [own, collab] = await Promise.all([
        supabase.from("trips").select("*").eq("user_id", user.id),
        supabase.from("trip_collaborators").select("trip_id").eq("user_id", user.id),
      ]);
      const sharedIds = (collab.data ?? []).map((c: any) => c.trip_id);
      let shared: any[] = [];
      if (sharedIds.length) {
        const { data } = await supabase.from("trips").select("*").in("id", sharedIds);
        shared = (data ?? []).map((t: any) => ({ ...t, shared: true }));
      }
      const all = [...(own.data ?? []), ...shared].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      setTrips(all);
    })();
  }, [user]);

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10">
        <h1 className="font-display text-3xl md:text-5xl mb-6 md:mb-10">Mis viajes</h1>
        {trips.length === 0 ? (
          <p className="text-muted-foreground">Aún no has guardado ningún viaje.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {trips.map((t) => (
              <TripCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Trips;
