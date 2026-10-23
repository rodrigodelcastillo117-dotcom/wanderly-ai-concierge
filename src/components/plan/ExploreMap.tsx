// Mapa oscuro (negro y dorado) con un marcador por destino que muestra su precio. Usa el cargador
// único de Google Maps (src/lib/googleMapsLoader.ts). Mover o acercar el mapa no consulta nada:
// solo pinta los destinos que ya se tienen.
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/googleMapsLoader";
import { cityAirports } from "../../../supabase/functions/_shared/airports";
import type { ExploreDestino } from "@/lib/exploreFlights";

const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0a0a0a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0a0a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b7355" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#3f3528" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#C9A961" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#121110" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#050505" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3f3528" }] },
];

const shortPrice = (n: number | null) => (n == null ? "Sin precio" : n >= 10000 ? `$${Math.round(n / 1000)} mil` : `$${Math.round(n).toLocaleString("es-MX")}`);

/** Píldora dorada con el precio (SVG en data URL: no carga nada de fuera). */
function pricePill(text: string, active: boolean) {
  const w = Math.max(44, text.length * 7.4 + 18);
  const bg = active ? "#C9A961" : "#0a0a0a";
  const fg = active ? "#0a0a0a" : "#E8D7A8";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26"><rect x="0.5" y="0.5" rx="12.5" ry="12.5" width="${w - 1}" height="25" fill="${bg}" stroke="#C9A961"/><text x="${w / 2}" y="17" font-family="system-ui,sans-serif" font-size="12" font-weight="600" text-anchor="middle" fill="${fg}">${text.replace(/[<&>]/g, "")}</text></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, w };
}

export function ExploreMap({ origin, destinos, selected, onSelect, className = "", label, compact = false }: {
  origin: string;
  destinos: ExploreDestino[];
  selected?: string | null;
  onSelect?: (d: ExploreDestino) => void;
  className?: string;
  label: string;
  compact?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps()
      .then((g) => {
        if (!alive || !box.current) return;
        const o = cityAirports(origin);
        mapRef.current = new g.Map(box.current, {
          center: o ? { lat: o.lat, lng: o.lng } : { lat: 23, lng: -40 },
          zoom: compact ? 3 : 2,
          minZoom: 2,
          styles: DARK_STYLE,
          disableDefaultUI: true,
          zoomControl: !compact,
          gestureHandling: compact ? "cooperative" : "greedy",
          backgroundColor: "#050505",
        });
        setReady(true);
      })
      .catch(() => alive && setError("El mapa no está disponible ahora; la lista sigue funcionando."));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = window.google?.maps;
    const map = mapRef.current;
    if (!ready || !g || !map) return;
    for (const m of markers.current) m.setMap?.(null);
    markers.current = [];
    const bounds = g.LatLngBounds ? new g.LatLngBounds() : null;
    const o = cityAirports(origin);
    if (o) {
      markers.current.push(new g.Marker({
        map, position: { lat: o.lat, lng: o.lng }, title: `Origen: ${origin}`,
        icon: g.SymbolPath ? { path: g.SymbolPath.CIRCLE, scale: 6, fillColor: "#C9A961", fillOpacity: 1, strokeColor: "#0a0a0a", strokeWeight: 2 } : undefined,
      }));
      bounds?.extend({ lat: o.lat, lng: o.lng });
    }
    for (const d of destinos) {
      if (d.lat == null || d.lng == null) continue;
      const text = shortPrice(d.precio_mxn);
      const pill = pricePill(text, selected === d.destino);
      const mk = new g.Marker({
        map,
        position: { lat: d.lat, lng: d.lng },
        title: `${d.destino}: ${d.precio_mxn == null ? "Sin precio ahora" : `desde ${text} MXN`}`,
        icon: g.Size ? { url: pill.url, scaledSize: new g.Size(pill.w, 26), anchor: g.Point ? new g.Point(pill.w / 2, 13) : undefined } : pill.url,
        zIndex: selected === d.destino ? 999 : undefined,
      });
      mk.addListener?.("click", () => onSelect?.(d));
      markers.current.push(mk);
      bounds?.extend({ lat: d.lat, lng: d.lng });
    }
    if (bounds && destinos.length > 0 && map.fitBounds) map.fitBounds(bounds, 40);
  }, [ready, destinos, selected, origin]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-primary/15 bg-[#050505] ${className}`}>
      <div ref={box} role="region" aria-label={label} className="absolute inset-0" data-testid="explore-map" />
      {error && (
        <p role="status" className="absolute inset-x-3 bottom-3 rounded-xl bg-black/80 px-3 py-2 text-xs text-muted-foreground">{error}</p>
      )}
    </div>
  );
}
