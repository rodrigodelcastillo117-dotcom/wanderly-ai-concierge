// Mapa del mundo de Explorar (pestaña "Mapa"). Sin librería de mapas: teselas WMTS de NASA GIBS en Web
// Mercator, el mismo enfoque que el radar de lluvia de Clima (otro equipo, rama claude/total-clima, 23-oct-2026:
// teselas de GIBS con imágenes y proyección propia; en origin/main no hay Leaflet ni MapLibre). Capa: VIIRS Black
// Marble (luces de la Tierra de noche), oscura como Privé.
// Fuente y términos (consultados el 23-oct-2026): https://nasa-gibs.github.io/gibs-api-docs/access-basics/ ·
// datos de la NASA sin licencia propia = CC0, uso comercial permitido, citar a la NASA y no sugerir respaldo:
// https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance
//
// Accesible: el mapa se mueve con flechas y se acerca con + / − cuando tiene el foco; los puntos son un
// complemento visual (aria-hidden) y la misma información, operable con teclado y lector de pantalla, está en
// la lista de destinos que acompaña al mapa.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { Globe2, Minus, Plus } from "lucide-react";
import { clusterPoints, project, TILE, type SeasonKind } from "@/lib/priveExplore";
import { usePriveT } from "@/components/prive/PriveLang";

