import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, RefreshCw, ExternalLink, Plane, Building2, Car, CreditCard, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { readFunctionError } from "@/lib/functionErrors";
import { IatoName } from "@/lib/iatoMark";

type Promo = {
  titulo: string;
  proveedor: string;
  categoria: "vuelo" | "hotel" | "auto" | "tarjeta" | "experiencia";
  beneficio: string;
  vigencia?: string;
  como_activar: string;
  requisito_vault?: string;
  url: string;
};

/** Mensaje si la búsqueda falla: claro y en español (nunca "Edge Function returned a non-2xx status code"). */
export const PROMOS_FALLBACK = "No pudimos buscar promociones ahora. Intenta de nuevo en unos minutos.";

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
  const [failure, setFailure] = useState<string | null>(null);

  const buscar = async () => {
    setLoading(true);
    setFailure(null);
    try {
      const { data, error } = await supabase.functions.invoke("buscar-promociones", { body: {} });
      if (error || data?.error) {
        const info = await readFunctionError(error ?? {}, typeof data?.message === "string" ? data.message : PROMOS_FALLBACK);
        setFailure(info.message);
        return;
      }
      const list: Promo[] = Array.isArray(data?.promociones) ? data.promociones.filter((p: Promo) => p?.url) : [];
      setResumen(data?.resumen ?? "");
      setPromos(list);
      setSearched(true);
      if (list.length) toast.success(`Encontramos ${list.length} ${list.length === 1 ? "promoción" : "promociones"} con fuente`);
    } catch {
      setFailure(PROMOS_FALLBACK);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-xl">
          <p className="text-xs text-primary tracking-[0.25em] uppercase mb-2">Búsqueda en la web</p>
          <h3 className="font-display text-2xl md:text-3xl mb-2">Promociones para tus tarjetas y programas</h3>
          <p className="text-muted-foreground text-sm">
            Al tocar «Buscar promos», <IatoName /> busca en la web promociones vigentes para las membresías, tarjetas y seguros que guardaste en Documentos y tarjetas. Solo le enviamos el nombre, el nivel y los beneficios de cada programa; nunca tus documentos ni tus números. Cada promoción trae su fuente: confirma las condiciones ahí.
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

      {failure && !loading && (
        <div role="alert" className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {failure}
        </div>
      )}

      {resumen && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground/90">
          {resumen}
        </div>
      )}

      {searched && promos.length === 0 && !loading && !resumen && (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No encontramos promociones vigentes con fuente para tus programas. Vuelve a intentarlo más adelante.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
