// Secciones del catálogo dentro del hub de Privé (PRIVE_HUB_SECTIONS del grupo ui). Una sola llamada
// (prive_home, con sesión Privé): destinos con contenido verificado o curado y conteos por universo.
// Si todavía no hay nada publicable, devuelve null y el hub sigue diciendo "Contenido en curaduría".
// La presentación (búsqueda, destacados, una región a la vez, colecciones) vive en DestinationBrowser.
import type { PriveHubSection } from "@/components/prive/PriveCatalogSlot";
import { DestinationBrowser, type CatalogHomeData } from "@/components/prive/catalog/DestinationBrowser";

/** Compatibilidad: el nombre que ya usaban pruebas y documentos. */
export const CatalogHome = DestinationBrowser;

export const CATALOG_HUB_SECTIONS: PriveHubSection[] = [
  {
    id: "catalogo",
    title: (t) => t.hub.selectionByDestination,
    rpc: "prive_home",
    render: (data) => {
      const d = data as CatalogHomeData | null;
      if (!d || !Array.isArray(d.destinations) || !(d.total > 0)) return null;
      return <DestinationBrowser data={{ ...d, universes: Array.isArray(d.universes) ? d.universes : [] }} />;
    },
  },
];
