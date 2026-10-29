import { PriveSeal, type PriveSealSize } from "@/components/PriveSeal";

/**
 * Avatar circular de IATOS: la misma pieza en el encabezado del perfil, el menú, la barra móvil y la
 * tarjeta del Travel DNA (y Social puede reutilizarla). Anillo dorado sutil con brillo suave, imagen
 * a sangre (object-cover, sin barras blancas/negras) centrada hacia la cara, sello Privé en el borde
 * del anillo como "verificado" y, en tamaños grandes, los recuerdos de viaje orbitando el anillo
 * (nunca encima de la cara).
 */
export type AvatarCircleSize = "xs" | "sm" | "md" | "lg" | "xl";

const DIAMETER: Record<AvatarCircleSize, string> = {
  xs: "w-8 h-8",
  sm: "w-10 h-10",
  md: "w-28 h-28 md:w-36 md:h-36",
  lg: "w-56 h-56 md:w-72 md:h-72",
  xl: "w-64 h-64 md:w-80 md:h-80",
};
const RING: Record<AvatarCircleSize, string> = { xs: "p-[1.5px]", sm: "p-[2px]", md: "p-[3px]", lg: "p-[4px]", xl: "p-[5px]" };
const SEAL: Record<AvatarCircleSize, PriveSealSize> = { xs: "sm", sm: "sm", md: "md", lg: "lg", xl: "lg" };
const INITIAL: Record<AvatarCircleSize, string> = { xs: "text-sm", sm: "text-base", md: "text-5xl", lg: "text-7xl", xl: "text-8xl" };

export type OrbitBadge = { key: string; emoji: string; nombre: string };

/** Ángulos (grados desde arriba, sentido horario) del borde izquierdo-inferior: lejos de la cara. */
export const ORBIT_ANGLES = [228, 258, 288, 198];

export function orbitPosition(angleDeg: number): { left: string; top: string } {
  const r = (angleDeg * Math.PI) / 180;
  return { left: `${(50 + 50 * Math.sin(r)).toFixed(2)}%`, top: `${(50 - 50 * Math.cos(r)).toFixed(2)}%` };
}

export function AvatarCircle({
  url,
  name,
  size = "md",
  prive = false,
  badges = [],
  glow = true,
  className = "",
}: {
  url: string | null;
  name?: string | null;
  size?: AvatarCircleSize;
  prive?: boolean;
  badges?: OrbitBadge[];
  glow?: boolean;
  className?: string;
}) {
  // name === "": el nombre aún está cargando → círculo vacío (antes salía una "V" de "Viajero" y luego la S).
  const initial = name === "" ? "" : (name?.trim()?.[0] ?? "V").toUpperCase();
  const big = size === "lg" || size === "xl";
  return (
    <div className={`relative shrink-0 ${DIAMETER[size]} ${className}`} data-testid="avatar-circle">
      <div
        className={`avatar-ring rounded-full w-full h-full ${RING[size]} ${glow ? "shadow-[0_0_0_1px_rgba(212,175,55,0.15),0_0_28px_-6px_rgba(212,175,55,0.55)]" : ""}`}
      >
        <div className="w-full h-full rounded-full overflow-hidden bg-[#0b0806] ring-1 ring-black/60 flex items-center justify-center">
          {url ? (
            <img
              src={url}
              alt={name ? `Avatar de ${name}` : "Tu Travel Avatar"}
              className="w-full h-full object-cover"
              style={{ objectPosition: "50% 18%" }}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className={`font-display text-primary ${INITIAL[size]}`} aria-label={name ? `Inicial de ${name}` : undefined}>{initial}</span>
          )}
        </div>
      </div>
      {big && badges.slice(0, ORBIT_ANGLES.length).map((b, i) => {
        const pos = orbitPosition(ORBIT_ANGLES[i]);
        return (
          <span
            key={b.key}
            title={b.nombre}
            aria-label={b.nombre}
            role="img"
            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-[#120d08]/95 border border-primary/60 shadow-[0_4px_14px_-4px_rgba(0,0,0,0.9),0_0_10px_-2px_rgba(212,175,55,0.45)] w-9 h-9 md:w-11 md:h-11 text-base md:text-xl"
            style={pos}
          >
            {b.emoji}
          </span>
        );
      })}
      {prive && (
        <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: "85.36%", top: "85.36%" }}>
          <PriveSeal size={SEAL[size]} />
        </span>
      )}
    </div>
  );
}

export default AvatarCircle;
