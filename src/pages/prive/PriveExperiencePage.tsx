import { useParams } from "react-router-dom";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { ExperienceDetail } from "@/components/prive/catalog/ExperienceDetail";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { MoreInDestination } from "@/components/prive/catalog/MoreInDestination";
import { displayName } from "@/lib/priveBrowse";

/** /prive/experiencia/:slug — ficha con fuente, fecha, estado, etiqueta con evidencia y acciones. */
export default function PriveExperiencePage() {
  const api = usePriveCatalog();
  const t = usePriveT();
  const lang = usePriveLang();
  const { slug = "" } = useParams();
  const { data, loading, locked, setLocked, error } = usePriveLoad(() => api.experience(slug), [slug]);
  const e = data?.experience;
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}
      back={e?.destination ? `/prive/destino/${e.destination.slug}` : "/prive"} backLabel={e?.destination ? displayName(e.destination, lang) : "IATOS Privé"}>
      {data?.age_locked ? (
        <p className={PRIVE.muted} role="status">{t.catalog.ageLocked(data.age_policy === "21+" ? "21" : "18")}</p>
      ) : !data?.found || !e ? (
        <p className={PRIVE.muted} role="status">{t.catalog.expNotFound}</p>
      ) : (
        <div className="space-y-16">
          <ExperienceDetail e={e} onLocked={setLocked} />
          {e.destination && <MoreInDestination slug={e.destination.slug} city={displayName(e.destination, lang)} excludeId={e.id} />}
        </div>
      )}
    </PriveCatalogShell>
  );
}
