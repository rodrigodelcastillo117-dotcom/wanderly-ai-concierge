import { useParams, useSearchParams } from "react-router-dom";
import { usePriveCatalog, type PriveUniverse } from "@/lib/priveCatalogApi";
import { universeMeta } from "@/lib/priveCatalogView";
import { AgeGate } from "@/components/prive/catalog/AgeGate";
import { ExperienceCard } from "@/components/prive/catalog/ExperienceCard";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";

/** /prive/universo/:key[?destino=slug] — un universo en todos los destinos (o en uno). */
export default function PriveUniversePage() {
  const api = usePriveCatalog();
  const { key = "" } = useParams();
  const [sp] = useSearchParams();
  const dest = sp.get("destino");
  const meta = universeMeta(key);
  const { data, loading, locked, error, reload } = usePriveLoad(() => api.universe(key as PriveUniverse, dest), [key, dest]);
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}>
      {!meta || !data?.found ? (
        <p className={PRIVE.muted} role="status">Ese universo no existe en IATOS Privé.</p>
      ) : (
        <div className="space-y-6">
          <header className="space-y-2">
            <p className={`text-[11px] tracking-[0.2em] ${PRIVE.gold}`}>IATOS PRIVÉ</p>
            <h1 className={`${PRIVE.serif} text-4xl`}>{meta.title}</h1>
            <p className={`text-sm ${PRIVE.muted}`}>{meta.es}</p>
            {meta.note && <p className="text-xs text-[#d8c08a]" role="note">{meta.note}</p>}
          </header>
          <AgeGate count={data.age_locked_count ?? 0} termsVersion={(data as { adult_terms_version?: string }).adult_terms_version ?? ""} onConfirmed={reload} />
          {data.experiences.length === 0 ? (
            <p className={`${PRIVE.card} p-5 text-sm ${PRIVE.muted}`} role="status">Todavía no hay experiencias verificadas en este universo.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.experiences.map((e) => <ExperienceCard key={e.id} e={e} />)}
            </div>
          )}
        </div>
      )}
    </PriveCatalogShell>
  );
}
