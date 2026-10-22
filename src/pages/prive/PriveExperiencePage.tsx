import { useParams } from "react-router-dom";
import { usePriveCatalog } from "@/lib/priveCatalogApi";
import { ExperienceDetail } from "@/components/prive/catalog/ExperienceDetail";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";

/** /prive/experiencia/:slug — ficha con fuente, fecha, estado, etiqueta con evidencia y acciones. */
export default function PriveExperiencePage() {
  const api = usePriveCatalog();
  const { slug = "" } = useParams();
  const { data, loading, locked, setLocked, error } = usePriveLoad(() => api.experience(slug), [slug]);
  const e = data?.experience;
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error}
      back={e?.destination ? `/prive/destino/${e.destination.slug}` : "/prive"} backLabel={e?.destination?.name ?? "IATOS Privé"}>
      {data?.age_locked ? (
        <p className={PRIVE.muted} role="status">Esta experiencia es solo para mayores de {data.age_policy === "21+" ? "21" : "18"} años. Confírmalo en la página del destino para verla.</p>
      ) : !data?.found || !e ? (
        <p className={PRIVE.muted} role="status">Esta experiencia no está disponible en IATOS Privé.</p>
      ) : (
        <ExperienceDetail e={e} onLocked={setLocked} />
      )}
    </PriveCatalogShell>
  );
}
