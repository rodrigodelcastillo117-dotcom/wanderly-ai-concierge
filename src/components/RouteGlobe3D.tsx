import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { Globe2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  origin?: string;
  destinations: string[];
  height?: number;
};

type Pt = { name: string; lat: number; lng: number; order: number };

// Geocoding cache en memoria (sesión)
const geoCache = new Map<string, { lat: number; lng: number }>();

async function geocodeCity(q: string): Promise<{ lat: number; lng: number } | null> {
  const key = q.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    const { data, error } = await supabase.functions.invoke("geocode", {
      body: { address: q },
    });
    if (error) throw error;
    const r = Array.isArray(data?.results) ? data.results[0] : null;
    if (r && typeof r.lat === "number" && typeof r.lng === "number") {
      const v = { lat: r.lat, lng: r.lng };
      geoCache.set(key, v);
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Point-in-polygon (ray casting) — soporta Polygon y MultiPolygon GeoJSON
function pointInRing(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInFeature(lng: number, lat: number, feat: any): boolean {
  const g = feat?.geometry;
  if (!g) return false;
  if (g.type === "Polygon") {
    if (!pointInRing(lng, lat, g.coordinates[0])) return false;
    for (let i = 1; i < g.coordinates.length; i++) {
      if (pointInRing(lng, lat, g.coordinates[i])) return false;
    }
    return true;
  }
  if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      if (!pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(lng, lat, poly[i])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

// Cache global del GeoJSON de países
let countriesPromise: Promise<any[]> | null = null;
function loadCountries(): Promise<any[]> {
  if (!countriesPromise) {
    countriesPromise = fetch(
      "https://unpkg.com/three-globe@2.31.1/example/country-polygons/ne_110m_admin_0_countries.geojson"
    )
      .then((r) => r.json())
      .then((g) => g?.features ?? [])
      .catch(() => []);
  }
  return countriesPromise;
}

export function RouteGlobe3D({ origin, destinations, height = 380 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [width, setWidth] = useState(600);
  const [points, setPoints] = useState<Pt[]>([]);
  const [loading, setLoading] = useState(false);
  const [countries, setCountries] = useState<any[]>([]);
  const [altitude, setAltitude] = useState(2.4);

  const cities = useMemo(() => {
    const arr = [origin, ...destinations].map((s) => (s ?? "").trim()).filter(Boolean) as string[];
    return Array.from(new Set(arr));
  }, [origin, destinations]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const hasResizeObserver = typeof ResizeObserver !== "undefined";
    if (!hasResizeObserver) {
      const updateWidth = () => setWidth(Math.max(280, wrapRef.current?.clientWidth ?? 600));
      updateWidth();
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(280, e.contentRect.width));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Carga polígonos de países una sola vez
  useEffect(() => {
    let cancelled = false;
    loadCountries().then((feats) => {
      if (!cancelled) setCountries(feats);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (cities.length === 0) {
      setPoints([]);
      return;
    }
    setLoading(true);
    (async () => {
      const out: Pt[] = [];
      for (let i = 0; i < cities.length; i++) {
        const g = await geocodeCity(cities[i]);
        if (cancelled) return;
        if (g) out.push({ name: cities[i], lat: g.lat, lng: g.lng, order: i });
      }
      if (!cancelled) {
        setPoints(out);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cities]);

  // Países que contiene la ruta (set de nombres)
  const highlightedNames = useMemo(() => {
    if (!countries.length || !points.length) return new Set<string>();
    const names = new Set<string>();
    for (const p of points) {
      for (const f of countries) {
        if (pointInFeature(p.lng, p.lat, f)) {
          const nm = f.properties?.ADMIN || f.properties?.NAME || f.properties?.name;
          if (nm) names.add(nm);
          break;
        }
      }
    }
    return names;
  }, [countries, points]);

  // Centroide del polígono más grande (para colocar el nombre del país)
  const countryLabels = useMemo(() => {
    if (!countries.length || highlightedNames.size === 0) return [];
    const out: Array<{ lat: number; lng: number; name: string }> = [];
    for (const f of countries) {
      const nm = f.properties?.ADMIN || f.properties?.NAME || f.properties?.name;
      if (!nm || !highlightedNames.has(nm)) continue;
      const g = f.geometry;
      let ring: number[][] | null = null;
      if (g?.type === "Polygon") ring = g.coordinates[0];
      else if (g?.type === "MultiPolygon") {
        // ring del polígono con más vértices
        let best: number[][] | null = null;
        for (const poly of g.coordinates) {
          if (!best || poly[0].length > best.length) best = poly[0];
        }
        ring = best;
      }
      if (!ring || ring.length === 0) continue;
      let sx = 0, sy = 0;
      for (const [x, y] of ring) { sx += x; sy += y; }
      out.push({ lng: sx / ring.length, lat: sy / ring.length, name: nm });
    }
    return out;
  }, [countries, highlightedNames]);

  // Etiquetas de cada ciudad (siempre visibles, numeradas)
  const cityLabels = useMemo(
    () => points.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name, order: p.order })),
    [points],
  );

  // Auto-rotación + detenerla al primer interactuar (zoom/drag)
  // y trackear altitud de cámara para etiquetas adaptativas
  useEffect(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls?.();
    if (!controls) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.enableZoom = true;
    const stop = () => { controls.autoRotate = false; };
    const onChange = () => {
      const pov = globeRef.current?.pointOfView?.();
      if (pov && typeof pov.altitude === "number") {
        setAltitude((prev) => (Math.abs(prev - pov.altitude) > 0.05 ? pov.altitude : prev));
      }
    };
    controls.addEventListener("start", stop);
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener?.("start", stop);
      controls.removeEventListener?.("change", onChange);
    };
  }, [countries.length]);

  // Enfoque al centroide cuando cambian los puntos
  useEffect(() => {
    if (!globeRef.current || points.length === 0) return;
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    globeRef.current.pointOfView({ lat, lng, altitude: 2.4 }, 1200);
    setAltitude(2.4);
  }, [points]);

  // Distancia haversine (km) — para escalar altura del arco
  const haversine = (a: Pt, b: Pt) => {
    const R = 6371;
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };

  const arcs = useMemo(() => {
    if (points.length < 2) return [];
    return points.slice(0, -1).map((p, i) => {
      const next = points[i + 1];
      const km = haversine(p, next);
      // altura mínima visible para tramos cortos (trenes europeos),
      // se escala suave para vuelos largos
      const altitude = Math.max(0.08, Math.min(0.55, km / 12000 + 0.08));
      return {
        startLat: p.lat,
        startLng: p.lng,
        endLat: next.lat,
        endLng: next.lng,
        altitude,
        label: `${i + 1}. ${p.name} → ${next.name} · ${Math.round(km).toLocaleString()} km`,
        color: ["#7fd4ff", "#bff0ff"],
      };
    });
  }, [points]);

  return (
    <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-4 md:p-5 premium-shadow">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-primary" />
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-primary/80">Ruta 3D</p>
            <h3 className="font-display text-base md:text-lg">Tu travesía en el mundo</h3>
          </div>
        </div>
        {loading && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
      </header>

      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-2xl bg-black"
        style={{ height }}
      >
        {points.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground italic px-4 text-center">
            Agrega ciudades arriba y verás tu ruta trazada sobre el globo terráqueo.
          </div>
        )}
        <Globe
          ref={globeRef}
          width={width}
          height={height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          atmosphereColor="#d4af37"
          atmosphereAltitude={0.18}
          // Países como polígonos — los de la ruta van resaltados en dorado
          polygonsData={countries}
          polygonAltitude={(d: any) =>
            highlightedNames.has(d?.properties?.ADMIN || d?.properties?.NAME) ? 0.025 : 0.005
          }
          polygonCapColor={(d: any) =>
            highlightedNames.has(d?.properties?.ADMIN || d?.properties?.NAME)
              ? "rgba(212, 175, 55, 0.55)"
              : "rgba(255, 255, 255, 0.02)"
          }
          polygonSideColor={(d: any) =>
            highlightedNames.has(d?.properties?.ADMIN || d?.properties?.NAME)
              ? "rgba(212, 175, 55, 0.35)"
              : "rgba(255, 255, 255, 0.05)"
          }
          polygonStrokeColor={(d: any) =>
            highlightedNames.has(d?.properties?.ADMIN || d?.properties?.NAME)
              ? "#f5e6a8"
              : "rgba(255, 255, 255, 0.18)"
          }
          polygonLabel={(d: any) => {
            const nm = d?.properties?.ADMIN || d?.properties?.NAME;
            if (!highlightedNames.has(nm)) return "";
            return `<div style="background:rgba(0,0,0,.85);color:#f5e6a8;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:.05em">${nm.toUpperCase()}</div>`;
          }}
          pointsData={points}
          pointLat={(d: any) => d.lat}
          pointLng={(d: any) => d.lng}
          pointColor={() => "#bff0ff"}
          pointAltitude={0.04}
          pointRadius={0.6}
          pointLabel={(d: any) => `<div style="background:rgba(0,0,0,.8);color:#bff0ff;padding:4px 8px;border-radius:6px;font-size:11px">${d.order + 1}. ${d.name}</div>`}
          // País resaltado en dorado · ciudad numerada en cian, más chica y elevada para no encimarse
          // Etiquetas adaptativas: lejos = países, medio = ambos, cerca = ciudades
          labelsData={(() => {
            const showCountries = altitude > 0.55;
            const showCityNames = altitude < 1.4;
            const country = showCountries
              ? countryLabels.map((c) => ({ ...c, kind: "country" as const }))
              : [];
            const city = cityLabels.map((c) => ({
              ...c,
              kind: "city" as const,
              showName: showCityNames,
            }));
            return [...country, ...city];
          })()}
          labelLat={(d: any) => d.lat}
          labelLng={(d: any) => d.lng}
          labelText={(d: any) => {
            if (d.kind === "country") return String(d.name).toUpperCase();
            return d.showName ? `${d.order + 1}. ${d.name}` : `${d.order + 1}`;
          }}
          labelSize={(d: any) => {
            if (d.kind === "country") {
              // Más chico al hacer zoom para no encimar
              return Math.max(0.35, Math.min(1.1, altitude * 0.45));
            }
            return d.showName ? Math.max(0.28, Math.min(0.55, 0.9 - altitude * 0.3)) : 0.32;
          }}
          labelDotRadius={(d: any) => (d.kind === "country" ? 0 : Math.max(0.18, 0.45 - altitude * 0.1))}
          labelColor={(d: any) => (d.kind === "country" ? "#f5e6a8" : "#bff0ff")}
          labelResolution={2}
          labelAltitude={(d: any) => (d.kind === "country" ? 0.012 : 0.05)}
          arcsData={arcs}
          arcColor={(d: any) => d.color}
          arcAltitude={(d: any) => d.altitude}
          arcDashLength={0.4}
          arcDashGap={0.15}
          arcDashAnimateTime={2200}
          arcStroke={0.7}
          arcLabel={(d: any) => `<div style="background:rgba(0,0,0,.85);color:#f5e6a8;padding:4px 8px;border-radius:6px;font-size:11px">${d.label}</div>`}
        />
      </div>

      {points.length >= 2 && (
        <p className="mt-3 text-[11px] text-muted-foreground italic">
          {points.length} puntos · {arcs.length} tramos
          {highlightedNames.size > 0 ? ` · ${highlightedNames.size} países resaltados` : ""}.
          Arrastra para girar · usa la rueda para zoom (la rotación automática se detiene al interactuar).
        </p>
      )}
    </div>
  );
}

export default RouteGlobe3D;
