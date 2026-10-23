import { Link } from "react-router-dom";
import { Crown } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { conciergeHeaderCopy } from "@/lib/planCopy";
import { PRO_PATH } from "@/lib/functionErrors";

/**
 * Encabezado del Concierge según el plan real (get_access_state vía useSubscription): a una
 * cuenta gratis ya no le dice "Concierge PRO te escucha".
 */
export function ConciergeHeading({ compact = false }: { compact?: boolean }) {
  const { loading, isPro, isTrialing, trialDaysLeft, access } = useSubscription();
  const c = conciergeHeaderCopy({
    loading,
    isPro,
    isTrialing,
    trialDaysLeft,
    remaining: access?.concierge_remaining ?? null,
    limit: access?.concierge_limit ?? null,
  });
  if (compact) {
    // Chat estilo WhatsApp: título en una línea y el aviso del plan debajo, sin la franja superior.
    return (
      <>
        <h1 className="font-display text-base md:text-xl leading-tight truncate flex items-center gap-1.5">
          <Crown className="hidden sm:block w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" /> <span className="truncate">{c.title}</span>
        </h1>
        {c.note && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            {c.note}
            {c.showUpgrade && (
              <>
                {" "}
                <Link to={PRO_PATH} className="text-primary underline underline-offset-2 hover:opacity-80">Conoce PRO</Link>
              </>
            )}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <p className="text-[11px] tracking-[0.3em] text-primary uppercase mb-1 flex items-center gap-2">
        <Crown className="w-3 h-3" aria-hidden="true" /> {c.eyebrow}
      </p>
      <h1 className="font-display text-2xl md:text-3xl leading-tight">{c.title}</h1>
      {c.note && (
        <p className="text-xs text-muted-foreground mt-1">
          {c.note}
          {c.showUpgrade && (
            <>
              {" "}
              <Link to={PRO_PATH} className="text-primary underline underline-offset-2 hover:opacity-80">Conoce PRO</Link>
            </>
          )}
        </p>
      )}
    </>
  );
}
