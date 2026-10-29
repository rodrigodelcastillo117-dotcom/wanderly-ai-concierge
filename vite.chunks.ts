/**
 * Reparto de node_modules en chunks "vendor" y guarda contra chunks circulares.
 *
 * Por qué existe (incidente de Smart Spend, oct 2026): en el build de producción (Lovable instala
 * con bun.lockb → rollup 4.21) `vendor-charts` importaba de `vendor-3d` y `vendor-3d` de
 * `vendor-charts`. Con un ciclo entre chunks, uno de los dos se evalúa antes de que el otro
 * termine y la pestaña Smart Spend tronaba con "TypeError: ….x is not a function". La causa:
 * la regla "d3-*" metía en las gráficas los paquetes d3 que solo usa el globo (d3-delaunay), y
 * `delaunator` —que no estaba en ningún grupo y lo piden tanto d3-delaunay como
 * three-conic-polygon-geometry— lo colocaba Rollup a su criterio: en 4.21 caía en vendor-3d, en
 * 4.24 en vendor-charts. Un build local (npm) no tenía ciclo; el de producción sí.
 *
 * Reglas que evitan que vuelva a pasar, sin importar qué versión resuelva cada lockfile:
 *  1. Cada grupo es "cerrado": sus paquetes solo dependen de paquetes del mismo grupo o de
 *     grupos anteriores en la lista. Así Rollup no tiene que decidir a dónde va nada compartido.
 *  2. Lo compartido entre las gráficas y el globo (toda la familia d3, internmap, delaunator,
 *     robust-predicates) vive en UN solo chunk hoja (`vendor-d3`) que no importa a nadie.
 *  3. El 3D (three, globe.gl, @react-three/…) ya no se fuerza a un chunk manual: solo lo usan
 *     pantallas perezosas (RouteGlobe3D, TravelAvatar3D, MultiDestRoute) y Rollup lo reparte solo.
 *  4. `chunkCycleGuard` hace FALLAR el build si dos chunks se importan entre sí (directa o
 *     transitivamente). Mejor un build rojo que una pantalla rota en producción.
 */

// Paquetes de node_modules agrupados en chunks "vendor" estables (E-23 / IATOS-103). El navegador
// los guarda en caché entre despliegues y lo pesado que solo usan algunas pantallas (gráficas,
// PDF, analítica) nunca entra al paquete inicial. EL ORDEN IMPORTA: un grupo solo puede depender
// de grupos anteriores (ver regla 1 arriba).
export const VENDOR_GROUPS: [string, (pkg: string) => boolean][] = [
  // React, el router y ayudantes diminutos que usan varias librerías a la vez. Si no se fijan
  // aquí, Rollup los mete en el primer chunk que los pide (p. ej. clsx dentro de las gráficas) y
  // el paquete inicial termina descargando las gráficas o el PDF completos.
  ["vendor-core", (p) => [
    "react", "react-dom", "scheduler", "react-router", "react-router-dom", "@remix-run/router", "use-sync-external-store",
    "clsx", "prop-types", "react-is", "object-assign", "@babel/runtime", "tslib", "tiny-invariant",
  ].includes(p)],
  ["vendor-supabase", (p) => p.startsWith("@supabase/") || p === "iceberg-js"],
  // Solo el Slot de Radix (lo usa <Button>, que está en la landing y en todas las pantallas).
  // Rendimiento (cierre 2026-10): antes TODO Radix + Floating UI iba en un solo chunk que entraba
  // al paquete inicial (≈39 KB gzip: diálogos, selects, slider, tooltip…) aunque la landing solo
  // usa el Slot. El resto de Radix se deja a Rollup: cada pantalla baja solo los componentes que
  // usa. No crea ciclos: esos paquetes solo dependen de vendor-core y de este grupo, que no
  // importa a nadie fuera de vendor-core (regla 1); la guarda de abajo lo comprueba en cada build.
  ["vendor-radix", (p) => ["@radix-ui/react-slot", "@radix-ui/react-compose-refs"].includes(p)],
  // Íconos de lucide (Rendimiento, cierre 2026-10): cada ícono que comparten varias pantallas salía
  // en su propio archivo de ~1 KB (67 archivos, ~22 KB gzip sumando la cabecera de cada uno). Juntos
  // pesan ~8 KB gzip y se descargan una vez: el inicio pasa de ~51 a ~20 archivos JS.
  ["vendor-icons", (p) => p === "lucide-react"],
  ["vendor-motion", (p) => ["framer-motion", "motion-dom", "motion-utils"].includes(p)],
  // Hoja compartida por las gráficas (recharts) y el globo (three-globe): la familia d3 completa y
  // sus únicas dependencias. Ningún paquete de aquí importa algo fuera de este grupo.
  ["vendor-d3", (p) => p.startsWith("d3-") || ["internmap", "delaunator", "robust-predicates"].includes(p)],
  // recharts y TODO lo que importa (además de vendor-core y vendor-d3).
  ["vendor-charts", (p) => [
    "recharts", "recharts-scale", "react-smooth", "victory-vendor", "decimal.js-light",
    "lodash", "eventemitter3", "fast-equals", "react-transition-group", "dom-helpers",
  ].includes(p)],
  // Opcionales de jsPDF que jsPDF solo pide con import() dinámico (.html() y SVG). Ninguna pantalla los
  // usa (tripPdf y priveEditionPdf solo escriben texto y tablas), así que en su propio chunk no se bajan
  // al generar el PDF: vendor-pdf pasa de 774 KB a 389 KB (240 → 128 KB gzip; ronda 3, P2-8). Hojas cerradas: sus
  // paquetes solo dependen de su grupo o de vendor-core.
  ["vendor-pdf-html", (p) => [
    "html2canvas", "css-line-break", "text-segmentation", "utrie", "base64-arraybuffer", "dompurify",
  ].includes(p)],
  ["vendor-pdf-svg", (p) => [
    "canvg", "core-js", "performance-now", "raf", "rgbcolor", "stackblur-canvas", "svg-pathdata", "regenerator-runtime",
  ].includes(p)],
  // jsPDF y lo que importa de forma estática (la tabla, la compresión y PNG).
  ["vendor-pdf", (p) => [
    "jspdf", "jspdf-autotable", "fflate", "fast-png", "iobuffer", "pako",
  ].includes(p)],
  // preact solo: lo usan el globo de /dashboard/ruta (globe.gl → float-tooltip), PostHog y el widget de
  // Sentry. Estaba dentro de vendor-posthog y el globo descargaba 115 KB gzip de PostHog con la analítica
  // apagada; ahora baja 4.5 KB gzip (ronda 3, P2-8). Hoja: preact no depende de nada.
  ["vendor-preact", (p) => p === "preact"],
  ["vendor-posthog", (p) => p === "posthog-js" || p.startsWith("@posthog/") || [
    "query-selector-shadow-dom", "web-vitals", "web-vitals-soft-navs",
  ].includes(p)],
  ["vendor-sentry", (p) => p.startsWith("@sentry/") || p.startsWith("@sentry-internal/")],
];

