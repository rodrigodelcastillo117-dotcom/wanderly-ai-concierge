import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapPin, type LucideIcon } from "lucide-react";
import { useInView } from "@/hooks/useInView";
import {
  cachedPlacePhoto, cachedResolvedPhoto, fetchPlacePhotoUrl, resolvePlacePhotoUrl, type PlaceLookup,
} from "@/lib/placePhoto";
import { cachedStockPhoto, getStockPhoto } from "@/lib/stockPhoto";
import { sizedPhotoUrl } from "@/lib/imageSizing";

/**
 * Imagen de una tarjeta (lugar, restaurante, hotel, experiencia, destino) con las reglas de origen
 * de IATOS, en este orden y solo cuando la tarjeta entra en pantalla:
 *   1. `imageUrl`: foto real que ya trae el dato (portada del viaje, miniatura de Google Hotels).
 *   2. `photoRef`: foto real de Google Places (place-photo). Leyenda "Foto: Google".
 *   3. `lookup`: lugar sin foto guardada → place-photo "resolve" (solo si Google devuelve el mismo
 *      lugar). Leyenda "Foto: Google".
 *   4. `stockQuery`: foto de Pexels de la categoría o la cocina. SIEMPRE con "Foto ilustrativa".
 *   5. Nada: degradado de la marca con el ícono de la categoría (nunca un ícono de imagen rota).
 * Mientras tanto se ve un esqueleto; la caja tiene tamaño fijo (sin saltos de diseño).
 */

export type ImageKind = "real" | "google" | "stock";

type Resolved = { url: string; kind: ImageKind; credit?: string | null; step?: Step };

export type SmartImageProps = {
  alt: string;
  imageUrl?: string | null;
  /** Qué es `imageUrl`: "real" (foto del lugar o de su proveedor) o "stock" (ilustrativa). */
  imageKind?: "real" | "stock";
  photoRef?: string | null;
  lookup?: PlaceLookup | null;
  stockQuery?: string | null;
  /** Segunda consulta ilustrativa si la primera no trae foto (p. ej. el lugar emblemático de la ciudad). */
  stockFallbackQuery?: string | null;
  /** thumb ≈ 240 px de Google; card y hero ≈ 800. */
  size?: "thumb" | "card" | "hero";
  /** Clases del contenedor: tamaño/aspecto y esquinas. Debe tener alto (h-*, aspect-*). */
  className?: string;
  imgClassName?: string;
  icon?: LucideIcon;
  /** Dónde va la leyenda (para no chocar con lo que la tarjeta pone encima). */
  captionPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Posición a medida de la leyenda (reemplaza captionPosition), p. ej. "top-12 left-3". */
  captionClassName?: string;
  /** "Foto: Google" solo donde hay espacio (fichas). La leyenda ilustrativa SIEMPRE se muestra. */
  googleCredit?: boolean;
  /** Pedir sin esperar a que se vea (p. ej. un encabezado arriba del todo). */
  eager?: boolean;
  /** Avisa qué se terminó mostrando (para textos de la tarjeta). */
  onKind?: (kind: ImageKind | "none") => void;
  /** Capa encima de la imagen (degradado, textos). */
  children?: ReactNode;
};

const WIDTH = { thumb: 240, card: 800, hero: 800 } as const;

const POS: Record<NonNullable<SmartImageProps["captionPosition"]>, string> = {
  "bottom-right": "bottom-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "top-right": "top-2 right-2",
  "top-left": "top-2 left-2",
};

const safeHttps = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
};

type Step = "url" | "ref" | "lookup" | "stock" | "stock2";

/** Si la foto no termina de bajar en este tiempo, se pasa a la siguiente fuente. */
export const IMAGE_LOAD_TIMEOUT_MS = 8000;

