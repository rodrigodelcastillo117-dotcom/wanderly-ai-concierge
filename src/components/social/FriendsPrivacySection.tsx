import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Eye, EyeOff, Lock, MessageCircle, Star, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useSignedMoments } from "@/hooks/useFriendAvatars";
import { localISODate } from "@/lib/localDate";
import {
  ACTIVITY_KEYS, activityError, activityHeadline, answer, DEFAULT_SETTINGS, deleteRecommendation, groupOwnTrips, hideItem, loadOwnActivity,
  recommendPlace, REACCIONES, relativeDay, saveSettings, shareMoment, stars, TIPO_LABEL, tripDates,
  type FriendTrip, type OwnActivityItem, type OwnMoment, type SocialSettings,
} from "@/lib/friendActivity";

type RpcClient = Parameters<typeof saveSettings>[0];
const client = () => supabase as unknown as RpcClient;

const TOGGLES: { key: keyof SocialSettings; label: string; hint: string; group: "perfil" | "viajes" | "actividad" }[] = [
  { key: "avatar", label: "Mi avatar", hint: "Tu Travel Avatar en tu perfil, la lista de amigos y la postal.", group: "perfil" },
  { key: "viajes_pasados", label: "Viajes pasados", hint: "Destino, países y portada.", group: "viajes" },
  { key: "viajes_proximos", label: "Viajes próximos", hint: "Los que aún no haces (y el que estás viviendo).", group: "viajes" },
  { key: "fechas_completas", label: "Fechas exactas", hint: "Apagado: solo mes y año.", group: "viajes" },
  { key: "reservas", label: "Reservas", hint: "Restaurantes, hoteles y experiencias confirmadas o que marcaste «Ya lo compré».", group: "actividad" },
  { key: "recomendaciones", label: "Recomendaciones", hint: "Los lugares que recomiendas, con tus estrellas.", group: "actividad" },
  { key: "favoritos", label: "Favoritos", hint: "Lo que guardas con el corazón.", group: "actividad" },
  { key: "visitados", label: "Lugares visitados", hint: "Lo que marcaste como visitado.", group: "actividad" },
  { key: "momentos", label: "Momentos", hint: "Solo las fotos que marques como compartibles (abajo).", group: "actividad" },
];
const TIPO_SETTING: Record<OwnActivityItem["tipo"], keyof SocialSettings> = {
  reserva: "reservas", recomendacion: "recomendaciones", favorito: "favoritos", visitado: "visitados", momento: "momentos",
};
const CATEGORIAS = [
  { id: "restaurant", label: "Restaurante" }, { id: "hotel", label: "Hotel" }, { id: "activity", label: "Experiencia" }, { id: "lugar", label: "Lugar" },
];

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className="text-sm font-medium cursor-pointer">{label}</label>
        <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </div>
  );
}

function AnswerBox({ onSend }: { onSend: (t: string) => Promise<boolean> }) {
  const [t, setT] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2 mt-1.5">
      <Input value={t} onChange={(e) => setT(e.target.value.slice(0, 500))} placeholder="Tu respuesta" aria-label="Tu respuesta" className="h-9 text-sm" />
      <Button size="sm" disabled={busy || !t.trim()} className="h-9 bg-gradient-gold text-primary-foreground"
        onClick={async () => { setBusy(true); const ok = await onSend(t.trim()); setBusy(false); if (ok) setT(""); }}>Responder</Button>
    </div>
  );
}

