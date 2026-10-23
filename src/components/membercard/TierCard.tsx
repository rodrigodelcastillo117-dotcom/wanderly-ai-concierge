// Tarjeta de rango de IATOS: una pieza tipo tarjeta bancaria de lujo (85.6 × 54) en cinco variantes.
// Solo pinta lo que dice el servidor (my_member_card): rango, nombre, número no sensible y "miembro desde".
// Ediciones especiales (solo Platinum, otorgadas por IATOS): "rose_gold" (oro rosa) y "special" (platino
// grabado con borde holográfico y sello SPECIAL EDITION). Son solo el acabado: el rango no cambia.
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { cardSince, CARD_TEXT, editionFor, tierText, type CardLang, type MemberEdition, type MemberTier } from "@/lib/memberCard";
import "./memberCard.css";

/** prefers-reduced-motion del sistema (se escucha por si cambia). */
export function usePrefersReducedMotion(): boolean {
  const q = "(prefers-reduced-motion: reduce)";
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false);
  const [reduce, setReduce] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(q);
    const on = () => setReduce(mql.matches);
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

export type TierCardProps = {
  tier: MemberTier;
  name: string | null;
  number: string | null;
  since: string | null;
  lang?: CardLang;
  /** Edición especial (del servidor). Fuera de Platinum se ignora. */
  edition?: MemberEdition | null;
  size?: "mini" | "full";
  /** Inclinación y brillo que siguen al puntero (solo en la tarjeta grande). */
  interactive?: boolean;
  className?: string;
  testId?: string;
};

export function TierCard({ tier, name, number, since, lang = "es", edition = null, size = "full", interactive = false, className = "", testId = "member-tier-card" }: TierCardProps) {
  const reduce = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [tilting, setTilting] = useState(false);
  const T = CARD_TEXT[lang];
  const ed = editionFor(tier, edition);
  const tt = tierText(tier, lang, ed);
  const numeral = ed === "rose_gold" ? "" : tier === "platinum_2" ? " II" : tier === "platinum_1" ? " I" : "";
  const sinceShort = cardSince(since);
  const canMove = interactive && !reduce;

  const onMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!canMove || !el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty("--mc-ry", `${((x - 0.5) * 14).toFixed(2)}deg`);
    el.style.setProperty("--mc-rx", `${((0.5 - y) * 10).toFixed(2)}deg`);
    el.style.setProperty("--mc-mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--mc-my", `${(y * 100).toFixed(1)}%`);
    setTilting(true);
  }, [canMove]);
  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    for (const p of ["--mc-ry", "--mc-rx", "--mc-mx", "--mc-my"]) el.style.removeProperty(p);
    setTilting(false);
  }, []);

  return (
    <div
      ref={ref}
      className={`mc-card ${className}`}
      data-tier={tier}
      data-edition={ed ?? undefined}
      data-size={size}
      data-motion={reduce ? "reduce" : "full"}
      data-tilting={tilting ? "true" : "false"}
      data-testid={testId}
      role="img"
      aria-label={`${T.card} ${tt.name}${name ? ` · ${name}` : ""}${number ? ` · ${number}` : ""}${sinceShort ? ` · ${T.memberSince} ${sinceShort}` : ""}`}
      onPointerMove={canMove ? onMove : undefined}
      onPointerLeave={canMove ? onLeave : undefined}
      onPointerCancel={canMove ? onLeave : undefined}
    >
      <span className="mc-texture" aria-hidden="true" />
      <span className="mc-grain" aria-hidden="true" />
      {tier === "platinum_2" && ed !== "rose_gold" ? <span className="mc-mark mc-mark-ii" aria-hidden="true">II</span> : null}
      {ed === "rose_gold" ? <RoseMonogram /> : null}
      {tier === "founder_black" ? <FounderEmblem /> : null}
      <div className="mc-face" aria-hidden="true">
        <div className="mc-top">
          <div>
            <p className="mc-brand mc-engrave">IATOS</p>
            {tier === "founder_black"
              ? <p className="mc-sub mc-fine" data-testid="member-founder-legend">{lang === "en" ? "Black edition" : "Edición negra"}</p>
              : <p className="mc-sub mc-fine">{lang === "en" ? "Member" : "Miembro"}</p>}
          </div>
          <div className="mc-face-right">
            <p className="mc-tier mc-engrave" data-testid="member-tier-face">
              {tt.face}
              {numeral}
            </p>
            {tt.seal ? <p className="mc-seal" data-testid="member-edition-seal">{tt.seal}</p> : null}
          </div>
        </div>
        <div className="mc-mid">
          <Chip tier={tier} edition={ed} />
          <Contactless />
        </div>
        <p className="mc-number mc-engrave" data-testid="member-tier-number">{number ?? "—"}</p>
        <div className="mc-bottom">
          <p className="mc-name mc-engrave">{name ?? (lang === "en" ? "IATOS member" : "Miembro IATOS")}</p>
          <div className="mc-since">
            <span className="mc-since-label">{T.memberSince}</span>
            <span className="mc-since-value mc-engrave">{sinceShort ?? "—"}</span>
          </div>
        </div>
      </div>
      <span className="mc-sheen" aria-hidden="true" />
    </div>
  );
}

