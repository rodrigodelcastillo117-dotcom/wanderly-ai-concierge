// Secciones del catálogo dentro del hub de Privé (PRIVE_HUB_SECTIONS del grupo ui). Una sola llamada
// (prive_home, con sesión Privé): destinos con contenido verificado o curado y conteos por universo.
// Si todavía no hay nada publicable, devuelve null y el hub sigue diciendo "Contenido en curaduría".
// La presentación (búsqueda, destacados, una región a la vez, colecciones) vive en DestinationBrowser.
import type { PriveHubSection } from "@/components/prive/PriveCatalogSlot";
import { DestinationBrowser, type CatalogHomeData } from "@/components/prive/catalog/DestinationBrowser";
import { PriveHomeProvider } from "@/components/prive/home/context";
import { ForYouHome } from "@/components/prive/home/ForYouHome";

/** Compatibilidad: el nombre que ya usaban pruebas y documentos. */
export const CatalogHome = DestinationBrowser;

export const CATALOG_HUB_SECTIONS: PriveHubSection[] = [
  {
    id: "catalogo",
    // Sin título visible: la portada del hub ya presenta la selección (el lector de pantalla sí lo oye).
    title: "",
    ariaLabel: (t) => t.hub.selectionByDestination,
    rpc: "prive_home",
    render: (data) => {
      const d = data as CatalogHomeData | null;
      if (!d || !Array.isArray(d.destinations) || !(d.total > 0)) return null;
      // FOR YOU (prive-ux): portada con búsqueda universal, ranuras de privekey/privevalor y colecciones.
      return <PriveHomeProvider data={{ ...d, universes: Array.isArray(d.universes) ? d.universes : [] }}><ForYouHome /></PriveHomeProvider>;
    },
  },
];
