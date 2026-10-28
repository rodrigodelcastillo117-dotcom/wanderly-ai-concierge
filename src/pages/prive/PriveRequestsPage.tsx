import { useState } from "react";
import { Link } from "react-router-dom";
import { usePriveAccessOptional } from "@/hooks/priveAccessContext";
import { Button } from "@/components/ui/button";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { shortDate } from "@/lib/priveCatalogView";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";

/** /prive/solicitudes — historial honesto: solo lo confirmado por el proveedor dice "Confirmado". */
export default function PriveRequestsPage() {
  const api = usePriveCatalog();
  const lang = usePriveLang();
  const R = usePriveT().catalog.requests;
  const { data, loading, locked, error, reload } = usePriveLoad(() => api.myRequests(), []);
  const [busy, setBusy] = useState<string | null>(null);
  // El vacío dice algo útil según la cuenta: a un miembro, dónde se pide; a quien aún no entra a Privé, por
  // qué no tiene solicitudes (las fichas no se le abren) y dónde ver su estado (auditoría 28-oct, P2).
  const member = usePriveAccessOptional()?.view === "unlocked";
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}>
      <h1 className={`${PRIVE.serif} text-3xl`}>{R.title}</h1>
      {!data?.length ? (
        <div className="space-y-3" role="status" data-testid="prive-requests-empty">
          <p className={`text-sm ${PRIVE.muted}`}>{member ? R.empty : R.emptyLocked}</p>
          <Link to={member ? "/prive/explorar" : "/prive"} className="prive-link text-sm">{member ? R.goExplore : R.seeStatus}</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className={`${PRIVE.card} space-y-1 p-4`} data-testid="prive-request">
              <p className="font-medium">{r.title}</p>
              <p className={`text-sm ${r.is_confirmed ? "text-emerald-300" : PRIVE.muted}`}>
                {r.status_text}{r.is_confirmed && r.confirmation_code ? R.folio(r.confirmation_code) : ""}
              </p>
              <p className={`text-xs ${PRIVE.muted}`}>{R.requestedOn(shortDate(r.created_at, lang))}{r.requested_for ? R.requestedFor(shortDate(r.requested_for, lang)) : ""}{r.party_size ? R.people(r.party_size) : ""}</p>
              {["solicitado", "pendiente_confirmacion", "confirmado_externamente"].includes(r.status) && (
                <Button size="sm" variant="outline" className={PRIVE.ghost} disabled={busy === r.id} onClick={async () => {
                  setBusy(r.id);
                  try { await api.cancelRequest(r.id); reload(); } finally { setBusy(null); }
                }}>{R.cancel}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </PriveCatalogShell>
  );
}
