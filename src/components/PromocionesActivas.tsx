import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, RefreshCw, ExternalLink, Plane, Building2, Car, CreditCard, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Promo = {
  titulo: string;
  proveedor: string;
  categoria: "vuelo" | "hotel" | "auto" | "tarjeta" | "experiencia";
  beneficio: string;
  ahorro_estimado_mxn?: number;
  vigencia?: string;
  como_activar: string;
  requisito_vault?: string;
  url?: string;
};

const ICONS = {
  vuelo: Plane,
  hotel: Building2,
  auto: Car,
  tarjeta: CreditCard,
  experiencia: Ticket,
} as const;

const PromocionesActivas = () => {
  const [loading, setLoading] = useState(false);
  const [resumen, setResumen] = useState<string>("");
  const [promos, setPromos] = useState<Promo[]>([]);
  const [searched, setSearched] = useState(false);

  const buscar = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("buscar-promociones", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResumen(data?.resumen ?? "");
      setPromos(data?.promociones ?? []);
      setSearched(true);
      if ((data?.promociones ?? []).length === 0) {
        toast.info("Agrega más programas a tu Bóveda para desbloquear promos.");
      } else {
        toast.success(`Encontramos ${data.promociones.length} promociones a tu medida`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Error buscando promociones");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Tiempo real</p>
          <h3 className="font-display text-2xl md:text-3xl mb-2">Promociones cazadas para ti</h3>
          <p className="text-muted-foreground text-sm">
            Wanderly investiga ahora mismo qué descuentos, upgrades y perks puedes activar con las tarjetas, aerolíneas y hoteles de tu Bóveda.
          </p>
        </div>
        <Button
          onClick={buscar}
          disabled={loading}
          className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow"
        >
          {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {loading ? "Buscando…" : searched ? "Actualizar" : "Buscar promos"}
        </Button>
      </div>

      {resumen && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground/90">
          {resumen}
        </div>
      )}

      {searched && promos.length === 0 && !loading && (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Aún no encontramos promociones aplicables. Suma más tarjetas o programas en tu Bóveda y vuelve a intentarlo.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {promos.map((p, i) => {
          const Icon = ICONS[p.categoria] ?? Ticket;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-primary/20 bg-card p-5 hover:border-primary/50 transition"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-gold/20 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-widest text-primary/80">{p.proveedor}</p>
                  <h4 className="font-display text-lg leading-tight">{p.titulo}</h4>
                </div>
              </div>

              <p className="text-sm text-foreground mb-3">{p.beneficio}</p>

              <div className="space-y-1 text-xs text-muted-foreground">
                {p.requisito_vault && <p><span className="text-primary">Activa con:</span> {p.requisito_vault}</p>}
                {p.vigencia && <p><span className="text-primary">Vigencia:</span> {p.vigencia}</p>}
                <p><span className="text-primary">Cómo:</span> {p.como_activar}</p>
                {!!p.ahorro_estimado_mxn && p.ahorro_estimado_mxn > 0 && (
                  <p className="text-primary font-medium">Ahorro estimado: ${p.ahorro_estimado_mxn.toLocaleString("es-MX")} MXN</p>
                )}
              </div>

              {p.url && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Ver fuente <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default PromocionesActivas;