/** Lo que se puede pintar sin llamar a nada (caché de la sesión). undefined = hay que pedirlo. */
function peek(p: SmartImageProps, w: number, skip: Set<Step>): Resolved | null | undefined {
  const url = safeHttps(p.imageUrl);
  if (url && !skip.has("url")) return { url, kind: p.imageKind === "stock" ? "stock" : "real" };
  if (p.photoRef && !skip.has("ref")) {
    const c = cachedPlacePhoto(p.photoRef, w);
    if (c === undefined) return undefined;
    if (c) return { url: c, kind: "google" };
  }
  if (p.lookup && !skip.has("lookup")) {
    const c = cachedResolvedPhoto(p.lookup, w);
    if (c === undefined) return undefined;
    if (c) return { url: c, kind: "google" };
  }
  if (p.stockQuery && !skip.has("stock")) {
    const c = cachedStockPhoto(p.stockQuery);
    if (c === undefined) return undefined;
    if (c) return { url: c.image, kind: "stock", credit: c.photographer, step: "stock" };
  }
  if (p.stockFallbackQuery && !skip.has("stock2")) {
    const c = cachedStockPhoto(p.stockFallbackQuery);
    if (c === undefined) return undefined;
    if (c) return { url: c.image, kind: "stock", credit: c.photographer, step: "stock2" };
  }
  return null;
}

async function resolve(p: SmartImageProps, w: number, skip: Set<Step>): Promise<Resolved | null> {
  const url = safeHttps(p.imageUrl);
  if (url && !skip.has("url")) return { url, kind: p.imageKind === "stock" ? "stock" : "real" };
  if (p.photoRef && !skip.has("ref")) {
    const u = await fetchPlacePhotoUrl(p.photoRef, w);
    if (u) return { url: u, kind: "google" };
  }
  if (p.lookup && !skip.has("lookup")) {
    const u = await resolvePlacePhotoUrl(p.lookup, w);
    if (u) return { url: u, kind: "google" };
  }
  if (p.stockQuery && !skip.has("stock")) {
    const s = await getStockPhoto(p.stockQuery);
    if (s) return { url: s.image, kind: "stock", credit: s.photographer, step: "stock" };
  }
  if (p.stockFallbackQuery && !skip.has("stock2")) {
    const s = await getStockPhoto(p.stockFallbackQuery);
    if (s) return { url: s.image, kind: "stock", credit: s.photographer, step: "stock2" };
  }
  return null;
}

const stepOf = (kind: ImageKind, p: SmartImageProps, step?: Step): Step =>
  step ?? (kind === "stock" ? (safeHttps(p.imageUrl) && p.imageKind === "stock" ? "url" : "stock")
    : kind === "real" ? "url"
    : p.photoRef ? "ref" : "lookup");

