import { useEffect, useRef, useState } from "react";
import { Coffee, Wine, UtensilsCrossed, Landmark, ShoppingBag, BedDouble, MapPin, Loader2 } from "lucide-react";
import { fetchPlacePhotoUrl } from "@/lib/placePhoto";
import type { PlaceFamily } from "@/lib/placeLabels";

const ICON: Record<PlaceFamily, typeof MapPin> = {
  food: UtensilsCrossed, cafe: Coffee, bar: Wine, sight: Landmark, shop: ShoppingBag, lodging: BedDouble, other: MapPin,
};

/** Ilustración de la categoría (no es una foto, así que no puede confundirse con el lugar). */
export function PlaceIllustration({ family, note, loading, testId = "place-illustration" }: { family: PlaceFamily; note?: string; loading?: boolean; testId?: string }) {
  const Icon = ICON[family];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#2a2418] via-[#16130e] to-[#0a0a0a]"
      data-testid={testId}>
      <div className="w-14 h-14 rounded-full border border-primary/40 flex items-center justify-center bg-black/30">
        {loading ? <Loader2 className="w-6 h-6 text-primary animate-spin" aria-hidden="true" /> : <Icon className="w-6 h-6 text-primary" aria-hidden="true" />}
      </div>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * Encabezado de la ficha de un lugar: la foto real de Google Places si existe; si no hay foto
 * (o no carga), una ilustración de su categoría con la leyenda "Sin foto de este lugar". Nunca
 * una foto de stock haciéndose pasar por el lugar.
 */
export function PlacePhoto({ photoRef, name, family, className = "h-44", compact = false }: {
  photoRef: string | null; name: string; family: PlaceFamily; className?: string;
  /** Miniatura de la lista: foto pequeña, solo se pide cuando la tarjeta entra en pantalla. */
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">(photoRef ? "loading" : "none");
  const boxRef = useRef<HTMLDivElement>(null);
  // Cada foto cuesta en Google: en la lista solo se pide la de las tarjetas que el usuario ve.
  const [visible, setVisible] = useState(!compact);

  useEffect(() => {
    if (visible || !boxRef.current) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: "200px" });
    io.observe(boxRef.current);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!photoRef) { setState("none"); return; }
    setState("loading");
    if (!visible) return;
    fetchPlacePhotoUrl(photoRef, compact ? 240 : 800).then((u) => {
      if (!alive) return;
      setUrl(u);
      setState(u ? "ok" : "none");
    });
    return () => { alive = false; };
  }, [photoRef, visible, compact]);

  if (compact) {
    return (
      <div ref={boxRef} className={`relative overflow-hidden bg-surface ${className}`} data-testid="place-thumb">
        {state !== "ok" && <PlaceIllustration family={family} loading={state === "loading" && visible} testId="place-thumb-illustration" />}
        {url && (
          // Decorativa: el nombre del lugar ya está junto a la miniatura.
          <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" data-testid="place-thumb-img"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => { setUrl(null); setState("none"); }} />
        )}
      </div>
    );
  }

  return (
    <div ref={boxRef} className={`relative w-full overflow-hidden bg-surface ${className}`}>
      {state !== "ok" && <PlaceIllustration family={family} loading={state === "loading"} note={state === "none" ? "Sin foto de este lugar" : undefined} />}
      {url && (
        <img
          src={url}
          alt={`Foto de ${name}`}
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => { setUrl(null); setState("none"); }}
        />
      )}
      {state === "ok" && <span className="absolute bottom-1.5 right-2 text-[9px] text-white/70 drop-shadow">Foto: Google</span>}
    </div>
  );
}
