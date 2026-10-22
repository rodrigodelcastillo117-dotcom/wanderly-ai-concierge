// Una tarjeta de IATOS Wrapped a pantalla completa (9:16 en escritorio). Las medidas van en --u
// (1 % del ancho de una tarjeta 9:16 dentro de su marco, con unidades de contenedor), así el texto
// escala con la tarjeta y no se corta en un teléfono angosto ni en una pantalla grande.
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { visibleRouteLabels, type CardSpec, type RouteLayout } from "@/lib/wrapped";

const u = (n: number) => `calc(var(--u) * ${n})`;
const enter = (delayMs: number, still: boolean): { className: string; style: CSSProperties } => still
  ? { className: "", style: {} }
  : { className: "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:fill-mode-both", style: { animationDelay: `${delayMs}ms` } };

function Reveal({ i, still, children, className = "" }: { i: number; still: boolean; children: ReactNode; className?: string }) {
  const e = enter(120 + i * 110, still);
  return <div className={`${e.className} ${className}`} style={e.style}>{children}</div>;
}

/** Mapa de la ruta: retícula, arcos y ciudades (las etiquetas que no caben sin encimarse se omiten). */
export function RouteMap({ route }: { route: RouteLayout }) {
  const W = 100 * route.aspect, H = 100;
  const P = route.points.map(([x, y]) => [x * W, y * H] as const);
  const show = visibleRouteLabels(route);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Mapa de tu ruta: ${route.labels.filter(Boolean).join(", ")}`}>
      <defs>
        <radialGradient id="wr-dot" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E8D5A0" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#C9A961" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.3" y="0.3" width={W - 0.6} height={H - 0.6} rx="4" fill="#C9A961" fillOpacity="0.035" stroke="#C9A961" strokeOpacity="0.25" strokeWidth="0.35" />
      {route.grid.xs.map((x, i) => <line key={`x${i}`} x1={x * W} x2={x * W} y1="0" y2={H} stroke="#F5EBDD" strokeOpacity="0.07" strokeWidth="0.3" />)}
      {route.grid.ys.map((y, i) => <line key={`y${i}`} y1={y * H} y2={y * H} x1="0" x2={W} stroke="#F5EBDD" strokeOpacity="0.07" strokeWidth="0.3" />)}
      {route.legs.map(([a, b], i) => {
        const [x1, y1] = P[a], [x2, y2] = P[b];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.22;
        return <path key={i} d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke="#C9A961" strokeOpacity="0.75" strokeWidth="0.55" />;
      })}
      {P.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="5" fill="url(#wr-dot)" />
          <circle cx={x} cy={y} r="1.4" fill="#F3E3B0" />
          {show[i] && (
            <text x={show[i] === "left" ? x - 3 : x + 3} y={y + (y < 12 ? 7 : -3)} textAnchor={show[i] === "left" ? "end" : "start"}
              fontSize="4.4" fontWeight="600" fill="#F5EBDD" fillOpacity="0.9" style={{ fontFamily: "Manrope, system-ui, sans-serif" }}>
              {route.labels[i]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function WrappedCardView({ spec, year, still = false, index, total, reserveBottom }: {
  spec: CardSpec; year: number; still?: boolean; index: number; total: number;
  /** Alto que ocupan los botones de abajo (la tarjeta no pone texto debajo de ellos). */
  reserveBottom?: string;
}) {
  const hasHero = !!spec.photo;
  let i = 0;
  const tiles = spec.photos?.length ?? spec.privatePhotos ?? 0;
  const fill = tiles > 0;
  return (
    <article
      className="relative h-full w-full overflow-hidden bg-[#0A0A0A] text-[#F5EBDD] select-none"
      aria-label={`Tarjeta ${index + 1} de ${total}: ${spec.kicker}`}
      data-testid={`wrapped-card-${spec.kind}`}
    >
      {/* Fondo */}
      {hasHero ? (
        <>
          <img src={spec.photo!} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-black via-black/85 to-transparent" />
        </>
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: "radial-gradient(120% 70% at 50% 8%, #3b301c 0%, #15110b 45%, #0A0A0A 100%)" }} />
          <svg className="absolute inset-x-0 bottom-0 w-full opacity-[0.10]" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
            {[1, 2, 3, 4, 5, 6, 7].map((k) => <path key={k} d={`M ${50 - k * 9} 60 A ${k * 9} ${k * 9} 0 0 1 ${50 + k * 9} 60`} fill="none" stroke="#C9A961" strokeWidth="0.25" />)}
          </svg>
        </>
      )}
      <div className="pointer-events-none absolute border border-primary/50" style={{ inset: u(2.6), borderRadius: u(3.2) }} aria-hidden="true" />

      <div className="relative flex h-full flex-col" style={{ padding: `${u(19)} ${u(9)} 0`, paddingBottom: reserveBottom ?? u(12) }}>
        {/* Marca */}
        <div className="flex items-baseline justify-between text-primary" aria-hidden="true">
          <span className="font-display tracking-[0.18em]" style={{ fontSize: u(4.4) }}>IATOS</span>
          <span className="font-semibold uppercase tracking-[0.3em]" style={{ fontSize: u(2.4) }}>Wrapped {year}</span>
        </div>

        <div className={`flex flex-1 min-h-0 flex-col ${fill ? "justify-start" : hasHero ? "justify-end" : "justify-center"}`} style={{ gap: u(4.5), paddingTop: u(7) }}>
          <Reveal i={i++} still={still}>
            <p className="font-bold uppercase tracking-[0.28em] text-primary" style={{ fontSize: u(3.1) }}>{spec.kicker}</p>
          </Reveal>

          {spec.avatar && (
            <Reveal i={i++} still={still}>
              <div className="mx-auto rounded-full p-[3px] bg-gradient-to-br from-[#E8D5A0] to-[#8C7238]" style={{ width: u(36), height: u(36) }}>
                <img src={spec.avatar} alt="Tu avatar" className="h-full w-full rounded-full object-cover object-top bg-[#1a1610]" draggable={false} />
              </div>
            </Reveal>
          )}

          {spec.title && (
            <Reveal i={i++} still={still}>
              <h2 className="font-display italic font-semibold leading-[1.04] text-[#F5EBDD] [overflow-wrap:anywhere]" style={{ fontSize: spec.title.length > 18 ? u(10) : u(12.5) }}>
                {spec.title}
              </h2>
            </Reveal>
          )}

          {spec.big && (
            <Reveal i={i++} still={still}>
              <p className="font-display font-semibold leading-[0.9] bg-gradient-to-br from-[#F3E3B0] via-[#E8D5A0] to-[#C9A961] bg-clip-text text-transparent [overflow-wrap:anywhere]"
                style={{ fontSize: spec.big.length > 9 ? u(15) : spec.big.length > 5 ? u(21) : u(30) }}>
                {spec.big}
              </p>
              {spec.bigUnit && <p className="font-medium text-[#F5EBDD]" style={{ fontSize: u(5.4), marginTop: u(1.5) }}>{spec.bigUnit}</p>}
            </Reveal>
          )}

          {spec.quote && (
            <Reveal i={i++} still={still}>
              <p className="font-display text-primary leading-none" style={{ fontSize: u(20), height: u(9) }} aria-hidden="true">“</p>
              <blockquote className="font-display italic leading-[1.22] text-[#F5EBDD] [overflow-wrap:anywhere]" style={{ fontSize: spec.quote.length > 110 ? u(5.6) : u(7) }}>
                {spec.quote}
              </blockquote>
            </Reveal>
          )}

          {spec.body && (
            <Reveal i={i++} still={still}>
              <p className="text-[#F5EBDD]/85 leading-[1.4] [overflow-wrap:anywhere]" style={{ fontSize: u(4.3) }}>{spec.body}</p>
            </Reveal>
          )}

          {spec.stats && spec.stats.length > 0 && (
            <Reveal i={i++} still={still}>
              <dl className="grid" style={{ gridTemplateColumns: `repeat(${spec.stats.length}, minmax(0, 1fr))`, gap: u(3) }}>
                {spec.stats.map((s) => (
                  <div key={s.label} className="min-w-0 border-t border-primary/30" style={{ paddingTop: u(2.5) }}>
                    <dt className="sr-only">{s.label}</dt>
                    <dd className="font-display font-semibold text-primary leading-none" style={{ fontSize: u(9) }}>{s.value}</dd>
                    <dd className="font-semibold text-[#F5EBDD]/70 leading-tight" style={{ fontSize: u(2.9), marginTop: u(1.5) }}>{s.label}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          )}

          {spec.list && spec.list.length > 0 && (
            <Reveal i={i++} still={still}>
              <ul>
                {spec.list.map((it, k) => (
                  <li key={k} className="flex items-center border-t border-primary/20" style={{ gap: u(3), padding: `${u(2.2)} 0` }}>
                    {it.lead && <span aria-hidden="true" style={{ fontSize: u(6) }}>{it.lead}</span>}
                    <span className="font-display min-w-0 flex-1 truncate" style={{ fontSize: u(5.2) }}>{it.text}</span>
                    {it.meta && <span className="shrink-0 font-semibold text-primary" style={{ fontSize: u(3.2) }}>{it.meta}</span>}
                  </li>
                ))}
              </ul>
            </Reveal>
          )}

          {spec.bars && (
            <Reveal i={i++} still={still}>
              <div className="flex items-end" style={{ height: u(46), gap: u(1.4) }} role="img"
                aria-label={`Días de viaje por mes: ${spec.bars.map((b) => `${b.label} ${b.value}`).join(", ")}`}>
                {spec.bars.map((b, k) => {
                  const max = Math.max(1, ...spec.bars!.map((x) => x.value));
                  return (
                    <div key={k} className="flex flex-1 flex-col items-center justify-end h-full" style={{ gap: u(1.6) }}>
                      <div className={`w-full rounded-full ${b.highlight ? "bg-gradient-to-t from-[#C9A961] to-[#F3E3B0]" : "bg-white/20"}`}
                        style={{ height: b.value > 0 ? `${Math.max(6, (b.value / max) * 82)}%` : u(1) }} />
                      <span className={`font-bold ${b.highlight ? "text-primary" : "text-[#F5EBDD]/55"}`} style={{ fontSize: u(2.7) }}>{b.label}</span>
                    </div>
                  );
                })}
              </div>
            </Reveal>
          )}

          {spec.route && spec.route.points.length > 1 && (
            <Reveal i={i++} still={still}><RouteMap route={spec.route} /></Reveal>
          )}

          {tiles > 0 && (
            <Reveal i={i++} still={still} className="min-h-0 flex-1">
              <div className={`grid h-full ${tiles === 1 ? "grid-cols-1" : "grid-cols-2"}`} style={{ gap: u(2.4), gridAutoRows: "minmax(0, 1fr)" }}>
                {Array.from({ length: tiles }).map((_, k) => {
                  const p = spec.photos?.[k];
                  return (
                    <div key={k} className={`relative min-h-0 overflow-hidden border border-primary/35 bg-[#17130d] ${tiles === 3 && k === 0 ? "row-span-2" : ""}`} style={{ borderRadius: u(3) }}>
                      {p ? (
                        <img src={p.url} alt={p.caption || (p.place ? `Foto en ${p.place}` : "Tu foto")} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-primary/70"><Lock style={{ width: u(7), height: u(7) }} aria-label="Foto privada" /></div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Reveal>
          )}

          {spec.cta && (
            <Reveal i={i++} still={still}>
              <Link to={spec.cta.href} data-story-control
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] font-bold text-[#0A0A0A] shadow-[0_10px_40px_-10px_rgba(201,169,97,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                style={{ fontSize: u(4.2), padding: `${u(3.4)} ${u(9)}`, marginTop: u(2) }}>
                {spec.cta.label}
              </Link>
            </Reveal>
          )}

          {spec.footnote && (
            <p className="text-[#F5EBDD]/60 leading-snug" style={{ fontSize: u(2.8) }}>{spec.footnote}</p>
          )}
        </div>
      </div>
    </article>
  );
}
