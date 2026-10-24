// Loader de marca IATOS: un globo terráqueo de líneas finas (meridianos y paralelos) en el dorado
// del sistema (--primary / --primary-glow) y el avión del logo dándole la vuelta con una estela que
// se desvanece (≈ 2.4 s por vuelta). Solo SVG + CSS, sin librerías. Se usa cuando una carga pasa de
// 5 s (ver useSlowLoading / SlowLoading): reemplaza cronómetros y estimaciones de tiempo; el texto
// honesto de estado ("Consultando Google Flights…") va como `label` debajo.
import { useId } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import "./globeLoader.css";

export type GlobeLoaderSize = "sm" | "md" | "lg";

const PX: Record<GlobeLoaderSize, number> = { sm: 48, md: 92, lg: 152 };
/** Grosor de los meridianos en px de pantalla (non-scaling-stroke: no adelgazan al girar). */
const MERIDIAN_PX: Record<GlobeLoaderSize, number> = { sm: 0.6, md: 0.75, lg: 0.95 };

const C = 60; // centro del viewBox 120×120
const GLOBE_R = 29;
const ORBIT_R = 46;

/** Estela: media luna que adelgaza detrás del avión (de -99° a -252°, sentido horario). */
function trailPath(): string {
  const a0 = -99, a1 = -252, n = 48;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
    const h = 1.7 * Math.pow(1 - t, 1.2) + 0.12;
    outer.push(`${(C + (ORBIT_R + h) * Math.cos(a)).toFixed(2)} ${(C + (ORBIT_R + h) * Math.sin(a)).toFixed(2)}`);
    inner.push(`${(C + (ORBIT_R - h) * Math.cos(a)).toFixed(2)} ${(C + (ORBIT_R - h) * Math.sin(a)).toFixed(2)}`);
  }
  return `M${outer.join("L")}L${inner.reverse().join("L")}Z`;
}
const TRAIL_D = trailPath();
const TRAIL_FROM = { x: (C + ORBIT_R * Math.cos((-99 * Math.PI) / 180)).toFixed(2), y: (C + ORBIT_R * Math.sin((-99 * Math.PI) / 180)).toFixed(2) };
const TRAIL_TO = { x: (C + ORBIT_R * Math.cos((-252 * Math.PI) / 180)).toFixed(2), y: (C + ORBIT_R * Math.sin((-252 * Math.PI) / 180)).toFixed(2) };

/** Avión visto desde arriba, apuntando a +x (sentido del giro cuando está arriba). */
const PLANE_D =
  "M7 0C7-.8 6.1-1.15 5-1.15H1.6L-2.1-6.9H-3.7L-1.75-1.15H-4.9L-6.3-3.3H-7.5L-6.55 0L-7.5 3.3H-6.3L-4.9 1.15H-1.75L-3.7 6.9H-2.1L1.6 1.15H5C6.1 1.15 7 .8 7 0Z";

/** Paralelos (latitudes) vistos un poco desde arriba (≈ 12°): solo la mitad frontal de cada uno. */
const TILT = Math.sin((12 * Math.PI) / 180);
const PARALLELS = [-50, -25, 0, 25, 50].map((lat) => {
  const l = (lat * Math.PI) / 180;
  const rx = GLOBE_R * Math.cos(l);
  const ry = rx * TILT;
  const cy = C - GLOBE_R * Math.sin(l) * Math.cos((12 * Math.PI) / 180);
  return { d: `M${(C - rx).toFixed(2)} ${cy.toFixed(2)}A${rx.toFixed(2)} ${ry.toFixed(2)} 0 0 0 ${(C + rx).toFixed(2)} ${cy.toFixed(2)}`, equator: lat === 0 };
});

/** Meridiano frontal: semicírculo derecho; scaleX de -1 a 1 lo lleva del borde izquierdo al derecho. */
const MERIDIAN_D = `M${C} ${C - GLOBE_R}A${GLOBE_R} ${GLOBE_R} 0 0 1 ${C} ${C + GLOBE_R}`;
/** 6 meridianos cada 60° (3 a la vista); vuelta completa en 8.4 s. Con reducir movimiento, 3 fijos. */
const MERIDIAN_PERIOD = 8.4;
const MERIDIANS = [0, 1, 2, 3, 4, 5].map((i) => ({
  delay: `${(-(i * MERIDIAN_PERIOD) / 6).toFixed(2)}s`,
  still: [-0.78, 0.02, 0.78][i] ?? 0,
  stillOpacity: i < 3 ? 1 : 0,
}));

