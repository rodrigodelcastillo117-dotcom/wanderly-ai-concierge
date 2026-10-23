// "Tu fondo" y "Tus recuerdos" en Perfil: el avatar de cuerpo completo sobre un fondo de SU país (hasta
// 3 opciones) con hasta 3 recuerdos de sus viajes (el primero en la mano). Cambiar es gratis: el
// servidor compone el PNG sin IA. La vista previa usa la misma geometría que el servidor.
import { useEffect, useMemo, useState } from "react";
import { Check, Globe2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  fondosDePais, inventario, lugarDeRecuerdo, MAX_OBJETOS_VISIBLES, nombrePais, objetoPorId, paisesOrigen, resolverFondo,
} from "../../../supabase/functions/_shared/avatar-inventory.ts";
import { personaStyle, slotsFor, slotStyle, type FaceRect, type HandPoint } from "../../../supabase/functions/_shared/avatar-layers.ts";
import { assetUrl, useAvatarLayers } from "./useAvatarLayers";

const GRADIENT = "radial-gradient(ellipse at 50% 30%, rgba(212,175,55,0.35), transparent 60%), linear-gradient(180deg, #2a1a10, #141414)";

/** Fondo + persona recortada + objetos, con CSS (instantáneo). Misma geometría que avatar-layers.ts. */
export function LayeredPreview({
  fondoUrl, personaUrl, objetos, cara, mano, className = "", alt = "Vista previa de tu avatar",
}: {
  fondoUrl: string | null;
  personaUrl: string | null;
  objetos: Array<{ id: string; url: string | null; emoji: string; nombre: string }>;
  cara?: FaceRect | null;
  mano?: HandPoint;
  className?: string;
  alt?: string;
}) {
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const slots = useMemo(
    () => slotsFor(objetos.length, { pw: dims.w, ph: dims.h, cara: cara ?? { cx: 0.5, cy: 0.12, side: 0.28 }, mano: mano ?? null }),
    [objetos.length, dims, cara, mano],
  );
  return (
    <div className={`relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#141414] ${className}`} data-testid="avatar-preview"
      style={{ background: fondoUrl ? undefined : GRADIENT }}>
      {fondoUrl && <img src={fondoUrl} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />}
      {personaUrl && (
        <img src={personaUrl} alt={alt} className="absolute object-contain" style={personaStyle(dims.w, dims.h)}
          onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setDims({ w: i.naturalWidth, h: i.naturalHeight }); }} />
      )}
      {objetos.slice(0, MAX_OBJETOS_VISIBLES).map((o, i) => slots[i] && (
        <span key={o.id} className="absolute flex items-center justify-center drop-shadow-[0_6px_8px_rgba(0,0,0,0.45)]" style={slotStyle(slots[i])} title={o.nombre}>
          {o.url ? <img src={o.url} alt={o.nombre} className="w-full h-full object-contain" /> : <span className="text-2xl" role="img" aria-label={o.nombre}>{o.emoji}</span>}
        </span>
      ))}
    </div>
  );
}

