// Globo 3D de "Mi mundo" (Perfil): los países y ciudades de todos tus viajes. Dorado = ya fuiste;
// celeste = planeado (el mismo celeste de las ciudades del globo de la ruta). Se gira con el dedo, hace
// zoom y gira solo hasta que lo tocas. Pesa (three.js): solo se importa de forma diferida, cuando se ve
// (src/components/mundo/MiMundoPanel.tsx).
import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { loadCountries, pointInFeature } from "@/components/RouteGlobe3D";
import type { MundoCiudad, MundoEstado, MundoPais } from "@/lib/miMundo";

export const MUNDO_COLORES = {
  hecho: { cap: "rgba(201, 169, 97, 0.62)", side: "rgba(201, 169, 97, 0.35)", stroke: "#f5e6a8", punto: "#e9cf8f" },
  planeado: { cap: "rgba(127, 212, 255, 0.26)", side: "rgba(127, 212, 255, 0.18)", stroke: "#bff0ff", punto: "#7fd4ff" },
} as const;

// Natural Earth (110m) deja ISO_A2 = "-99" en Francia y Noruega.
const ISO_FIX: Record<string, string> = { France: "FR", Norway: "NO" };
function featureIso2(f: any): string | null {
  const p = f?.properties ?? {};
  for (const v of [p.ISO_A2, p.WB_A2]) if (typeof v === "string" && /^[A-Z]{2}$/.test(v)) return v;
  return ISO_FIX[p.ADMIN] ?? null;
}

type Props = { ciudades: MundoCiudad[]; paises: MundoPais[]; height?: number };

export function WorldGlobe3D({ ciudades, paises, height = 340 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [width, setWidth] = useState(340);
  const [countries, setCountries] = useState<any[]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const set = () => setWidth(Math.max(260, el.clientWidth || 340));
    set();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", set);
      return () => window.removeEventListener("resize", set);
    }
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCountries().then((f) => { if (!cancelled) setCountries(f); });
    return () => { cancelled = true; };
  }, []);

  // Estado de cada polígono: por ISO del país de tus viajes y, si no, porque una de tus ciudades cae dentro.
  const estadoDe = useMemo(() => {
    const byIso = new Map<string, MundoEstado>();
    for (const p of paises) if (p.iso2) byIso.set(p.iso2, p.estado);
    const out = new Map<any, MundoEstado>();
    for (const f of countries) {
      const iso = featureIso2(f);
      let e: MundoEstado | undefined = iso ? byIso.get(iso) : undefined;
      if (!e) {
        for (const c of ciudades) {
          if (pointInFeature(c.lng, c.lat, f)) { e = c.estado === "hecho" || e === "hecho" ? "hecho" : "planeado"; if (e === "hecho") break; }
        }
      }
      if (e) out.set(f, e);
    }
    return out;
  }, [countries, paises, ciudades]);

  useEffect(() => {
    const g = globeRef.current;
    const controls = g?.controls?.();
    if (!controls) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.enableZoom = true;
    const stop = () => { controls.autoRotate = false; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener?.("start", stop);
  }, [countries.length]);

  // Vista inicial: el centro de tus ciudades ya visitadas (o de todas).
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !ciudades.length) return;
    const base = ciudades.some((c) => c.estado === "hecho") ? ciudades.filter((c) => c.estado === "hecho") : ciudades;
    const lat = base.reduce((s, c) => s + c.lat, 0) / base.length;
    const lng = base.reduce((s, c) => s + c.lng, 0) / base.length;
    g.pointOfView({ lat, lng, altitude: 2.3 }, 0);
  }, [ciudades]);

  const color = (d: any, k: "cap" | "side" | "stroke") => {
    const e = estadoDe.get(d);
    if (e) return MUNDO_COLORES[e][k];
    return k === "cap" ? "rgba(255, 255, 255, 0.02)" : k === "side" ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 0.16)";
  };

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ height }} data-testid="mi-mundo-globo-3d">
      <Globe
        ref={globeRef}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        atmosphereColor="#d4af37"
        atmosphereAltitude={0.18}
        polygonsData={countries}
        polygonAltitude={(d: any) => (estadoDe.has(d) ? 0.022 : 0.005)}
        polygonCapColor={(d: any) => color(d, "cap")}
        polygonSideColor={(d: any) => color(d, "side")}
        polygonStrokeColor={(d: any) => color(d, "stroke")}
        polygonLabel={(d: any) => {
          const e = estadoDe.get(d);
          if (!e) return "";
          const nm = String(d?.properties?.ADMIN ?? d?.properties?.NAME ?? "");
          const p = paises.find((x) => x.iso2 && x.iso2 === featureIso2(d));
          return `<div style="background:rgba(0,0,0,.85);color:${MUNDO_COLORES[e].stroke};padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600">${(p?.name ?? nm).toUpperCase()} · ${e === "hecho" ? "ya fuiste" : "planeado"}</div>`;
        }}
        pointsData={ciudades}
        pointLat={(d: any) => d.lat}
        pointLng={(d: any) => d.lng}
        pointColor={(d: any) => MUNDO_COLORES[d.estado as MundoEstado].punto}
        pointAltitude={0.035}
        pointRadius={0.55}
        pointLabel={(d: any) => `<div style="background:rgba(0,0,0,.8);color:${MUNDO_COLORES[d.estado as MundoEstado].punto};padding:4px 8px;border-radius:6px;font-size:11px">${d.name} · ${d.estado === "hecho" ? "ya fuiste" : "planeado"}</div>`}
        labelsData={ciudades}
        labelLat={(d: any) => d.lat}
        labelLng={(d: any) => d.lng}
        labelText={(d: any) => d.name}
        labelSize={0.42}
        labelDotRadius={0.22}
        labelColor={(d: any) => MUNDO_COLORES[d.estado as MundoEstado].punto}
        labelResolution={2}
        labelAltitude={0.04}
      />
    </div>
  );
}

export default WorldGlobe3D;
