// Piezas compartidas de privevalor sobre el sistema visual de Privé (prive.css del equipo prive-ux):
// título de marca en inglés con subtítulo en el idioma de la persona, chip de estado, fuente con fecha y
// enlace externo honesto (pestaña nueva, sin referer).
import type { ReactNode } from "react";
import { ExternalLink as ExternalIcon } from "lucide-react";
import { formatValueDate, type ValueLang, type ValueText } from "@/lib/priveValueI18n";

export function BrandTitle({ name, sub, as = "h2", id, eyebrow }: { name: string; sub: string; as?: "h1" | "h2" | "h3"; id?: string; eyebrow?: string }) {
  const H = as;
  return (
    <header className="space-y-1">
      {eyebrow ? <p className="prive-eyebrow">{eyebrow}</p> : null}
      <H id={id} className={`prive-serif ${as === "h1" ? "text-3xl sm:text-5xl" : as === "h2" ? "text-2xl sm:text-3xl" : "text-xl"} tracking-[0.04em]`}>
        <span lang="en">{name}</span>
      </H>
      <p className="text-sm prive-champagne">{sub}</p>
    </header>
  );
}

const CHIP_TONE: Record<string, string> = {
  good: "border-emerald-300/40 text-emerald-200",
  warn: "border-amber-300/50 text-amber-200",
  muted: "border-[color:var(--pv-line)] prive-muted",
  gold: "border-[color:var(--pv-line-strong)] prive-gold",
};
export function Chip({ children, tone = "muted", testId }: { children: ReactNode; tone?: keyof typeof CHIP_TONE; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] tracking-[0.08em] uppercase ${CHIP_TONE[tone]}`}>
      {children}
    </span>
  );
}

export function OutLink({ href, children, onOpen, className = "", t }: { href: string; children: ReactNode; onOpen?: () => void; className?: string; t: ValueText }) {
  if (!/^https:\/\//.test(href)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen}
      className={`inline-flex min-h-[44px] items-center gap-1.5 ${className}`}>
      {children}
      <ExternalIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t.common.opensNewTab}</span>
    </a>
  );
}

/** "Fuente: Nombre · Verificado el 22 de octubre de 2026", con enlace a la fuente. */
export function SourceLine({ url, name, date, kind = "verified", lang, t }: { url: string; name?: string | null; date?: string | null; kind?: "verified" | "checked"; lang: ValueLang; t: ValueText }) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const when = formatValueDate(date ?? null, lang);
  return (
    <p className="text-xs prive-muted">
      {t.common.source}:{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="prive-link underline-offset-2 hover:underline">{name || host}</a>
      {when ? <> · {kind === "verified" ? t.common.verified(when) : t.common.checked(when)}</> : null}
    </p>
  );
}

export function Field({ label, children, hint, id }: { label: string; children: ReactNode; hint?: string; id: string }) {
  return (
    <label htmlFor={id} className="block space-y-1 text-sm">
      <span className="prive-champagne">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] prive-muted">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "prive-input";
export const textareaCls = "prive-input py-3 min-h-[88px]";
/** Botón compacto (44 px, táctil) sobre el botón fantasma de Privé. */
export const smallBtn = "prive-btn prive-btn-ghost !min-h-[44px] !px-4 !tracking-[0.14em] !text-[11px]";
export const smallGoldBtn = "prive-btn prive-btn-gold !min-h-[44px] !px-4 !tracking-[0.14em] !text-[11px]";
