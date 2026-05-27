import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Plane, Loader2, ExternalLink, Clock, MapPin, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { subscribePush, trackFlight } from "@/lib/pushNotifications";

type FlightInfo = {
  status?: string;
  scheduled_departure?: string;
  estimated_departure?: string;
  gate?: string;
  terminal?: string;
  origin?: string;
  destination?: string;
  aircraft?: string;
  delay_minutes?: number;
  source?: string;
};

export const FlightStatusDialog = ({
  open, onClose, defaultFlight,
}: { open: boolean; onClose: () => void; defaultFlight?: string }) => {
  const [flight, setFlight] = useState(defaultFlight ?? "");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FlightInfo | null>(null);
  const [citations, setCitations] = useState<string[]>([]);
  const [raw, setRaw] = useState<string>("");

  const lookup = async () => {
    if (!flight.trim()) { toast.error("Escribe el número de vuelo (ej. AF179)"); return; }
    setLoading(true); setData(null); setCitations([]); setRaw("");
    try {
      const { data: res, error } = await supabase.functions.invoke("flight-status", {
        body: { flight: flight.trim() },
      });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      setData(res?.data ?? null);
      setCitations(res?.citations ?? []);
      setRaw(res?.raw ?? "");
    } catch (e: any) {
      toast.error(e?.message ?? "No pude consultar el vuelo");
    } finally { setLoading(false); }
  };

  const statusColor = (s?: string) => {
    if (!s) return "text-muted-foreground";
    if (/cancel/i.test(s)) return "text-destructive";
    if (/retras|delay/i.test(s)) return "text-yellow-400";
    if (/tiempo|on time|abord|aterriz|vuelo/i.test(s)) return "text-emerald-400";
    return "text-muted-foreground";
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-t-3xl sm:rounded-3xl border border-primary/30 bg-card p-5 sm:p-7 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <Plane className="w-6 h-6 text-primary" />
                <div>
                  <p className="text-[10px] tracking-[0.3em] text-primary uppercase">Acción en vivo</p>
                  <h3 className="font-display text-xl sm:text-2xl">Estado real de tu vuelo</h3>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex gap-2 mb-4">
              <Input
                placeholder="Número de vuelo (ej. AF179, AM2)"
                value={flight}
                onChange={(e) => setFlight(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && lookup()}
              />
              <Button onClick={lookup} disabled={loading} className="shrink-0">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Consultar"}
              </Button>
            </div>

            {loading && (
              <div className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Consultando fuentes oficiales en tiempo real…
              </div>
            )}

            {data && (
              <div className="space-y-3">
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] tracking-[0.3em] text-primary uppercase">Estado</span>
                    <span className={`text-sm font-semibold capitalize ${statusColor(data.status)}`}>{data.status ?? "—"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Salida programada</p>
                      <p className="font-medium flex items-center gap-1"><Clock className="w-3 h-3 text-primary" />{data.scheduled_departure ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Salida estimada</p>
                      <p className="font-medium flex items-center gap-1"><Clock className="w-3 h-3 text-primary" />{data.estimated_departure ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Puerta</p>
                      <p className="font-medium">{data.gate ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Terminal</p>
                      <p className="font-medium">{data.terminal ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Ruta</p>
                      <p className="font-medium flex items-center gap-1"><MapPin className="w-3 h-3 text-primary" />{data.origin ?? "?"} → {data.destination ?? "?"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Retraso</p>
                      <p className="font-medium">{typeof data.delay_minutes === "number" ? `${data.delay_minutes} min` : "—"}</p>
                    </div>
                  </div>
                </div>
                {citations.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p className="uppercase tracking-wider text-[10px]">Fuentes</p>
                    {citations.slice(0, 4).map((c, i) => (
                      <a key={i} href={c} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline truncate">
                        <ExternalLink className="w-3 h-3 shrink-0" /> <span className="truncate">{c}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!loading && !data && raw && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{raw}</div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(`vuelo ${flight} estado en vivo gate terminal`)}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-xs"
              >
                <ExternalLink className="w-3 h-3" /> Buscar en Google
              </a>
              <a
                href={`https://www.flightaware.com/live/flight/${encodeURIComponent(flight.replace(/\s/g, ""))}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-xs"
              >
                <ExternalLink className="w-3 h-3" /> FlightAware
              </a>
              <a
                href={`https://www.flightradar24.com/data/flights/${encodeURIComponent(flight.toLowerCase().replace(/\s/g, ""))}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-xs"
              >
                <ExternalLink className="w-3 h-3" /> FlightRadar24
              </a>
            </div>

            <p className="text-[11px] text-muted-foreground mt-4">
              Datos en vivo via Perplexity + fuentes oficiales (FlightAware, FlightRadar24, aerolínea). Para notificaciones push automáticas ante cambios necesitas activar el módulo de push web — pídeselo al concierge.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
