import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { PRIVE } from "./theme";

/** Declaración 18+ (versión de términos vigente). Hasta confirmarla, lo 18+/21+ no se muestra. */
export function AgeGate({ count, termsVersion, onConfirmed }: { count: number; termsVersion: string; onConfirmed: () => void }) {
  const api = usePriveCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!count) return null;
  return (
    <div className={`${PRIVE.card} space-y-2 p-4`} data-testid="prive-age-gate">
      <p className="text-sm">Hay {count} experiencia{count === 1 ? "" : "s"} solo para mayores de edad (vida nocturna o casinos).</p>
      <p className={`text-xs ${PRIVE.muted}`}>Para verlas, confirma que tienes 18 años o más. Algunos lugares piden 21+ e identificación en la puerta.</p>
      {error && <p className="text-xs text-amber-300" role="alert">{error}</p>}
      <Button size="sm" className={PRIVE.button} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const ok = await api.confirmAdult(termsVersion);
          if (ok) onConfirmed(); else setError("No se pudo registrar la confirmación. Intenta de nuevo.");
        } catch { setError("No se pudo registrar la confirmación. Intenta de nuevo."); } finally { setBusy(false); }
      }}>Confirmo que tengo 18 años o más</Button>
    </div>
  );
}