export function AvatarLayersPanel({ onRecreate }: { onRecreate?: () => void }) {
  const { state, assets, loading, save } = useAvatarLayers(true);
  const [pais, setPais] = useState<string>("");
  const [askPais, setAskPais] = useState(false);
  const [fondoId, setFondoId] = useState<string | null>(null);
  const [objetos, setObjetos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return;
    setPais(state.pais ?? state.paisSugerido ?? "MX");
    setAskPais(!state.pais);
    setFondoId(state.fondoId);
    setObjetos(state.objetos);
  }, [state]);

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Cargando tu avatar…</div>;
  }
  if (!state) return null;

  const paisActivo = state.pais ?? pais;
  const fondos = fondosDePais(paisActivo);
  const fondo = resolverFondo(paisActivo, fondoId);
  const fondoUrl = (id: string | undefined) => (id && assets.has(id) ? assetUrl(`fondos/${id}.png`, assets.get(id)!) : null);
  const inv = inventario(state.recuerdos);
  const elegidos = objetos.map((id) => objetoPorId(id)).filter((o): o is NonNullable<typeof o> => !!o);
  const dirty = fondo?.id !== state.fondoId || objetos.join(",") !== state.objetos.join(",");

  const toggle = (id: string) => {
    setObjetos((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_OBJETOS_VISIBLES ? cur : [...cur, id]);
  };
  const guardar = async (patch: { pais?: string; fondo_id?: string | null; objetos?: string[] }, ok: string) => {
    setSaving(true);
    const err = await save(patch);
    setSaving(false);
    if (err) toast.error(err); else toast.success(ok);
  };

  return (
    <section className="glass-card rounded-3xl p-5 md:p-6 border border-primary/15 space-y-5" data-testid="avatar-capas">
      <div>
        <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1 flex items-center gap-1.5"><Sparkles className="w-3 h-3" aria-hidden="true" /> Tu avatar</p>
        <h2 className="font-display text-2xl">Fondo y recuerdos</h2>
        <p className="text-sm text-muted-foreground">Tu fondo siempre es de tu país. Cambiarlo, o elegir qué recuerdos se ven, es gratis.</p>
      </div>

      {askPais && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="avatar-pais">
          <p className="text-sm flex items-center gap-2"><Globe2 className="w-4 h-4 text-primary" aria-hidden="true" /> ¿De qué país eres?</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select aria-label="Tu país de origen" value={pais} onChange={(e) => setPais(e.target.value)}
              className="h-10 rounded-md border border-border bg-input px-3 text-sm flex-1">
              {paisesOrigen().map((p) => <option key={p.code} value={p.code}>{p.nombre}</option>)}
            </select>
            <Button disabled={saving || !pais} className="h-10 bg-gradient-gold text-primary-foreground"
              onClick={() => void guardar({ pais }, "Listo: tu fondo es de tu país.").then(() => setAskPais(false))}>
              Listo
            </Button>
          </div>
        </div>
      )}

      {!state.capas ? (
        <div className="rounded-2xl border border-dashed border-primary/30 p-4 text-sm">
          <p>Tu avatar es de la versión anterior. Créalo de nuevo una vez con tu selfie para tenerlo de cuerpo completo, con el fondo de tu país y tus recuerdos en la mano.</p>
          {onRecreate && <Button variant="outline" className="mt-3" onClick={onRecreate}>Crear mi avatar de cuerpo completo</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,200px)_1fr] gap-5 items-start">
          <LayeredPreview
            className="w-full max-w-[220px] mx-auto"
            fondoUrl={fondoUrl(fondo?.id)}
            personaUrl={state.personaUrl}
            cara={state.cara}
            mano={state.mano}
            objetos={elegidos.map((o) => ({ id: o.id, nombre: o.nombre, emoji: o.emoji, url: assets.has(o.id) ? assetUrl(`objetos/${o.id}.png`, assets.get(o.id)!) : null }))}
          />
          <div className="space-y-5 min-w-0">
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-sm font-medium">Tu fondo · {nombrePais(paisActivo) ?? "tu país"}</p>
                {!askPais && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAskPais(true)}>Cambiar país</button>}
              </div>
              {fondos.length ? (
                <div className="flex gap-3" role="radiogroup" aria-label="Tu fondo">
                  {fondos.map((f) => {
                    const sel = fondo?.id === f.id;
                    const u = fondoUrl(f.id);
                    return (
                      <button key={f.id} type="button" role="radio" aria-checked={sel} onClick={() => setFondoId(f.id)}
                        className="w-[30%] max-w-[96px] text-left focus:outline-none">
                        <span className={`relative block aspect-[4/5] rounded-xl overflow-hidden border ${sel ? "border-primary ring-2 ring-primary/50" : "border-white/10"}`}
                          style={{ background: u ? undefined : GRADIENT }}>
                          {u && <img src={u} alt="" aria-hidden="true" className="w-full h-full object-cover" loading="lazy" />}
                          {sel && <Check className="absolute top-1 right-1 w-5 h-5 p-0.5 rounded-full bg-primary text-primary-foreground" aria-hidden="true" />}
                        </span>
                        <span className="block text-[11px] text-muted-foreground mt-1 leading-tight">{f.nombre}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Pronto tendremos fondos ilustrados de tu país; mientras, tu avatar usa el fondo dorado.</p>
              )}
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Tus recuerdos <span className="text-xs text-muted-foreground">· {objetos.length} de {MAX_OBJETOS_VISIBLES} en tu avatar (el primero, en tu mano)</span></p>
              {inv.length ? (
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2" role="group" aria-label="Tus recuerdos">
                  {inv.map((o) => {
                    const sel = objetos.includes(o.id);
                    const full = !sel && objetos.length >= MAX_OBJETOS_VISIBLES;
                    return (
                      <button key={o.id} type="button" aria-pressed={sel} disabled={full} onClick={() => toggle(o.id)} title={o.nombre}
                        className={`relative rounded-xl border p-1.5 text-center transition ${sel ? "border-primary bg-primary/10" : "border-white/10 hover:border-primary/40"} ${full ? "opacity-40" : ""}`}>
                        <span className="block aspect-square">
                          {assets.has(o.id)
                            ? <img src={assetUrl(`objetos/${o.id}.png`, assets.get(o.id)!)} alt="" aria-hidden="true" className="w-full h-full object-contain" loading="lazy" />
                            : <span className="flex w-full h-full items-center justify-center text-2xl" aria-hidden="true">{o.emoji}</span>}
                        </span>
                        <span className="block text-[10px] leading-tight mt-1 line-clamp-2">{o.nombre}</span>
                        {lugarDeRecuerdo(o.souvenir) && <span className="block text-[9px] text-muted-foreground">{lugarDeRecuerdo(o.souvenir)}</span>}
                        {sel && <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">{objetos.indexOf(o.id) + 1}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Cada viaje terminado te da 2 recuerdos de ese lugar (un croissant en París, una hamburguesa en Estados Unidos…).</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button disabled={!dirty || saving} onClick={() => void guardar({ fondo_id: fondo?.id ?? null, objetos }, "Tu avatar quedó listo.")}
                className="bg-gradient-gold text-primary-foreground gold-glow">
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Guardando…</> : "Guardar cambios"}
              </Button>
              <span className="text-[11px] text-muted-foreground">Sin costo</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default AvatarLayersPanel;
