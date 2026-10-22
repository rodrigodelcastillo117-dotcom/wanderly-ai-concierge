import { useState } from "react";
import { Button } from "@/components/ui/button";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { shortDate } from "@/lib/priveCatalogView";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";

/** /prive/solicitudes — historial honesto: solo lo confirmado por el proveedor dice "Confirmado". */
export default function PriveRequestsPage() {
  const api = usePriveCatalog();
  const { data, loading, locked, error, reload } = usePriveLoad(() => api.myRequests(), []);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}>
      <h1 className={`${PRIVE.serif} text-3xl`}>Mis solicitudes Privé</h1>
      {!data?.length ? (
        <p className={`text-sm ${PRIVE.muted}`} role="status">Aún no has hecho solicitudes. Desde una ficha, toca "Solicitar con Iato".</p>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className={`${PRIVE.card} space-y-1 p-4`} data-testid="prive-request">
              <p className="font-medium">{r.title}</p>
              <p className={`text-sm ${r.is_confirmed ? "text-emerald-300" : PRIVE.muted}`}>
                {r.status_text}{r.is_confirmed && r.confirmation_code ? ` · folio ${r.confirmation_code}` : ""}
              </p>
              <p className={`text-xs ${PRIVE.muted}`}>Pedida el {shortDate(r.created_at)}{r.requested_for ? ` · para el ${shortDate(r.requested_for)}` : ""}{r.party_size ? ` · ${r.party_size} personas` : ""}</p>
              {["solicitado", "pendiente_confirmacion", "confirmado_externamente"].includes(r.status) && (
                <Button size="sm" variant="outline" className={PRIVE.ghost} disabled={busy === r.id} onClick={async () => {
                  setBusy(r.id);
                  try { await api.cancelRequest(r.id); reload(); } finally { setBusy(null); }
                }}>Cancelar solicitud</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </PriveCatalogShell>
  );
}
