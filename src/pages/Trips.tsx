import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";

const Trips = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("trips")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setTrips(data ?? []));
  }, [user]);

  return (
    <DashboardLayout>
      <div className="p-6 md:p-10">
        <h1 className="font-display text-4xl md:text-5xl mb-10">Mis viajes</h1>
        {trips.length === 0 ? (
          <p className="text-muted-foreground">Aún no has guardado ningún viaje.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {trips.map((t) => (
              <div key={t.id} className="relative glass-card rounded-2xl p-6 hover:gold-border transition group">
                <Link
                  to={`/dashboard/viajes/${t.id}/editar`}
                  aria-label="Editar viaje"
                  className="absolute top-3 right-3 z-10 p-2 rounded-full bg-surface/60 hover:bg-primary/20 text-muted-foreground hover:text-primary transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Link>
                <Link to={`/dashboard/viajes/${t.id}`} className="block">
                  <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1 pr-8">{t.pais_destino}</p>
                  <h3 className="font-display text-2xl mb-3 group-hover:text-primary transition">{t.destino}</h3>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{new Date(t.fecha_salida).toLocaleDateString("es-MX")}</span>
                    <span className="text-foreground font-medium">${Number(t.total_estimado).toLocaleString("es-MX")}</span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Trips;
