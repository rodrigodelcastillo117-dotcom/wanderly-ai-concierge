import { Link } from "react-router-dom";
import { FileUp, Sparkles } from "lucide-react";
import { formatDateOnly } from "@/lib/dateUtils";
import { timelineItems, type AvatarSouvenir } from "./useAvatarSouvenirs";
import { objetosDeRecuerdo } from "../../../supabase/functions/_shared/avatar-inventory.ts";

const ORIGEN: Record<AvatarSouvenir["fuente"], string> = {
  fin_de_viaje: "al terminar tu viaje",
  documento: "de un viaje que importaste",
  retroactivo: "de un viaje anterior",
};

/** "Evolución" del avatar: qué viaje desbloqueó qué detalle. */
export function AvatarEvolutionTimeline({ rows, hasAvatar, capas = false }: { rows: AvatarSouvenir[]; hasAvatar: boolean; capas?: boolean }) {
  // Avatar por capas: cada recuerdo son 2 objetos del lugar (los que la persona puede lucir).
  const nombre = (r: AvatarSouvenir) => {
    const objs = capas ? objetosDeRecuerdo(r.souvenir_key) : [];
    return objs.length ? objs.map((o) => o.nombre).join(" y ") : r.nombre;
  };
  const emoji = (r: AvatarSouvenir) => (capas ? objetosDeRecuerdo(r.souvenir_key)[0]?.emoji : null) ?? r.emoji;
  const items = timelineItems(rows);
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-primary/30 bg-black/20 p-4 text-sm">
        <p className="text-foreground/90">Tu avatar gana un detalle de cada destino: un pin del Ángel si vas a CDMX, un taxi amarillo si vas a Nueva York…</p>
        <p className="text-xs text-muted-foreground mt-1">El primero llega cuando termine tu próximo viaje, o al subir uno que ya hiciste.</p>
        <Link to="/dashboard/viajes/importar" className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> Sube un viaje que ya hiciste
        </Link>
      </div>
    );
  }
  return (
    <ol className="relative space-y-3 pl-5 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-gradient-to-b before:from-primary/60 before:to-primary/5" aria-label="Evolución de tu avatar">
      {items.map((r) => (
        <li key={r.id} className="relative">
          <span className="absolute -left-5 top-1 w-[15px] h-[15px] rounded-full border border-primary/70 bg-[#120d08]" aria-hidden="true" />
          <div className="flex items-start gap-3">
            <span className="text-xl leading-none mt-0.5" aria-hidden="true">{emoji(r)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground leading-snug">
                {r.status === "repetido" ? <>Volviste a <strong className="font-medium">{r.lugar}</strong></> : nombre(r)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {r.trip_label || r.lugar} · {ORIGEN[r.fuente]}{r.trip_end ? ` · ${formatDateOnly(r.trip_end)}` : ""}
              </p>
            </div>
            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${r.visible ? "border-primary/60 text-primary bg-primary/10" : "border-white/10 text-muted-foreground"}`}>
              {r.status === "repetido" ? "Ya lo tenías" : r.visible ? "En tu avatar" : r.status === "sin_avatar" || !hasAvatar ? "Al crear tu avatar" : "En tu colección"}
            </span>
          </div>
        </li>
      ))}
      <li className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
        <Sparkles className="w-3 h-3 text-primary" aria-hidden="true" /> {capas ? "Elige en “Fondo y recuerdos” cuáles luce tu avatar (hasta 3)." : "Tu avatar luce los últimos 3; los demás quedan en tu colección."}
      </li>
    </ol>
  );
}

export default AvatarEvolutionTimeline;
