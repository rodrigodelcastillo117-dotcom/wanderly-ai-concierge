import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { PRIVE } from "./theme";
import { usePriveT } from "@/components/prive/PriveLang";

/** Declaración 18+ (versión de términos vigente). Hasta confirmarla, lo 18+/21+ no se muestra. */
export function AgeGate({ count, termsVersion, onConfirmed }: { count: number; termsVersion: string; onConfirmed: () => void }) {
  const api = usePriveCatalog();
  const A = usePriveT().catalog.age;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!count) return null;
  return (
    <div className={`${PRIVE.card} space-y-2 p-4`} data-testid="prive-age-gate">
      <p className="text-sm">{A.gateCount(count)}</p>
      <p className={`text-xs ${PRIVE.muted}`}>{A.gateHint}</p>
      {error && <p className="text-xs text-amber-300" role="alert">{error}</p>}
      {/* A 390 px el texto en mayúsculas espaciadas no cabe en una línea: se parte en vez de salirse del panel. */}
      <Button size="sm" className={`${PRIVE.button} h-auto min-h-[44px] w-full whitespace-normal py-3 text-center leading-snug sm:w-auto`} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const ok = await api.confirmAdult(termsVersion);
          if (ok) onConfirmed(); else setError(A.gateError);
        } catch { setError(A.gateError); } finally { setBusy(false); }
      }}>{A.gateButton}</Button>
    </div>
  );
}
