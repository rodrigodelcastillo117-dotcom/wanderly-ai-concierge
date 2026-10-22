// prive_home realista para pruebas y capturas: los destinos EXACTOS del dueño (scripts/prive/destinations.mjs),
// en su orden, con conteos inventados para la prueba (no son datos de producción).
import { allDestinations } from "../../../scripts/prive/destinations.mjs";
import type { PriveUniverse } from "@/lib/priveCatalogApi";

type Row = { slug: string; name: string; region_group: string | null; kind: string; coverage: "PILOTO_VERIFICADO" | "COBERTURA_PARCIAL" | "DESCUBRIMIENTO_BAJO_DEMANDA" | "SIN_COBERTURA_VERIFICADA"; count: number };

export function priveHomeFixture() {
  const rows = (allDestinations() as { slug: string; name_es: string; group: string | null; kind: string; dest: boolean; sort_order: number }[])
    .filter((d) => d.dest)
    .sort((a, b) => a.sort_order - b.sort_order);
  const pilots = new Set(["cdmx", "mc", "paris", "nueva-york", "tokio", "dubai", "roma", "los-cabos"]);
  const destinations: Row[] = rows.map((d, i) => ({
    slug: d.slug,
    name: d.name_es,
    region_group: d.group,
    kind: d.kind,
    coverage: pilots.has(d.slug) ? "PILOTO_VERIFICADO" : "COBERTURA_PARCIAL",
    count: pilots.has(d.slug) ? 24 - [...pilots].indexOf(d.slug) : 2 + (i % 9),
  }));
  const universes = ["the_table", "after_dark", "casino_grand_nights", "yacht_sea", "private_stays", "iconic_events", "culture_access",
    "wellness_escape", "adventure_elite", "sport_leisure", "celebrations", "signature_mexico"].map((key, i): { key: PriveUniverse; count: number } => ({ key: key as PriveUniverse, count: i === 8 ? 0 : 40 - i * 3 }));
  const total = destinations.reduce((a, d) => a + d.count, 0);
  return { total, universes, destinations, adult_confirmed: false, adult_terms_version: "2026-10-22" };
}
