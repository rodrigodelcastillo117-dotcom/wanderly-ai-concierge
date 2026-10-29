/**
 * Precarga de la pantalla inicial desde el HTML (Rendimiento, cierre 2026-10).
 *
 * La app es una SPA con un solo index.html: el navegador baja el paquete inicial, lo ejecuta y solo
 * entonces React pide el chunk de la ruta (DashboardHome, TripDetail…) y sus dependencias. En 3G
 * eso dejaba ~2 s de red sin usar para la pantalla que el usuario abrió. Este plugin agrega al
 * index.html un script mínimo (en línea, sin dependencias) que, según la URL con la que se abre la
 * app, pide con <link rel="modulepreload"> el chunk de esa pantalla y todo lo que importa de forma
 * estática, en paralelo con el paquete inicial. Si la ruta no está en la tabla, no hace nada.
 *
 * La tabla vive aquí (Node, para el build) y App.tsx tiene la misma lista para el import() en
 * tiempo de ejecución; src/test/rendimientoBundle.test.ts comprueba que coinciden.
 */

/** Imagen principal de la pantalla (candidata a LCP) que se conoce sin datos: [archivo de src/assets, ancho]. */
export type ImageHint = { srcset: [string, number][]; sizes: string };

/** [regex de la ruta (fuente), módulo de la página relativo a la raíz, imagen principal opcional]. */
export const INITIAL_ROUTE_PAGES: [string, string, ImageHint?][] = [
  // El hero del inicio (DashboardHome: HERO_REELS[0] + SANTORINI_SRCSET, mismos sizes) se pinta
  // desde el primer render, con o sin datos.
  ["^/dashboard/?$", "src/pages/DashboardHome.tsx", { srcset: [["hero-santorini-960.jpg", 960], ["hero-santorini.jpg", 1920]], sizes: "(min-width: 768px) 100vw, 320px" }],
  ["^/dashboard/viajes/?$", "src/pages/Trips.tsx"],
  ["^/dashboard/viajes/[^/]+/?$", "src/pages/TripDetail.tsx"],
  ["^/dashboard/concierge/?$", "src/pages/Concierge.tsx"],
  ["^/auth/?$", "src/pages/Auth.tsx"],
  ["^/(ayuda|terminos|privacidad|cookies|reembolsos)/?$", "src/pages/Legal.tsx"],
];

type Chunk = { type: "chunk"; fileName: string; imports: string[]; facadeModuleId?: string | null; isEntry?: boolean };
type Asset = { type: "asset"; fileName: string; name?: string; names?: string[] };
export type BundleLike = Record<string, Chunk | Asset>;

const norm = (p: string) => p.replace(/\\/g, "/");

export type RoutePreload = [string, string[], { srcset: string; sizes: string }?];

/** Archivos que necesita cada ruta además del paquete inicial (chunk de la página + imports estáticos). */
export function routePreloadMap(bundle: BundleLike, base = "/"): RoutePreload[] {
  const chunks = Object.values(bundle).filter((c): c is Chunk => c.type === "chunk");
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const closure = (roots: string[]) => {
    const seen = new Set<string>();
    const stack = [...roots];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      stack.push(...(byFile.get(f)?.imports ?? []));
    }
    return seen;
  };
  const initial = closure(chunks.filter((c) => c.isEntry).map((c) => c.fileName));
  const assets = Object.values(bundle).filter((a): a is Asset => a.type === "asset");
  const assetFile = (name: string) => assets.find((a) => a.name === name || a.names?.includes(name))?.fileName;
  const out: RoutePreload[] = [];
  for (const [re, page, image] of INITIAL_ROUTE_PAGES) {
    const chunk = chunks.find((c) => c.facadeModuleId && norm(c.facadeModuleId).endsWith(`/${page}`));
    if (!chunk) continue;
    const files = [...closure([chunk.fileName])].filter((f) => !initial.has(f));
    // La página primero (es la que más tarda en ejecutarse), luego sus dependencias.
    files.sort((a, b) => (a === chunk.fileName ? -1 : b === chunk.fileName ? 1 : 0));
    const srcset = image?.srcset.map(([name, w]) => { const f = assetFile(name); return f ? `${base}${f} ${w}w` : null; });
    const img = image && srcset && srcset.every(Boolean) ? { srcset: srcset.join(", "), sizes: image.sizes } : undefined;
    out.push(img ? [re, files.map((f) => `${base}${f}`), img] : [re, files.map((f) => `${base}${f}`)]);
  }
  return out;
}

/** El script en línea (ES5, sin dependencias). */
export function routePreloadScript(map: RoutePreload[]): string {
  return `(function(){try{var m=${JSON.stringify(map)},p=location.pathname,h=document.head;for(var i=0;i<m.length;i++){if(new RegExp(m[i][0]).test(p)){var g=m[i][2];if(g){var x=document.createElement("link");x.rel="preload";x.as="image";x.setAttribute("imagesrcset",g.srcset);x.setAttribute("imagesizes",g.sizes);x.fetchPriority="high";h.appendChild(x);}var f=m[i][1];for(var j=0;j<f.length;j++){var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.fetchPriority="high";l.href=f[j];h.appendChild(l);}return;}}}catch(e){}})();`;
}

export function routePreloadHints() {
  return {
    name: "iatos-route-preload",
    apply: "build" as const,
    transformIndexHtml: {
      order: "post" as const,
      handler(_html: string, ctx: { bundle?: BundleLike }) {
        if (!ctx.bundle) return [];
        const map = routePreloadMap(ctx.bundle);
        if (!map.length) return [];
        return [{ tag: "script", children: routePreloadScript(map), injectTo: "head" as const }];
      },
    },
  };
}
