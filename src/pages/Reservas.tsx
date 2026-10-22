import { useEffect, useState } from "react";
import { BookmarkCheck, ExternalLink, Calendar, MapPin, MousePointerClick } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { splitBookings } from "@/lib/bookingKinds";
import { formatInstant } from "@/lib/localDate";

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
  confirmation_code?: string | null;
  partner_reference?: string | null;
  created_at: string;
};

const labels: Record<string, string> = {
  restaurant: "Restaurante",
  train: "Tren",
  ferry: "Ferry",
  flight: "Vuelo",
  hotel: "Hotel",
  car: "Auto",
  activity: "Actividad",
  esim: "eSIM",
  insurance: "Seguro",
  other: "Otro",
};

const Reservas = () => {
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
  }, [user?.id]);

  const { confirmed, visits } = splitBookings(items);

  const renderItem = (b: Booking, kind: "confirmed" | "visit") => (
    <div key={b.id} className="glass-card rounded-2xl p-4 border border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className="text-xs">{labels[b.category] ?? b.category}</Badge>
            <span className="text-xs text-muted-foreground">{b.provider}</span>
            {kind === "visit" && (
              <span className="text-xs text-muted-foreground">· Visitado el {formatInstant(b.created_at)}</span>
            )}
            {kind === "confirmed" && b.confirmation_code && (
              <span className="text-xs text-primary">· Confirmación {b.confirmation_code}</span>
            )}
          </div>
          <h3 className="font-display text-base truncate">{b.title}</h3>
          <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
            {b.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" />{b.city}</span>}
            {b.start_at && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" aria-hidden="true" />{formatInstant(b.start_at)}</span>}
          </div>
        </div>
        {b.booking_url && (
          <Button size="sm" variant="outline" onClick={() => window.open(b.booking_url!, "_blank", "noopener")}
            aria-label={`Abrir ${b.provider} en una pestaña nueva`}>
            Abrir <ExternalLink className="w-3 h-3 ml-1" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <BookmarkCheck className="w-8 h-8 text-primary mt-1" aria-hidden="true" />
          <div>
            <h1 className="font-display text-3xl md:text-4xl">Mis reservas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tus reservas confirmadas y, aparte, los sitios de socios que visitaste desde IATOS.
            </p>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}

        {!loading && (
          <section aria-labelledby="reservas-confirmadas" className="space-y-3">
            <h2 id="reservas-confirmadas" className="font-display text-xl">Reservas confirmadas</h2>
            {confirmed.length === 0 ? (
              <div className="glass-card rounded-2xl p-6 text-sm text-muted-foreground">
                Aún no hay reservas confirmadas aquí. IATOS te lleva al sitio del socio para reservar;
                la confirmación de tu compra te llega por correo del propio socio.
              </div>
            ) : (
              confirmed.map((b) => renderItem(b, "confirmed"))
            )}
          </section>
        )}

        {!loading && (
          <section aria-labelledby="visitas-socios" className="space-y-3">
            <h2 id="visitas-socios" className="font-display text-xl flex items-center gap-2">
              <MousePointerClick className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              Búsquedas/visitas a socios
            </h2>
            <p className="text-xs text-muted-foreground">
              Enlaces que abriste para buscar o reservar. Abrir un enlace no significa que la reserva se haya hecho.
            </p>
            {visits.length === 0 ? (
              <div className="glass-card rounded-2xl p-6 text-sm text-muted-foreground">
                Cuando abras un socio (vuelos, trenes, restaurantes, tours…) lo verás aquí para retomarlo.
              </div>
            ) : (
              visits.map((b) => renderItem(b, "visit"))
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Reservas;