export function SmartImage(props: SmartImageProps) {
  const {
    alt, size = "card", className = "h-40", imgClassName = "", icon: Icon = MapPin,
    captionPosition = "bottom-right", captionClassName, googleCredit = size !== "thumb", eager = false, onKind, children,
  } = props;
  const w = WIDTH[size];
  const boxRef = useRef<HTMLDivElement>(null);
  // Solo margen vertical: en los carruseles horizontales no se piden las tarjetas que siguen a la
  // derecha hasta que se deslizan (cada foto cuenta contra el presupuesto de la pantalla).
  const inView = useInView(boxRef, "200px 0px");
  const visible = eager || inView;
  // Identidad de la imagen: si cambia el lugar, se vuelve a resolver desde cero.
  const id = useMemo(
    () => JSON.stringify([props.imageUrl ?? null, props.imageKind ?? null, props.photoRef ?? null, props.lookup ?? null, props.stockQuery ?? null, props.stockFallbackQuery ?? null, w]),
    [props.imageUrl, props.imageKind, props.photoRef, props.lookup, props.stockQuery, props.stockFallbackQuery, w],
  );
  const [skip, setSkip] = useState<Set<Step>>(() => new Set());
  const [state, setState] = useState<{ id: string; res: Resolved | null | undefined }>(() => ({ id, res: peek(props, w, new Set()) }));
  const [loaded, setLoaded] = useState(false);

  // Cambió el lugar: se reinicia.
  useEffect(() => {
    setSkip(new Set());
    setLoaded(false);
    setState({ id, res: peek(props, w, new Set()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (state.res !== undefined || !visible) return;
    let alive = true;
    void resolve(props, w, skip).then((res) => { if (alive) setState({ id, res }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, visible, skip, state.res === undefined]);

  const res = state.id === id ? state.res : undefined;
  useEffect(() => {
    if (res !== undefined) onKind?.(res ? res.kind : "none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res?.url, res === null]);

  // La foto se pide al ancho de la caja (antes la portada del viaje llegaba a 1600 px / 364 KB).
  // Si el servicio rechazara el tamaño, se reintenta una vez con la URL original antes de pasar a
  // la siguiente fuente.
  const [unsized, setUnsized] = useState<string | null>(null);
  const src = res ? (unsized === res.url ? res.url : sizedPhotoUrl(res.url, w)) : null;

  const onErrorRef = useRef<() => void>(() => {});
  const onError = () => {
    if (!res) return;
    if (src !== res.url && unsized !== res.url) {
      setUnsized(res.url);
      return;
    }
    const next = new Set(skip);
    next.add(stepOf(res.kind, props, res.step));
    setSkip(next);
    setLoaded(false);
    setState({ id, res: peek(props, w, next) });
  };  onErrorRef.current = onError;


  // Una foto que nunca termina de bajar (ni carga ni error) dejaba la tarjeta oscura para siempre
  // (auditoría 10 #23: Soho House sin foto). Pasado un tiempo se trata como error: sigue la siguiente
  // fuente (la ilustrativa marcada) o el respaldo de la marca.
  useEffect(() => {
    if (!res || loaded) return;
    const t = setTimeout(() => onErrorRef.current(), IMAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [res?.url, src, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = res === undefined;
  return (
    <div ref={boxRef} className={`relative overflow-hidden bg-[#14110c] ${className}`} data-testid="smart-image" data-kind={pending ? "pending" : res ? res.kind : "none"}>
      {/* Respaldo de marca: también es el fondo mientras la foto termina de bajar. */}
      {(pending || !res || !loaded) && (
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[#2a2418] via-[#16130e] to-[#0a0a0a] flex items-center justify-center">
          {pending || (res && !loaded)
            ? <div className="absolute inset-0 motion-safe:animate-pulse bg-gradient-to-r from-white/[0.02] via-white/[0.06] to-white/[0.02]" data-testid="smart-image-skeleton" />
            : size === "thumb"
              ? <Icon className="w-5 h-5 text-primary/45" strokeWidth={1.5} data-testid="smart-image-fallback" />
              // Sin foto real: placeholder de la marca (anillo dorado, ícono y "IATOS"), nunca un hueco.
              : <span className="flex flex-col items-center gap-1.5" data-testid="smart-image-fallback">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/35 bg-primary/[0.06]">
                    <Icon className="w-6 h-6 text-primary/70" strokeWidth={1.5} />
                  </span>
                  <span className="font-display text-[10px] uppercase tracking-[0.3em] text-primary/55">IATOS</span>
                </span>}
        </div>
      )}
      {res && (
        <img
          key={src ?? res.url}
          src={src ?? res.url}
          alt={alt}
          // Ya solo se resuelve al verse: "lazy" nativo dejaría fotos sin bajar (y la tarjeta oscura).
          loading={visible ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-700 ${loaded ? "opacity-100" : "opacity-0"} ${imgClassName}`}
        />
      )}
      {children}
      {res && res.kind === "stock" && (
        <span
          className={`absolute ${captionClassName ?? POS[captionPosition]} z-[2] pointer-events-none rounded-full bg-black/55 backdrop-blur-sm px-1.5 py-0.5 leading-none tracking-wide text-white/85 ${size === "thumb" ? "text-[7px] uppercase" : "text-[9px]"}`}
          title={res.credit ? `Foto ilustrativa de Pexels · ${res.credit}. No es el lugar.` : "Foto ilustrativa de Pexels. No es el lugar."}
          data-testid="illustrative-caption"
        >
          {size === "thumb" ? "Ilustrativa" : "Foto ilustrativa"}
        </span>
      )}
      {res && res.kind === "google" && googleCredit && (
        <span className={`absolute ${captionClassName ?? POS[captionPosition]} z-[2] pointer-events-none text-[9px] leading-none text-white/75 drop-shadow`} data-testid="google-caption">
          Foto: Google
        </span>
      )}
    </div>
  );
}

export default SmartImage;

/**
 * Leyenda "Imagen ilustrativa" para medios de stock que no pasan por SmartImage (videos de destino
 * de DestinationVideo). Va dentro de un contenedor `relative`.
 */
export function IllustrativeCaption({ className = "bottom-2 right-2", label = "Imagen ilustrativa" }: { className?: string; label?: string }) {
  return (
    <span
      className={`absolute ${className} z-[2] pointer-events-none rounded-full bg-black/55 backdrop-blur-sm px-1.5 py-0.5 text-[9px] leading-none tracking-wide text-white/85`}
      title="Imagen ilustrativa de Pexels: muestra el destino, no un lugar específico."
      data-testid="illustrative-caption"
    >
      {label}
    </span>
  );
}