export const GIBS_TILE = (z: number, x: number, y: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
const MAX_TILE_Z = 8;
const MAX_Z = 7;

export type MapPin = { slug: string; name: string; lat: number; lng: number; kind: SeasonKind; events: number; dim?: boolean };

type View = { z: number; cx: number; cy: number }; // centro en coordenadas del mundo normalizadas (0–1)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap01 = (v: number) => ((v % 1) + 1) % 1;

/**
 * Vista inicial: el alto muestra la franja habitada (la mitad del mundo en Mercator, ≈ 70° N a 50° S) y, si cabe,
 * el mundo entero a lo ancho con el corte en el Pacífico. En un teléfono (angosto) se centra en las Américas y
 * Europa, donde está la mayoría de los destinos; lo demás queda a un deslizamiento.
 */
export function initialView(w: number, h: number): View {
  const z = clamp(Math.max(Math.log2(w / TILE), Math.log2(h / (TILE * 0.5))), 0.5, MAX_Z);
  const lng = w < 600 ? -30 : 10;
  return { z, cx: project({ lat: 0, lng }, 0).x / TILE, cy: clampCy(project({ lat: 26, lng: 0 }, 0).y / TILE, z, h) };
}

/** El centro vertical nunca deja ver más allá del borde norte o sur del mundo. */
function clampCy(cy: number, z: number, h: number): number {
  const half = h / 2 / (TILE * 2 ** z);
  return half >= 0.5 ? 0.5 : clamp(cy, half, 1 - half);
}

export function WorldMap({ pins, selected, onSelect, label, describedBy }: {
  pins: MapPin[];
  selected: string | null;
  onSelect: (slug: string) => void;
  label: string;
  describedBy?: string;
}) {
  const t = usePriveT();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 440 });
  const [view, setView] = useState<View | null>(null);
  const [dragging, setDragging] = useState(false);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinch?: number } | null>(null);

  // Tamaño real del contenedor (en pruebas sin diseño queda el respaldo 360×440).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height }); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const v = view ?? initialView(size.w, size.h);
  const minZ = clamp(Math.max(Math.log2(size.w / TILE), Math.log2(size.h / TILE)), 0.5, MAX_Z);

  const zoomAt = useCallback((dz: number, px?: number, py?: number) => {
    setView((cur) => {
      const c = cur ?? initialView(size.w, size.h);
      const z = clamp(c.z + dz, minZ, MAX_Z);
      const world = TILE * 2 ** c.z, nworld = TILE * 2 ** z;
      const ox = (px ?? size.w / 2) - size.w / 2, oy = (py ?? size.h / 2) - size.h / 2;
      // El punto bajo el cursor se queda bajo el cursor.
      const wx = c.cx + ox / world, wy = c.cy + oy / world;
      return { z, cx: wrap01(wx - ox / nworld), cy: clampCy(wy - oy / nworld, z, size.h) };
    });
  }, [size, minZ]);
  const panBy = useCallback((dx: number, dy: number) => {
    setView((cur) => {
      const c = cur ?? initialView(size.w, size.h);
      const world = TILE * 2 ** c.z;
      return { ...c, cx: wrap01(c.cx - dx / world), cy: clampCy(c.cy - dy / world, c.z, size.h) };
    });
  }, [size]);
  const reset = () => setView(null);

  // Ctrl/⌘ + rueda (o pellizco del trackpad) acerca; la rueda sola desplaza la página como siempre.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(-e.deltaY * 0.01, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    gesture.current = { moved: false };
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    const next = { x: e.clientX, y: e.clientY };
    ptrs.current.set(e.pointerId, next);
    if (ptrs.current.size === 2 && gesture.current.pinch) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = box.current!.getBoundingClientRect();
      zoomAt(Math.log2(d / gesture.current.pinch), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      gesture.current.pinch = d;
      gesture.current.moved = true;
      return;
    }
    const dx = next.x - prev.x, dy = next.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      if (!gesture.current.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      gesture.current.moved = true;
      setDragging(true);
      panBy(dx, dy);
    }
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2 && gesture.current) gesture.current.pinch = undefined;
    if (ptrs.current.size === 0) { setDragging(false); gesture.current = null; }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 80;
    const map: Record<string, () => void> = {
      ArrowLeft: () => panBy(step, 0), ArrowRight: () => panBy(-step, 0), ArrowUp: () => panBy(0, step), ArrowDown: () => panBy(0, -step),
      "+": () => zoomAt(0.75), "=": () => zoomAt(0.75), "-": () => zoomAt(-0.75), "_": () => zoomAt(-0.75), "0": reset,
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };

  // Teselas visibles (con el mundo repetido a lo ancho).
  const tz = clamp(Math.round(v.z), 0, MAX_TILE_Z);
  const scale = 2 ** (v.z - tz);
  const ts = TILE * scale;
  const n = 2 ** tz;
  const world = TILE * 2 ** v.z;
  const originX = size.w / 2 - v.cx * world, originY = size.h / 2 - v.cy * world;
  const tiles = useMemo(() => {
    const out: { key: string; src: string; left: number; top: number }[] = [];
    const x0 = Math.floor(-originX / ts), x1 = Math.floor((size.w - originX) / ts);
    const y0 = Math.max(0, Math.floor(-originY / ts)), y1 = Math.min(n - 1, Math.floor((size.h - originY) / ts));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const wx = ((x % n) + n) % n;
      out.push({ key: `${tz}-${x}-${y}`, src: GIBS_TILE(tz, wx, y), left: originX + x * ts, top: originY + y * ts });
    }
    return out;
  }, [originX, originY, ts, n, tz, size.w, size.h]);

  // Puntos y grupos en píxeles de pantalla (copias del mundo a izquierda y derecha).
  const groups = useMemo(() => {
    const pts = pins.map((p) => {
      const w = project(p, v.z);
      let x = originX + w.x;
      while (x < -world / 2) x += world;
      while (x > size.w + world / 2) x -= world;
      return { slug: p.slug, x, y: originY + w.y };
    });
    const radius = v.z < 2.2 ? 30 : 26;
    const inView = pts.filter((p) => p.x > -40 && p.x < size.w + 40 && p.y > -40 && p.y < size.h + 40);
    // El destino abierto nunca se esconde dentro de un grupo: va aparte, con su nombre.
    const sel = inView.filter((p) => p.slug === selected).map((p) => ({ key: p.slug, x: p.x, y: p.y, slugs: [p.slug] }));
    return [...clusterPoints(inView.filter((p) => p.slug !== selected), radius), ...sel];
  }, [pins, v.z, originX, originY, world, size.w, size.h, selected]);
  const bySlug = useMemo(() => new Map(pins.map((p) => [p.slug, p])), [pins]);
  const showLabels = v.z >= 3.2;

  return (
    <div ref={box} className={`pv-map ${dragging ? "is-dragging" : ""}`} role="region" aria-roledescription={t.explore.tabMap}
      aria-label={label} aria-describedby={describedBy} tabIndex={0} data-testid="prive-world-map" data-zoom={v.z.toFixed(2)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); zoomAt(1, e.clientX - r.left, e.clientY - r.top); }}
      onKeyDown={onKey}>
      <div className="pv-map-tiles" aria-hidden="true">
        {tiles.map((x) => (
          <img key={x.key} src={x.src} alt="" draggable={false} decoding="async" loading="lazy" referrerPolicy="no-referrer"
            style={{ left: x.left, top: x.top, width: ts + 0.5, height: ts + 0.5 }} />
        ))}
      </div>
      <div className="pv-map-pins" aria-hidden="true">
        {groups.map((g) => {
          if (g.slugs.length > 1) {
            const good = g.slugs.some((s) => { const k = bySlug.get(s)?.kind; return k === "good" || k === "snow"; });
            return (
              <button key={g.key} type="button" tabIndex={-1} className="pv-cluster" data-good={good ? 1 : 0} data-testid="prive-map-cluster"
                style={{ left: g.x, top: g.y }} aria-label={t.map.cluster(g.slugs.length)}
                onClick={() => setView((cur) => {
                  const c = cur ?? v;
                  const z = clamp(c.z + 1.4, minZ, MAX_Z);
                  const wpx = TILE * 2 ** c.z;
                  return { z, cx: wrap01(c.cx + (g.x - size.w / 2) / wpx), cy: clampCy(c.cy + (g.y - size.h / 2) / wpx, z, size.h) };
                })}>
                {g.slugs.length}
              </button>
            );
          }
          const p = bySlug.get(g.slugs[0])!;
          const sel = selected === p.slug;
          return (
            <button key={g.key} type="button" tabIndex={-1} className="pv-pin" data-kind={p.kind} data-events={p.events ? 1 : 0} data-slug={p.slug}
              data-testid="prive-map-pin" aria-pressed={sel} aria-label={p.name} style={{ left: g.x, top: g.y, opacity: p.dim ? 0.45 : 1 }}
              onClick={() => onSelect(p.slug)}>
              <i />
              {(sel || (showLabels && (p.kind === "good" || p.kind === "snow" || p.events > 0))) && <span className="pv-pin-label">{p.name}</span>}
            </button>
          );
        })}
      </div>
      <div className="pv-map-ctrl">
        <button type="button" onClick={() => zoomAt(0.75)} aria-label={t.map.zoomIn}><Plus className="w-4 h-4" aria-hidden="true" /></button>
        <button type="button" onClick={() => zoomAt(-0.75)} aria-label={t.map.zoomOut}><Minus className="w-4 h-4" aria-hidden="true" /></button>
        <button type="button" onClick={reset} aria-label={t.map.reset}><Globe2 className="w-4 h-4" aria-hidden="true" /></button>
      </div>
      <p className="pv-map-credit">
        <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noopener noreferrer">{t.map.mapCredit}</a>
      </p>
    </div>
  );
}

export default WorldMap;