const gold = (a = 1) => `hsl(var(--primary) / ${a})`;
const glow = (a = 1) => `hsl(var(--primary-glow) / ${a})`;

export interface GlobeLoaderProps {
  size?: GlobeLoaderSize;
  /** Estado honesto visible bajo el globo, p. ej. "Consultando Google Flights…". */
  label?: string;
  /** Texto oculto para lectores de pantalla (por omisión "Cargando…"). */
  srLabel?: string;
  className?: string;
}

export function GlobeLoader({ size = "md", label, srLabel = "Cargando…", className = "" }: GlobeLoaderProps) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (k: string) => `gl-${k}-${uid}`;
  const px = PX[size];
  const row = size === "sm" && !!label;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="globe-loader"
      data-size={size}
      data-reduced-motion={reduced ? "true" : "false"}
      className={`iatos-globe-loader flex ${row ? "flex-row items-center gap-3 text-left" : "flex-col items-center gap-3 text-center"} ${className}`}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 120 120"
        aria-hidden="true"
        focusable="false"
        className="gl-art shrink-0 overflow-visible"
      >
        <defs>
          <radialGradient id={id("halo")} cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: gold(0.12) }} />
            <stop offset="64%" style={{ stopColor: gold(0.07) }} />
            <stop offset="100%" style={{ stopColor: gold(0) }} />
          </radialGradient>
          <radialGradient id={id("sphere")} cx="36%" cy="30%" r="78%">
            <stop offset="0%" style={{ stopColor: glow(0.2) }} />
            <stop offset="55%" style={{ stopColor: gold(0.06) }} />
            <stop offset="100%" style={{ stopColor: gold(0.015) }} />
          </radialGradient>
          <linearGradient id={id("trail")} gradientUnits="userSpaceOnUse" x1={TRAIL_FROM.x} y1={TRAIL_FROM.y} x2={TRAIL_TO.x} y2={TRAIL_TO.y}>
            <stop offset="0%" style={{ stopColor: glow(0.95) }} />
            <stop offset="30%" style={{ stopColor: gold(0.6) }} />
            <stop offset="100%" style={{ stopColor: gold(0) }} />
          </linearGradient>
          <linearGradient id={id("plane")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: glow(1) }} />
            <stop offset="100%" style={{ stopColor: "hsl(var(--foreground))" }} />
          </linearGradient>
          <clipPath id={id("clip")}>
            <circle cx={C} cy={C} r={GLOBE_R} />
          </clipPath>
        </defs>

        <circle cx={C} cy={C} r={GLOBE_R + 16} style={{ fill: `url(#${id("halo")})` }} />

        {/* Globo */}
        <circle cx={C} cy={C} r={GLOBE_R} style={{ fill: `url(#${id("sphere")})` }} />
        <g clipPath={`url(#${id("clip")})`} style={{ fill: "none", stroke: gold(0.55), strokeWidth: 0.7 }}>
          {PARALLELS.map((p) => (
            <path key={p.d} d={p.d} style={p.equator ? { stroke: gold(0.8) } : undefined} />
          ))}
          {MERIDIANS.map((m, i) => (
            <path
              key={i}
              className="gl-meridian"
              d={MERIDIAN_D}
              style={{
                ["--gl-delay" as string]: m.delay,
                ["--gl-static" as string]: String(m.still),
                ["--gl-static-o" as string]: String(m.stillOpacity),
                stroke: gold(0.75),
                strokeWidth: MERIDIAN_PX[size],
                vectorEffect: "non-scaling-stroke",
              }}
            />
          ))}
        </g>
        <circle cx={C} cy={C} r={GLOBE_R} style={{ fill: "none", stroke: gold(0.95), strokeWidth: 1.1 }} />

        {/* Órbita: anillo tenue (como el del logo) + avión con estela, girando juntos. */}
        <circle cx={C} cy={C} r={ORBIT_R} style={{ fill: "none", stroke: gold(0.11), strokeWidth: 0.6 }} />
        <g className="gl-orbit">
          <path d={TRAIL_D} style={{ fill: `url(#${id("trail")})` }} />
          <path
            className="gl-plane"
            d={PLANE_D}
            transform={`translate(${C} ${C - ORBIT_R}) scale(1.05)`}
            style={{ fill: `url(#${id("plane")})` }}
          />
        </g>
      </svg>
      <span className="sr-only">{srLabel}</span>
      {label && (
        <p className={`${size === "sm" ? "text-xs" : "text-sm"} text-muted-foreground leading-snug max-w-xs`} data-testid="globe-loader-label">
          {label}
        </p>
      )}
    </div>
  );
}

export default GlobeLoader;
