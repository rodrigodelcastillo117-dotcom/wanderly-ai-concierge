import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import { cachedPrivePhoto, loadPrivePhoto, PRIVE_PHOTO_RETRY_MS } from "@/lib/privePhoto";
import type { StockPhoto } from "@/lib/stockPhoto";
import { usePriveT } from "@/components/prive/PriveLang";

type State = { key: string; photo: StockPhoto | null; status: "pending" | "ok" | "none" };

/**
 * Foto de una tarjeta o portada de Privé. Se pide solo cuando la caja entra en pantalla (o de
 * inmediato con `eager`), con la fila y la caché compartidas (privePhoto.ts). Mientras llega: un
 * brillo tenue; si de verdad no hay foto: un degradado de la marca con el nombre en filigrana. Nunca
 * una caja vacía. El crédito "Foto ilustrativa · Pexels · <fotógrafo>" va siempre que hay foto:
 * como texto dentro de tarjetas enlazadas (no se anida un enlace dentro de otro) y como enlaces en
 * portadas y fichas (`creditLinks`), donde abren Pexels en otra pestaña.
 */
export function PrivePhoto({ queries, alt, label, className = "", eager = false, illustrative = true, creditLinks = false, credit = true,
  creditClassName = "", children }: {
  queries: readonly (string | null | undefined)[];
  alt: string;
  /** Texto del respaldo (nombre del destino o universo). */
  label?: string;
  className?: string;
  eager?: boolean;
  illustrative?: boolean;
  creditLinks?: boolean;
  credit?: boolean;
  creditClassName?: string;
  children?: ReactNode;
}) {
  const t = usePriveT();
  const boxRef = useRef<HTMLDivElement>(null);
  // Solo margen vertical: en un carrusel no se piden las tarjetas que siguen a la derecha.
  const inView = useInView(boxRef, "300px 0px");
  const key = useMemo(() => queries.join("|"), [queries]);
  const [state, setState] = useState<State>(() => {
    const c = cachedPrivePhoto(queries);
    return { key, photo: c ?? null, status: c === undefined ? "pending" : c ? "ok" : "none" };
  });
  const [loaded, setLoaded] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    if (state.key === key) return;
    const c = cachedPrivePhoto(queries);
    attempt.current = 0;
    setLoaded(false);
    setState({ key, photo: c ?? null, status: c === undefined ? "pending" : c ? "ok" : "none" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const visible = eager || inView;
  useEffect(() => {
    if (!visible || state.key !== key || state.status !== "pending") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      void loadPrivePhoto(queries).then((r) => {
        if (!alive) return;
        if (r.status === "ok") setState({ key, photo: r.photo, status: "ok" });
        else if (r.status === "none") setState({ key, photo: null, status: "none" });
        else if (attempt.current < PRIVE_PHOTO_RETRY_MS.length) {
          timer = setTimeout(run, PRIVE_PHOTO_RETRY_MS[attempt.current++]);
        } else setState({ key, photo: null, status: "none" });
      });
    };
    run();
    return () => { alive = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key, state.status, state.key]);

  const photo = state.key === key ? state.photo : null;
  const status = state.key === key ? state.status : "pending";
  const onError = () => setState({ key, photo: null, status: "none" });
  const creditText = photo ? t.common.photoCredit(photo.photographer, illustrative) : "";

  return (
    <div ref={boxRef} className={`prive-photo-box ${className}`} data-testid="prive-photo" data-status={photo ? "ok" : status}>
      {(!photo || !loaded) && (
        <div className="prive-photo-fallback" aria-hidden="true" data-testid={status === "none" ? "prive-photo-fallback" : "prive-photo-pending"}>
          {status === "pending" || (photo && !loaded) ? <span className="prive-photo-shimmer" /> : label ? <span className="prive-photo-watermark">{label}</span> : null}
        </div>
      )}
      {photo && (
        <img
          key={photo.image}
          src={photo.image}
          alt={alt}
          // Ya se pide al verse: "lazy" nativo dentro de un carrusel o un overlay podía no disparar nunca.
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={onError}
          className={`prive-photo-img ${loaded ? "is-loaded" : ""}`}
        />
      )}
      {children}
      {photo && credit && (
        creditLinks ? (
          <p className={`prive-photo-credit ${creditClassName}`}>
            <a href={photo.page_url || "https://www.pexels.com"} target="_blank" rel="noopener noreferrer">{t.common.photoCredit(null, illustrative)}</a>
            {photo.photographer && <>{" · "}<a href={photo.page_url || "https://www.pexels.com"} target="_blank" rel="noopener noreferrer">{photo.photographer}</a></>}
          </p>
        ) : (
          <p className={`prive-photo-credit ${creditClassName}`} data-testid="prive-photo-credit">{creditText}</p>
        )
      )}
    </div>
  );
}
