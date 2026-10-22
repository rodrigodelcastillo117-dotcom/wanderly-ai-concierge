import { Camera, Copy, Eye, EyeOff, FileText } from "lucide-react";
import { cardLook, itemSubtitle } from "@/lib/boveda/cardStyle";
import { expiryStatus, fmtDate } from "@/lib/boveda/alerts";
import { cardDisplay, groupNumber, maskNumber } from "@/lib/boveda/mask";
import type { VaultItem } from "@/lib/boveda/types";
import { KindIcon } from "./KindIcon";

export function ExpiryChip({ expires, light, className = "" }: { expires: string | null; light: boolean; className?: string }) {
  const { state, days } = expiryStatus(expires);
  if (state === "sin_fecha") return null;
  const label = state === "vencido" ? "Vencido" : state === "pronto" ? (days === 0 ? "Vence hoy" : `Vence en ${days} d`) : `Vence ${fmtDate(expires as string).replace(/\./g, "")}`;
  const tone = state === "vencido"
    ? "bg-red-600/90 text-white"
    : state === "pronto"
      ? "bg-amber-400/95 text-black"
      : light ? "bg-black/10 text-current" : "bg-white/10 text-current";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap ${tone} ${className}`}>{label}</span>;
}

type Props = {
  item: VaultItem;
  revealed: boolean;
  filesCount: number;
  hasPdf: boolean;
  onOpen: () => void;
  onToggleReveal: () => void;
  onCopy: () => void;
};

/** Pase tipo cartera. En móvil se apilan (se ve la franja superior con nombre, vigencia y copiar). */
export function WalletCard({ item, revealed, filesCount, hasPdf, onOpen, onToggleReveal, onCopy }: Props) {
  const look = cardLook(item);
  const isCard = item.section === "tarjeta";
  const shown = item.number ? (isCard ? cardDisplay(item.number) : revealed ? groupNumber(item.number) : maskNumber(item.number)) : null;
  const btn = look.light ? "hover:bg-black/10 focus-visible:ring-black/40" : "hover:bg-white/10 focus-visible:ring-white/50";
  const bottomLeft = item.holder_name || (item.section === "documento" || item.section === "seguro" ? item.issuer : null);
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${item.title}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      data-finish={look.finish}
      className="group relative h-[212px] rounded-[22px] overflow-hidden px-4 pt-3.5 pb-4 text-left cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-primary transition-transform duration-300 md:hover:-translate-y-0.5"
      style={{ background: look.background, color: look.text, boxShadow: "0 -10px 28px -12px rgba(0,0,0,.65), 0 18px 40px -18px rgba(0,0,0,.8)" }}
    >
      {/* Brillo y filo del metal */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[22px]"
        style={{ background: "radial-gradient(120% 90% at 0% 0%, rgba(255,255,255,.22), transparent 46%), linear-gradient(180deg, rgba(255,255,255,.06), transparent 30%)" }} />
      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-inset ${look.light ? "ring-black/10" : "ring-white/10"}`} />
      <KindIcon kind={item.kind} aria-hidden="true" className="pointer-events-none absolute -right-6 -bottom-8 w-40 h-40 opacity-[0.07]" strokeWidth={1} />

      <div className="relative flex items-center justify-between gap-2 h-5">
        <span className="flex items-center gap-1.5 min-w-0 text-[10px] uppercase tracking-[0.22em] font-semibold truncate" style={{ color: look.muted }}>
          <KindIcon kind={item.kind} className="w-3.5 h-3.5 shrink-0" style={{ color: look.accent }} aria-hidden="true" />
          <span className="truncate">{itemSubtitle(item)}</span>
        </span>
        <ExpiryChip expires={item.expires_on} light={look.light} />
      </div>

      <div className="relative mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-[19px] leading-[1.15] truncate" style={{ color: look.text }}>{item.title}</h3>
          {item.tier && <p className="text-[11px] font-medium tracking-wide truncate" style={{ color: look.accent }}>{item.tier}</p>}
        </div>
        {item.number && !isCard && (
          <button type="button" aria-label={`Copiar número de ${item.title}`}
            onClick={(e) => { e.stopPropagation(); onCopy(); }}
            className={`-mr-1.5 -mt-1 shrink-0 w-9 h-9 rounded-full grid place-items-center outline-none focus-visible:ring-2 ${btn}`}>
            <Copy className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="absolute left-4 right-4 bottom-4">
        {shown && (
          <div className="flex items-center gap-1">
            <span className="font-mono text-[15px] tracking-[0.16em] tabular-nums" aria-label={revealed || isCard ? `Número ${item.number}` : "Número oculto"}>{shown}</span>
            {!isCard && (
              <button type="button" aria-label={revealed ? "Ocultar número" : "Mostrar número"} aria-pressed={revealed}
                onClick={(e) => { e.stopPropagation(); onToggleReveal(); }}
                className={`w-8 h-8 rounded-full grid place-items-center outline-none focus-visible:ring-2 ${btn}`}>
                {revealed ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
        <div className="mt-1 flex items-end justify-between gap-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: look.muted }}>
          <span className="truncate">{bottomLeft ?? " "}</span>
          <span className="flex items-center gap-2 shrink-0">
            {filesCount > 0 && (
              <span className="inline-flex items-center gap-1" aria-label={`${filesCount} archivo${filesCount === 1 ? "" : "s"}`}>
                {hasPdf ? <FileText className="w-3 h-3" aria-hidden="true" /> : <Camera className="w-3 h-3" aria-hidden="true" />}{filesCount}
              </span>
            )}
            {item.expires_on && <span>Vence {fmtDate(item.expires_on).replace(/\./g, "")}</span>}
          </span>
        </div>
      </div>
    </article>
  );
}
