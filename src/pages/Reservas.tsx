import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookmarkCheck, ExternalLink, Calendar, MapPin } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Booking = {
  id: string;
  category: string;
  provider: string;
  title: string;
  subtitle: string | null;
  booking_url: string | null;
  city: string | null;
  start_at: string | null;
  status: string;
  created_at: string;
};

const labels: Record<string, string> = {
  restaurant: "Restaurante",
  train: "Tren",
  flight: "Vuelo",
  hotel: "Hotel",
  car: "Auto",
  activity: "Actividad",
  esim: "eSIM",
  insurance: "Seguro",
};

const Reservas = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("bookings")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setItems((data as Booking[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div className="flex items-start gap-3">
          <BookmarkCheck className="w-8 h-8 text-primary mt-1" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Mis reservas</h1>
            <p className="text-sm text-muted-foreground mt-1">Todas las reservas y links que has tomado en IATOS</p>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {!loading && items.length === 0 && (
          <div className="glass-card rounded-2xl p-10 text-center">
            <p className="text-sm text-muted-foreground">Aún no tienes reservas. Cuando reserves mesas, trenes, vuelos o tours, aparecerán aquí.</p>
          </div>
        )}

        <div className="space-y-3">
          {items.map((b) => (
            <div key={b.id} className="glass-card rounded-2xl p-4 border border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px]">{labels[b.category] ?? b.category}</Badge>
                    <span className="text-xs text-muted-foreground">{b.provider}</span>
                  </div>
                  <h3 className="font-display text-base truncate">{b.title}</h3>
                  <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
                    {b.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{b.city}</span>}
                    {b.start_at && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(b.start_at).toLocaleDateString("es-MX")}</span>}
                  </div>
                </div>
                {b.booking_url && (
                  <Button size="sm" variant="outline" onClick={() => window.open(b.booking_url!, "_blank")}>
                    Abrir <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Reservas;