function Chip({ tier, edition }: { tier: MemberTier; edition: MemberEdition | null }) {
  const black = tier === "founder_black";
  const rose = edition === "rose_gold";
  const id = `mc-chip-${useId().replace(/:/g, "")}`;
  return (
    <svg className="mc-chip" viewBox="0 0 50 38" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {black ? (
            <><stop offset="0" stopColor="#5d5d62" /><stop offset=".45" stopColor="#a6a6ab" /><stop offset=".55" stopColor="#7c7c81" /><stop offset="1" stopColor="#3c3c40" /></>
          ) : rose ? (
            <><stop offset="0" stopColor="#9c5d52" /><stop offset=".4" stopColor="#f6d3c4" /><stop offset=".6" stopColor="#d79a88" /><stop offset="1" stopColor="#87483f" /></>
          ) : (
            <><stop offset="0" stopColor="#a9822f" /><stop offset=".4" stopColor="#f2dc96" /><stop offset=".6" stopColor="#d1ad57" /><stop offset="1" stopColor="#8a6a26" /></>
          )}
        </linearGradient>
      </defs>
      <rect x=".5" y=".5" width="49" height="37" rx="6" fill={`url(#${id})`} stroke="rgba(0,0,0,.35)" />
      <g fill="none" stroke="rgba(0,0,0,.38)" strokeWidth=".9">
        <path d="M17 .5v12.5M33 .5v12.5M17 25v12.5M33 25v12.5M.5 13h16.5M33 13h16.5M.5 25h16.5M33 25h16.5" />
        <rect x="17" y="13" width="16" height="12" rx="3" />
      </g>
    </svg>
  );
}

function Contactless() {
  return (
    <svg className="mc-wave" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M7 8.5a5 5 0 0 1 0 7" /><path d="M10.5 6a8.5 8.5 0 0 1 0 12" /><path d="M14 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

/** Roseta guilloché de línea fina (grabado) de la Platinum Rose Gold. */
function RoseMonogram() {
  const petals = Array.from({ length: 12 }, (_, i) => i * 15);
  return (
    <svg className="mc-mark mc-mark-rose" viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth=".55">
      <circle cx="60" cy="60" r="57" />
      <circle cx="60" cy="60" r="54" strokeDasharray=".8 2.4" />
      {petals.map((a) => <ellipse key={a} cx="60" cy="60" rx="46" ry="17" transform={`rotate(${a} 60 60)`} />)}
      <circle cx="60" cy="60" r="12" />
    </svg>
  );
}

/** Emblema grabado de la negra: monograma "I" en un anillo de laureles de línea fina. */
function FounderEmblem() {
  const leaves = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg className="mc-mark mc-mark-emblem" viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth=".7">
      <circle cx="60" cy="60" r="56" />
      <circle cx="60" cy="60" r="52.5" strokeDasharray="1 2.2" />
      <circle cx="60" cy="60" r="34" />
      {leaves.map((i) => {
        const a = (112 + i * 16) * (Math.PI / 180);
        const b = (68 - i * 16) * (Math.PI / 180);
        const leaf = (ang: number, k: string) => {
          const x = 60 + Math.cos(ang) * 43, y = 60 + Math.sin(ang) * 43;
          const deg = (ang * 180) / Math.PI + 90;
          return <ellipse key={k} cx={x} cy={y} rx="2.6" ry="6.4" transform={`rotate(${deg.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})`} />;
        };
        return [leaf(a, `l${i}`), leaf(b, `r${i}`)];
      })}
      <path d="M52 44h16M52 76h16M60 44v32" strokeWidth="1.4" />
      <path d="M49 44h22M49 76h22" strokeWidth=".5" transform="translate(0 -3)" />
      <path d="M49 44h22M49 76h22" strokeWidth=".5" transform="translate(0 3)" />
    </svg>
  );
}
