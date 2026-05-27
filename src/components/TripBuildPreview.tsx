import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Route as RouteIcon, Calendar, Users, Wallet, Sparkles, Plane, Hotel, Utensils, Compass, Train, Pencil, Minus, Plus, Share2, Send, Mail, Copy, Check, Loader2 } from "lucide-react";
import { detectRouteIntent } from "@/lib/detectRouteIntent";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  origin?: string;
  destinoRaw?: string;
  destinations?: string[]; // override (multi page)
  fechaSalida?: string;
  fechaRegreso?: string;
  viajeros?: number;
  presupuesto?: number | null;
  onChangeFechas?: (fechaSalida: string, fechaRegreso: string) => void;
  onChangeViajeros?: (n: number) => void;
};

const fmtDate = (s?: string) => {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  } catch {
    return s;
  }
};

export const TripBuildPreview = ({
  origin,
  destinoRaw,
  destinations,
  fechaSalida,
  fechaRegreso,
  viajeros,
  presupuesto,
  onChangeFechas,
  onChangeViajeros,
}: Props) => {
  const [copied, setCopied] = useState(false);
  const [iatosOpen, setIatosOpen] = useState(false);
  const [friends, setFriends] = useState<{ id: string; name: string; avatar: string | null }[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!iatosOpen || friends.length > 0) return;
    (async () => {
      setLoadingFriends(true);
      try {
        const { data: rows } = await supabase.from("mis_amigos").select("amigo_id");
        const ids = (rows ?? []).map((r: any) => r.amigo_id);
        if (!ids.length) { setFriends([]); return; }
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
        setFriends((profs ?? []).map((p: any) => ({
          id: p.id,
          name: p.full_name || p.username || "Amigo",
          avatar: p.avatar_url ?? null,
        })));
      } finally {
        setLoadingFriends(false);
      }
    })();
  }, [iatosOpen, friends.length]);
  const dests = (() => {
    if (destinations && destinations.length) return destinations.filter(Boolean);
    if (destinoRaw && destinoRaw.trim()) {
      const intent = detectRouteIntent(destinoRaw);
      return intent.destinations.filter(Boolean);
    }
    return [];
  })();

  const isMulti = dests.length >= 2;
  const nights =
    fechaSalida && fechaRegreso
      ? Math.max(
          0,
          Math.round((new Date(fechaRegreso).getTime() - new Date(fechaSalida).getTime()) / 86400000),
        )
      : null;

  const hasAny = !!(origin || dests.length || fechaSalida || viajeros);

  return (
    <aside className="rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 md:p-6 space-y-5 premium-shadow">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-primary/80">IATOS AI · construyendo</p>
          <h3 className="font-display text-lg md:text-xl mt-1">Tu viaje en vivo</h3>
        </div>
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-2 h-2 rounded-full bg-primary"
        />
      </header>

      {!hasAny && (
        <p className="text-sm text-muted-foreground italic">
          Empieza a escribir y verás aquí cómo IATOS AI estructura tu travesía paso a paso…
        </p>
      )}

      {/* Ruta */}
      {(origin || dests.length > 0) && (
        <div className="space-y-2">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
            {isMulti ? <RouteIcon className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
            {isMulti ? `Travesía · ${dests.length} ciudades` : "Destino"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence mode="popLayout">
              {origin && (
                <motion.span
                  key={`o-${origin}`}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-2.5 py-1 rounded-full bg-surface border border-border text-xs"
                >
                  {origin}
                </motion.span>
              )}
              {dests.map((d, i) => (
                <motion.span
                  key={`d-${d}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1.5 text-xs"
                >
                  <span className="text-primary/60">→</span>
                  <span className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary">
                    {d}
                  </span>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Meta */}
      {(fechaSalida || viajeros || presupuesto != null || onChangeFechas) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {(fechaSalida || onChangeFechas) && (
            onChangeFechas ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2 text-left hover:border-primary/50 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                    <div className="leading-tight flex-1 min-w-0">
                      <p className="text-muted-foreground text-[10px] flex items-center gap-1">
                        Fechas <Pencil className="w-2.5 h-2.5 opacity-60" />
                      </p>
                      <p className="truncate">
                        {fechaSalida ? fmtDate(fechaSalida) : "Elegir salida"}
                        {fechaRegreso ? ` → ${fmtDate(fechaRegreso)}` : fechaSalida ? " → regreso" : ""}
                        {nights ? ` · ${nights}n` : ""}
                      </p>
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 bg-card border-border" align="start">
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="fs" className="text-[10px] uppercase tracking-widest text-muted-foreground">Fecha de ida</Label>
                      <Input
                        id="fs"
                        type="date"
                        value={fechaSalida ?? ""}
                        onChange={(e) => {
                          const newSalida = e.target.value;
                          // Si ya hay una duración definida, conservamos los días y recorremos el regreso
                          if (newSalida && fechaSalida && fechaRegreso) {
                            const prevDays = Math.round(
                              (new Date(fechaRegreso).getTime() - new Date(fechaSalida).getTime()) / 86400000,
                            );
                            if (prevDays > 0) {
                              const d = new Date(newSalida);
                              d.setDate(d.getDate() + prevDays);
                              onChangeFechas(newSalida, d.toISOString().slice(0, 10));
                              return;
                            }
                          }
                          onChangeFechas(newSalida, fechaRegreso ?? "");
                        }}
                        className="bg-input border-border h-10 mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="fr" className="text-[10px] uppercase tracking-widest text-muted-foreground">Fecha de regreso</Label>
                      <Input
                        id="fr"
                        type="date"
                        value={fechaRegreso ?? ""}
                        min={fechaSalida || undefined}
                        onChange={(e) => onChangeFechas(fechaSalida ?? "", e.target.value)}
                        className="bg-input border-border h-10 mt-1"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/40">
                      Al cambiar la fecha de ida, la de regreso se ajusta automáticamente para conservar tus {nights ?? "—"} noches.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-primary/70" />
                <div className="leading-tight">
                  <p className="text-muted-foreground text-[10px]">Fechas</p>
                  <p>
                    {fmtDate(fechaSalida)}
                    {fechaRegreso ? ` → ${fmtDate(fechaRegreso)}` : ""}
                    {nights ? ` · ${nights}n` : ""}
                  </p>
                </div>
              </div>
            )
          )}
          {viajeros ? (
            onChangeViajeros ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2 text-left hover:border-primary/50 transition-colors"
                  >
                    <Users className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                    <div className="leading-tight flex-1 min-w-0">
                      <p className="text-muted-foreground text-[10px] flex items-center gap-1">
                        Viajeros <Pencil className="w-2.5 h-2.5 opacity-60" />
                      </p>
                      <p>{viajeros}</p>
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 bg-card border-border" align="start">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">¿Cuántos viajeros?</Label>
                      <div className="flex items-center justify-between mt-2 rounded-xl bg-input border border-border px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => onChangeViajeros(Math.max(1, (viajeros ?? 1) - 1))}
                          className="w-9 h-9 rounded-lg bg-surface hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors disabled:opacity-30"
                          disabled={(viajeros ?? 1) <= 1}
                          aria-label="Quitar viajero"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="font-display text-2xl tabular-nums">{viajeros}</span>
                        <button
                          type="button"
                          onClick={() => onChangeViajeros(Math.min(20, (viajeros ?? 1) + 1))}
                          className="w-9 h-9 rounded-lg bg-surface hover:bg-primary/10 hover:text-primary flex items-center justify-center transition-colors"
                          aria-label="Agregar viajero"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 pt-1 border-t border-border/40">
                      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                        <Share2 className="w-3 h-3" /> Compartir viaje con amigos
                      </Label>
                      {(() => {
                        const shareText = `Mira este viaje que estoy armando con IATOS AI${
                          destinations && destinations.length
                            ? `: ${destinations.filter(Boolean).join(" → ")}`
                            : destinoRaw
                            ? `: ${destinoRaw}`
                            : ""
                        }${fechaSalida ? ` (${fmtDate(fechaSalida)}${fechaRegreso ? ` → ${fmtDate(fechaRegreso)}` : ""})` : ""}.`;
                        const shareUrl = typeof window !== "undefined" ? window.location.href : "";
                        const full = `${shareText} ${shareUrl}`.trim();
                        return (
                          <div className="grid grid-cols-3 gap-2">
                            <a
                              href={`https://wa.me/?text=${encodeURIComponent(full)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex flex-col items-center gap-1 rounded-lg bg-surface border border-border hover:border-primary/50 py-2 transition-colors"
                            >
                              <MessageCircle className="w-4 h-4 text-primary" />
                              <span className="text-[10px]">WhatsApp</span>
                            </a>
                            <a
                              href={`mailto:?subject=${encodeURIComponent("Mi viaje en IATOS AI")}&body=${encodeURIComponent(full)}`}
                              className="flex flex-col items-center gap-1 rounded-lg bg-surface border border-border hover:border-primary/50 py-2 transition-colors"
                            >
                              <Mail className="w-4 h-4 text-primary" />
                              <span className="text-[10px]">Email</span>
                            </a>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  if (navigator.share) {
                                    await navigator.share({ title: "Mi viaje · IATOS AI", text: shareText, url: shareUrl });
                                  } else {
                                    await navigator.clipboard.writeText(full);
                                    setCopied(true);
                                    toast.success("Enlace copiado");
                                    setTimeout(() => setCopied(false), 2000);
                                  }
                                } catch {/* ignore */}
                              }}
                              className="flex flex-col items-center gap-1 rounded-lg bg-surface border border-border hover:border-primary/50 py-2 transition-colors"
                            >
                              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-primary" />}
                              <span className="text-[10px]">{copied ? "Copiado" : "Copiar"}</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-primary/70" />
                <div className="leading-tight">
                  <p className="text-muted-foreground text-[10px]">Viajeros</p>
                  <p>{viajeros}</p>
                </div>
              </div>
            )
          ) : null}
          {presupuesto != null && (
            <div className="col-span-2 rounded-xl bg-surface border border-border px-3 py-2 flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-primary/70" />
              <div className="leading-tight">
                <p className="text-muted-foreground text-[10px]">Presupuesto</p>
                <p>${presupuesto.toLocaleString("es-MX")} MXN</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lo que la IA generará */}
      {dests.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <p className="text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-primary" /> IATOS AI generará desde 0
          </p>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2"><Plane className="w-3.5 h-3.5 text-primary/70" /> Vuelos por ciudad (3 tiers) + escalas reales</li>
            {isMulti && (
              <li className="flex items-center gap-2"><Train className="w-3.5 h-3.5 text-primary/70" /> Trenes / roadtrips entre destinos</li>
            )}
            <li className="flex items-center gap-2"><Hotel className="w-3.5 h-3.5 text-primary/70" /> 3 hoteles por ciudad (ahorro · equilibrio · premium)</li>
            <li className="flex items-center gap-2"><Utensils className="w-3.5 h-3.5 text-primary/70" /> 4-6 restaurantes según tu paladar</li>
            <li className="flex items-center gap-2"><Compass className="w-3.5 h-3.5 text-primary/70" /> Tours, experiencias e itinerario día por día</li>
          </ul>
        </div>
      )}
    </aside>
  );
};

export default TripBuildPreview;
