// Secciones del catálogo dentro del hub de Privé (PRIVE_HUB_SECTIONS del grupo ui). Una sola llamada
// (prive_home, con sesión Privé): destinos con contenido verificado o curado y conteos por universo.
// Si todavía no hay nada publicable, devuelve null y el hub sigue diciendo "Contenido en curaduría".
import { Link } from "react-router-dom";
import type { PriveHubSection } from "@/components/prive/PriveCatalogSlot";
import type { PriveCoverage, PriveUniverse } from "@/lib/priveCatalogApi";
import { COVERAGE_TEXT, UNIVERSES } from "@/lib/priveCatalogView";

type Home = {
  total: number;
  universes: { key: PriveUniverse; count: number }[];
  destinations: { slug: string; name: string; region_group: string | null; kind: string; coverage: PriveCoverage; count: number }[];
};

const GROUPS: [string, string][] = [
  ["mexico", "México"], ["europa", "Europa"], ["norteamerica", "Norteamérica"], ["medio_oriente", "Medio Oriente"],
  ["asia_oceania", "Asia y Oceanía"], ["otras_regiones", "Otras regiones"],
];

export function CatalogHome({ data }: { data: Home }) {
  const withContent = data.destinations.filter((d) => d.count > 0 && d.kind !== "neighborhood");
  const universes = data.universes.filter((u) => u.count > 0);
  return (
    <div className="space-y-8" data-testid="prive-catalog-home">
      <p className="text-sm prive-muted">
        {data.total} experiencias con fuente en {withContent.length} destinos. Cada ficha dice su estado y su fecha de revisión.
      </p>
      <nav aria-label="Universos con experiencias" className="flex flex-wrap gap-2">
        {universes.map((u) => (
          <Link key={u.key} to={`/prive/universo/${u.key}`} className="prive-btn prive-btn-ghost text-xs">
            {UNIVERSES.find((x) => x.key === u.key)?.title ?? u.key} · {u.count}
          </Link>
        ))}
      </nav>
      {GROUPS.map(([g, label]) => {
        const list = withContent.filter((d) => d.region_group === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={label}>
            <h3 className="prive-eyebrow mb-3">{label}</h3>
            <ul className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((d) => (
                <li key={d.slug}>
                  <Link to={`/prive/destino/${d.slug}`} className="prive-tile block">
                    <span className="prive-serif text-lg">{d.name}</span>
                    <span className="block text-[11px] prive-muted mt-1">{d.count} experiencias · {COVERAGE_TEXT[d.coverage]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-sm"><Link to="/prive/solicitudes" className="prive-gold underline-offset-2 hover:underline">Mis solicitudes Privé</Link></p>
    </div>
  );
}

export const CATALOG_HUB_SECTIONS: PriveHubSection[] = [
  {
    id: "catalogo",
    title: "Tu selección por destino",
    rpc: "prive_home",
    render: (data) => {
      const d = data as Home | null;
      if (!d || !Array.isArray(d.destinations) || !(d.total > 0)) return null;
      return <CatalogHome data={d} />;
    },
  },
];
