import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
              <Link key={t.id} to={`/dashboard/viajes/${t.id}`} className="glass-card rounded-2xl p-6 hover:gold-border transition group">
                <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1">{t.pais_destino}</p>
                <h3 className="font-display text-2xl mb-3 group-hover:text-primary transition">{t.destino}</h3>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{new Date(t.fecha_salida).toLocaleDateString("es-MX")}</span>
                  <span className="text-foreground font-medium">${Number(t.total_estimado).toLocaleString("es-MX")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Trips;
