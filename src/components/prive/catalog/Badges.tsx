import { BadgeCheck, Clock, Info, ShieldCheck } from "lucide-react";
import type { PriveExperience, PriveState } from "@/lib/priveCatalogApi";
import { labelWithEvidence, shortDate, STATE_TEXT } from "@/lib/priveCatalogView";

const TONE: Record<string, string> = {
  ok: "border-emerald-500/40 text-emerald-300",
  info: "border-[color:var(--pv-line-strong)] text-[color:var(--pv-gold)]",
  warn: "border-amber-500/50 text-amber-300",
  muted: "border-[color:var(--pv-line)] text-[color:var(--pv-muted)]",
};

export function StateBadge({ state, verifiedAt }: { state: PriveState; verifiedAt?: string | null }) {
  const t = STATE_TEXT[state] ?? STATE_TEXT.PENDIENTE;
  const Icon = state === "VERIFICADO" ? BadgeCheck : state === "DESACTUALIZADO" ? Clock : Info;
  return (
    <span title={t.hint} data-testid="prive-state" className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${TONE[t.tone]}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t.label}
      {verifiedAt && (state === "VERIFICADO" || state === "CURADO" || state === "DESACTUALIZADO") ? ` · ${shortDate(verifiedAt)}` : ""}
      <span className="sr-only">. {t.hint}</span>
    </span>
  );
}

/** Etiqueta comercial SOLO con su evidencia; sin evidencia no se dibuja nada. */
export function LabelBadge({ e, withEvidence = false }: { e: Pick<PriveExperience, "label" | "label_evidence" | "verified_at">; withEvidence?: boolean }) {
  const l = labelWithEvidence(e);
  if (!l) return null;
  return (
    <span className="inline-flex flex-col gap-0.5" data-testid="prive-label">
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--pv-line-strong)] px-2 py-0.5 text-[11px] text-[color:var(--pv-gold)]" title={l.evidence}>
        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {l.title}
      </span>
      {withEvidence && <span className="text-[11px] text-[color:var(--pv-muted)]">{l.evidence}</span>}
    </span>
  );
}