/** Nombre del paquete de node_modules al que pertenece un id de módulo ("@scope/pkg" o "pkg"). */
export function packageOf(id: string): string | undefined {
  const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id.replace(/\\/g, "/"));
  return m?.[1];
}

export function vendorChunk(id: string): string | undefined {
  // Ayudantes que inyecta Vite/Rollup (precarga de import(), interop CommonJS).
  if (/vite\/preload-helper|commonjsHelpers|vite\/modulepreload-polyfill/.test(id)) return "vendor-core";
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  return VENDOR_GROUPS.find(([, test]) => test(pkg))?.[0];
}

/** Lo mínimo de un chunk del bundle de Rollup que necesita la revisión del grafo. */
export type ChunkLike =
  | { type: "chunk"; fileName: string; imports: string[]; name?: string; modules?: Record<string, unknown> }
  | { type: "asset"; fileName: string };

/**
 * Paquetes que no están en ningún grupo pero Rollup metió en un chunk vendor-* (lo arrastró por ser
 * dependencia). No es un error en sí, pero es justo el tipo de decisión que cambia entre versiones
 * de Rollup: conviene asignarlos a su grupo para que el reparto sea fijo.
 */
export function unassignedInVendorChunks(bundle: Record<string, ChunkLike>): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const item of Object.values(bundle)) {
    if (item.type !== "chunk" || !item.name?.startsWith("vendor-")) continue;
    for (const id of Object.keys(item.modules ?? {})) {
      const pkg = packageOf(id);
      if (pkg && !vendorChunk(id)) (out[item.name] ??= new Set()).add(pkg);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

/**
 * Ciclos de importación ESTÁTICA entre chunks (los import() dinámicos no cuentan: se evalúan
 * después). Devuelve cada ciclo como lista de archivos, p. ej. [a.js, b.js, a.js]. Vacío = sano.
 */
export function findChunkCycles(bundle: Record<string, ChunkLike>): string[][] {
  const graph = new Map<string, string[]>();
  for (const item of Object.values(bundle)) {
    if (item.type === "chunk") graph.set(item.fileName, item.imports.filter((f) => f !== item.fileName));
  }
  const cycles: string[][] = [];
  const seen = new Set<string>();
  // DFS con colores (blanco/gris/negro); cada arista "hacia atrás" a un nodo gris es un ciclo.
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      if (!graph.has(m)) continue;
      const s = state.get(m);
      if (s === 1) {
        const cyc = [...stack.slice(stack.indexOf(m)), m];
        const key = [...cyc.slice(0, -1)].sort().join("|");
        if (!seen.has(key)) { seen.add(key); cycles.push(cyc); }
      } else if (!s) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of [...graph.keys()].sort()) if (!state.has(n)) visit(n);
  return cycles;
}

/** Plugin de Rollup/Vite: el build falla si hay chunks que se importan entre sí. */
export function chunkCycleGuard() {
  return {
    name: "iatos-chunk-cycle-guard",
    apply: "build" as const,
    generateBundle(this: { error: (msg: string) => never; warn: (msg: string) => void }, _opts: unknown, bundle: Record<string, ChunkLike>) {
      const loose = unassignedInVendorChunks(bundle);
      for (const [chunk, pkgs] of Object.entries(loose)) {
        this.warn(`${chunk} incluye paquetes sin grupo en VENDOR_GROUPS (asígnalos para un reparto estable): ${pkgs.join(", ")}`);
      }
      const cycles = findChunkCycles(bundle);
      if (cycles.length) {
        this.error(
          "Chunks circulares en el build (en el navegador esto rompe pantallas con " +
            "\"x is not a function\"). Revisa VENDOR_GROUPS en vite.chunks.ts:\n" +
            cycles.map((c) => "  " + c.join(" → ")).join("\n"),
        );
      }
    },
  };
}
