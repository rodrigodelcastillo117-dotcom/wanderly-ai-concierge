import { useId } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Sello dorado de "verificado" para miembros ACTIVOS de IATOS Privé (perfil, menú, Social).
 * Solo dibuja el sello: quien lo usa decide si la persona es miembro (para el propio perfil,
 * usePriveSeal() con prive_status()). No expone nada más de Privé.
 * El brillo es sutil y se apaga con prefers-reduced-motion.
 */
export type PriveSealSize = "sm" | "md" | "lg";

const PX: Record<PriveSealSize, number> = { sm: 16, md: 22, lg: 30 };

export function PriveSeal({ size = "md", className = "" }: { size?: PriveSealSize; className?: string }) {
  const px = PX[size];
  // id único por sello: si el primero está oculto (menú lateral en móvil), Chrome no pinta el degradado.
  const gid = `prive-seal-gold-${useId().replace(/:/g, "")}`;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label="Miembro IATOS Privé"
            tabIndex={0}
            data-testid="prive-seal"
            onClick={(e) => e.stopPropagation()}
            className={`prive-seal relative inline-flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${className}`}
            style={{ width: px, height: px }}
          >
            <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true" className="drop-shadow-[0_0_6px_rgba(212,175,55,0.55)]">
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#F7E7A6" />
                  <stop offset="0.45" stopColor="#D4AF37" />
                  <stop offset="1" stopColor="#9C7A1E" />
                </linearGradient>
              </defs>
              {/* Roseta de 12 puntas (sello de verificación) */}
              <path
                fill={`url(#${gid})`}
                stroke="#0B0806"
                strokeWidth="0.8"
                d="M12 1.5l2.1 1.6 2.6-.4 1 2.4 2.4 1-.4 2.6 1.6 2.1-1.6 2.1.4 2.6-2.4 1-1 2.4-2.6-.4L12 22.5l-2.1-1.6-2.6.4-1-2.4-2.4-1 .4-2.6L2.7 12l1.6-2.1-.4-2.6 2.4-1 1-2.4 2.6.4z"
              />
              <path d="M7.6 12.3l2.9 2.9 5.9-6" fill="none" stroke="#0B0806" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span aria-hidden="true" className="prive-seal-shine pointer-events-none absolute inset-0 rounded-full" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Miembro IATOS Privé</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default PriveSeal;