/** "Qué ven mis amigos": interruptores por tipo, vista previa de mi actividad, reacciones y preguntas. */
export function FriendsPrivacySection() {
  const location = useLocation();
  const [settings, setSettings] = useState<SocialSettings>(DEFAULT_SETTINGS);
  const [items, setItems] = useState<OwnActivityItem[]>([]);
  const [trips, setTrips] = useState<FriendTrip[]>([]);
  const [moments, setMoments] = useState<OwnMoment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [reco, setReco] = useState({ nombre: "", ciudad: "", categoria: "restaurant", estrellas: 5, nota: "" });
  const [recoBusy, setRecoBusy] = useState(false);
  const today = localISODate();

  const load = useCallback(async () => {
    const r = await loadOwnActivity(client());
    if (r.ok) { setSettings(r.ajustes); setItems(r.items); setTrips(r.viajes); setMoments(r.momentos); }
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (location.hash === "#que-ven-mis-amigos" && loaded) document.getElementById("que-ven-mis-amigos")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [location.hash, loaded]);

  const momentPhotos = useSignedMoments(useMemo(() => moments.map((m) => m.fotoPath), [moments]));
  const nothingShared = ACTIVITY_KEYS.every((k) => !settings[k]);

  const setMany = async (patch: Partial<SocialSettings>, label: string) => {
    const prev = settings;
    setSettings({ ...settings, ...patch });
    setSaving(label);
    const r = await saveSettings(client(), patch);
    setSaving(null);
    if (!r?.ok) { setSettings(prev); toast.error("No se pudo guardar. Intenta de nuevo."); return; }
    void load();
  };

  const toggleHidden = async (clave: string, hidden: boolean) => {
    const r = await hideItem(client(), clave, hidden);
    if (!r?.ok) { toast.error("No se pudo cambiar."); return; }
    setItems((xs) => xs.map((x) => (x.clave === clave ? { ...x, oculto: hidden } : x)));
    setTrips((xs) => xs.map((x) => (`viaje:${x.id}` === clave ? { ...x, oculto: hidden } : x)));
  };

  const toggleMoment = async (m: OwnMoment) => {
    const r = await shareMoment(client(), m.id, !m.compartido);
    if (!r?.ok) { toast.error("No se pudo cambiar."); return; }
    setMoments((xs) => xs.map((x) => (x.id === m.id ? { ...x, compartido: !m.compartido } : x)));
    void load();
  };

  const sendAnswer = async (preguntaId: string, texto: string) => {
    const r = await answer(client(), preguntaId, texto);
    if (!r?.ok) { toast.error(activityError(r)); return false; }
    setItems((xs) => xs.map((x) => ({ ...x, preguntas: x.preguntas.map((q) => (q.id === preguntaId ? { ...q, respuesta: texto } : q)) })));
    toast.success("Respuesta enviada");
    return true;
  };

  const submitReco = async () => {
    if (recoBusy || reco.nombre.trim().length < 2) return;
    setRecoBusy(true);
    const r = await recommendPlace(client(), { nombre: reco.nombre.trim(), ciudad: reco.ciudad.trim() || null, categoria: reco.categoria, estrellas: reco.estrellas, nota: reco.nota.trim() || null });
    setRecoBusy(false);
    if (!r?.ok) { toast.error(activityError(r)); return; }
    toast.success(settings.recomendaciones ? "Recomendación publicada para tus amigos" : "Guardada. Prende «Recomendaciones» para que tus amigos la vean.");
    setReco({ nombre: "", ciudad: "", categoria: reco.categoria, estrellas: 5, nota: "" });
    void load();
  };

  const removeReco = async (clave: string) => {
    const r = await deleteRecommendation(client(), clave.replace(/^reco:/, ""));
    if (!r?.ok) { toast.error("No se pudo borrar."); return; }
    setItems((xs) => xs.filter((x) => x.clave !== clave));
  };

  const visibleItems = showAll ? items : items.slice(0, 6);
  const pending = items.reduce((n, i) => n + i.preguntas.filter((q) => !q.respuesta).length, 0);

  return (
    <section id="que-ven-mis-amigos" aria-labelledby="que-ven-title" className="glass-card rounded-3xl p-5 md:p-8 border border-white/[0.06] space-y-6 scroll-mt-20" data-testid="friends-privacy">
      <div>
        <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1.5 flex items-center gap-1.5"><Users className="w-3 h-3" aria-hidden="true" /> Social</p>
        <h2 id="que-ven-title" className="font-display text-2xl md:text-3xl">Qué ven mis amigos</h2>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          Solo tus amigos aceptados, y solo lo que prendas. Si dejan de ser amigos, dejan de verlo.
        </p>
      </div>

      {loaded && nothingShared && (
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.05] p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="share-nudge">
          <p className="text-sm flex-1">¿Les cuentas a tus amigos a dónde vas a comer y qué te encantó? Prende lo que quieras compartir; tú decides qué sí y qué no.</p>
          <Button size="sm" className="bg-gradient-gold text-primary-foreground shrink-0" disabled={!!saving}
            onClick={() => void setMany({ recomendaciones: true, visitados: true }, "nudge")}>Compartir recomendaciones y lugares</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2">
        {(["perfil", "viajes", "actividad"] as const).map((g) => (
          <div key={g}>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mt-2">{g === "perfil" ? "Perfil" : g === "viajes" ? "Viajes" : "Actividad"}</p>
            <div className="divide-y divide-white/[0.05]">
              {TOGGLES.filter((t) => t.group === g).map((t) => (
                <Toggle key={t.key} id={`sp-${t.key}`} label={t.label} hint={t.hint} checked={settings[t.key]} disabled={saving === t.key}
                  onChange={(v) => void setMany({ [t.key]: v }, t.key)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Lock className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
        Nunca se muestran precios, montos, documentos, tu ubicación en vivo ni detalles de tus reservas (código, horario, enlace).
        Lo que haces aparece un día después y solo con el día, sin la hora.
      </p>

      {/* RECOMENDAR */}
      <div className="rounded-2xl border border-white/[0.06] p-4 space-y-3">
        <p className="font-medium text-sm flex items-center gap-1.5"><Star className="w-4 h-4 text-primary" aria-hidden="true" /> Recomienda un lugar</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input value={reco.nombre} onChange={(e) => setReco({ ...reco, nombre: e.target.value.slice(0, 120) })} placeholder="Nombre (p. ej. Cocina Las Ranitas)" aria-label="Nombre del lugar" />
          <Input value={reco.ciudad} onChange={(e) => setReco({ ...reco, ciudad: e.target.value.slice(0, 80) })} placeholder="Ciudad" aria-label="Ciudad" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Tipo de lugar">
            {CATEGORIAS.map((c) => (
              <button key={c.id} type="button" aria-pressed={reco.categoria === c.id} onClick={() => setReco({ ...reco, categoria: c.id })}
                className={`px-3 py-1.5 rounded-full text-xs border ${reco.categoria === c.id ? "bg-primary text-primary-foreground border-primary" : "border-white/10 text-muted-foreground"}`}>{c.label}</button>
            ))}
          </div>
          <div className="flex gap-0.5 ml-auto" role="radiogroup" aria-label="Estrellas">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={reco.estrellas === n} aria-label={`${n} estrellas`} onClick={() => setReco({ ...reco, estrellas: n })}
                className={`text-lg leading-none ${n <= reco.estrellas ? "" : "opacity-30"}`}>⭐</button>
            ))}
          </div>
        </div>
        <Textarea value={reco.nota} onChange={(e) => setReco({ ...reco, nota: e.target.value.slice(0, 280) })} rows={2} placeholder="Qué pedir o por qué ir (opcional)" aria-label="Nota" className="text-sm" />
        <Button size="sm" disabled={recoBusy || reco.nombre.trim().length < 2} onClick={() => void submitReco()} className="bg-gradient-gold text-primary-foreground">Recomendar</Button>
      </div>

      {/* MI ACTIVIDAD */}
      <div className="space-y-2">
        <p className="font-medium text-sm flex items-center gap-2">
          Tu actividad {pending > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground">{pending} {pending === 1 ? "pregunta" : "preguntas"}</span>}
        </p>
        {loaded && items.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay reservas, recomendaciones, favoritos ni lugares visitados.</p>}
        <ul className="space-y-2" data-testid="own-activity">
          {visibleItems.map((i) => {
            const shared = settings[TIPO_SETTING[i.tipo]];
            const status = !shared ? `Apagado: prende «${TOGGLES.find((t) => t.key === TIPO_SETTING[i.tipo])?.label}» para compartirlo`
              : i.oculto ? "Escondido"
              : i.visibleDesde ? "Tus amigos lo verán a partir de mañana"
              : "Lo ven tus amigos";
            const total = i.reacciones.corazon + i.reacciones.fuego + i.reacciones.antojo;
            return (
              <li key={i.clave} className="rounded-xl border border-white/[0.06] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{activityHeadline(i)} {i.estrellas ? <span className="text-xs">{stars(i.estrellas)}</span> : null}</p>
                    <p className="text-[11px] text-muted-foreground">{TIPO_LABEL[i.tipo]} · {relativeDay(i.fecha, today)} · {status}</p>
                    {total > 0 && (
                      <p className="text-xs mt-0.5" aria-label="Reacciones de tus amigos">
                        {REACCIONES.filter((r) => i.reacciones[r.id] > 0).map((r) => `${r.emoji} ${i.reacciones[r.id]}`).join("  ")}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => void toggleHidden(i.clave, !i.oculto)} aria-label={i.oculto ? `Mostrar ${i.titulo}` : `Esconder ${i.titulo}`}
                    className="p-2 rounded-full hover:bg-white/[0.05] text-muted-foreground">
                    {i.oculto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {i.tipo === "recomendacion" && (
                    <button type="button" onClick={() => void removeReco(i.clave)} className="text-[11px] text-muted-foreground hover:text-destructive px-1 py-2">Borrar</button>
                  )}
                </div>
                {i.preguntas.map((q) => (
                  <div key={q.id} className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
                    <p className="flex items-center gap-1.5"><MessageCircle className="w-3 h-3 text-primary" aria-hidden="true" /> <span className="text-primary">{q.de}:</span> {q.pregunta}</p>
                    {q.respuesta ? <p className="mt-1"><span className="text-muted-foreground">Tú:</span> {q.respuesta}</p> : <AnswerBox onSend={(t) => sendAnswer(q.id, t)} />}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
        {items.length > 6 && (
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)} className="text-xs">{showAll ? "Ver menos" : `Ver todo (${items.length})`}</Button>
        )}
      </div>

      {/* MIS VIAJES */}
      {trips.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-sm">Tus viajes</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {groupOwnTrips(trips).slice(0, 12).map((t) => {
              const shared = t.fase === "pasado" ? settings.viajes_pasados : settings.viajes_proximos;
              return (
                <li key={t.clave} className="flex items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" title={t.destino}>{t.nombre}{t.repetidos > 1 ? <span className="text-muted-foreground"> · {t.repetidos} viajes</span> : null}</p>
                    <p className="text-[11px] text-muted-foreground">{tripDates({ ...t, fechaSalida: settings.fechas_completas ? t.fechaSalida : null })} · {!shared ? "Apagado" : t.oculto ? "Escondido" : "Lo ven tus amigos"}</p>
                  </div>
                  {t.id && (
                    <button type="button" onClick={() => void toggleHidden(`viaje:${t.id}`, !t.oculto)} aria-label={t.oculto ? `Mostrar ${t.nombre}` : `Esconder ${t.nombre}`}
                      className="p-2 rounded-full hover:bg-white/[0.05] text-muted-foreground">
                      {t.oculto ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">Un viaje que hicieron juntos siempre lo ve tu compañero de viaje.</p>
        </div>
      )}

      {/* MOMENTOS */}
      {moments.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-sm">Momentos que compartes</p>
          <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {moments.map((m) => {
              const url = momentPhotos.get(m.fotoPath);
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => void toggleMoment(m)} aria-pressed={m.compartido} aria-label={`${m.compartido ? "Dejar de compartir" : "Compartir"} ${m.titulo}`}
                    className={`relative block w-full aspect-square rounded-xl overflow-hidden border-2 ${m.compartido ? "border-primary" : "border-transparent opacity-70"}`}>
                    {url ? <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 bg-white/[0.05]" />}
                    <span className="absolute bottom-1 left-1 right-1 text-[10px] rounded bg-black/60 text-white px-1 truncate">{m.compartido ? "Compartido" : "Privado"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
