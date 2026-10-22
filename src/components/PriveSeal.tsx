import { useId } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const SIZE = { sm: 14, md: 18, lg: 26 } as const;

// Roseta de 12 puntas suaves (estilo "verificado"), en un viewBox de 24 × 24.
const ROSETTE = (() => {
  const pts: string[] = [];
  const n = 12;
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? 11.6 : 9.6;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
})();

type Props = { size?: keyof typeof SIZE; className?: string };

/**
 * Sello dorado de miembro IATOS Privé (junto al nombre). Solo se muestra cuando el servidor dice
 * que la membresía está activa y vigente (is_prive); no lleva código de socio ni fechas.
 */
export function PriveSeal({ size = "md", className = "" }: Props) {
  const px = SIZE[size];
  const gid = useId().replace(/:/g, "");
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label="Miembro IATOS Privé"
            tabIndex={0}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex shrink-0 align-[-0.125em] rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${className}`}
            data-testid="prive-seal"
          >
            <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" className="drop-shadow-[0_0_6px_rgba(201,169,97,0.55)]">
              <defs>
                <linearGradient id={`ps-${gid}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#F3E3B0" />
                  <stop offset="0.5" stopColor="#C9A961" />
                  <stop offset="1" stopColor="#8C7238" />
                </linearGradient>
              </defs>
              <path d={ROSETTE} fill={`url(#ps-${gid})`} stroke="#F3E3B0" strokeOpacity="0.55" strokeWidth="0.6" strokeLinejoin="round" />
              <path d="M7.6 12.3l2.9 2.9 5.9-6.1" fill="none" stroke="#0A0A0A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </TooltipTrigger>
        <TooltipContent className="bg-black/90 border-primary/30 text-xs">
          <span className="gold-text font-medium">Miembro IATOS Privé</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default PriveSeal;
