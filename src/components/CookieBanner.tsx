import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getConsent, setConsent, OPEN_SETTINGS_EVENT, travelpayoutsDriveEnabled, type ConsentChoice } from "@/lib/consent";

/** Espacio que el aviso fijo ocupa abajo mientras está visible (variable CSS en <html>): su alto más la barra inferior. */
export const COOKIE_BANNER_SPACE_VAR = "--cookie-banner-space";

/**
 * Barras de navegación fijas abajo (la del panel en el celular y la de Privé). El relleno del body no
 * mueve elementos fijos: por eso el aviso se coloca ENCIMA de la barra en vez de taparla (ronda 2 de
 * la auditoría de cuenta, P2-1: tapaba Inicio, Viajes y Planear hasta elegir).
 */
export const BOTTOM_BAR_SELECTOR = "[data-bottom-nav], .prive-bottom-nav";

/** Alto (px) de la barra fija pegada al borde inferior que esté visible; 0 si no hay (escritorio, landing). */
export function bottomBarOffset(win: Window = window, doc: Document = document): number {
  let off = 0;
  doc.querySelectorAll<HTMLElement>(BOTTOM_BAR_SELECTOR).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return; // oculta (lg:hidden en escritorio)
    if (r.bottom < win.innerHeight - 2) return; // no está pegada abajo
    off = Math.max(off, Math.ceil(win.innerHeight - r.top));
  });
  return off;
}

// Aviso de cookies con elección real. Mientras no haya elección, NO se carga PostHog
// ni el script de Travelpayouts (ver lib/consent.ts). La elección se puede cambiar
// desde la Política de Cookies.
export const CookieBanner = () => {
  const [visible, setVisible] = useState(false);
  const [barOffset, setBarOffset] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (getConsent() === null) setVisible(true);
    const open = () => setVisible(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);

  // Mientras el aviso está abierto, la página reserva su alto abajo: antes tapaba "Empezar gratis" en el
  // celular y los enlaces del pie (Términos, Privacidad…) hasta cerrarlo (auditoría de cuenta #6).
  // useLayoutEffect: se mide y se libera en el mismo pintado (sin un cuadro con el contenido tapado).
  // También se mide la barra inferior fija (aparece al entrar al panel, que carga después): el aviso se
  // sube encima de ella.
  useLayoutEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    const body = document.body;
    const prevPad = body.style.paddingBottom;
    const apply = () => {
      const off = bottomBarOffset();
      setBarOffset((prev) => (prev === off ? prev : off));
      const h = Math.ceil(boxRef.current?.getBoundingClientRect().height ?? 0);
      root.style.setProperty(COOKIE_BANNER_SPACE_VAR, `${h + off}px`);
      if (h) body.style.paddingBottom = `${h}px`;
      else restore();
    };
    const restore = () => {
      if (prevPad) body.style.paddingBottom = prevPad;
      else body.style.removeProperty("padding-bottom");
    };
    apply();
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; apply(); });
    };
    const RO = (window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const ro = RO && boxRef.current ? new RO(schedule) : null;
    if (ro && boxRef.current) ro.observe(boxRef.current);
    // La barra inferior se monta o desmonta al cambiar de pantalla (rutas perezosas).
    const MO = (window as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver;
    const mo = MO ? new MO(schedule) : null;
    mo?.observe(body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      root.style.removeProperty(COOKIE_BANNER_SPACE_VAR);
      restore();
    };
  }, [visible]);

  const choose = (choice: ConsentChoice) => {
    setConsent(choice);
    setVisible(false);
  };

  if (!visible) return null;

  const affiliates = travelpayoutsDriveEnabled() ? " y medición de afiliados (Travelpayouts)" : "";
  return (
    <div
      ref={boxRef}
      className="fixed inset-x-0 z-[100] px-2 pt-2 md:p-4"
      // Encima de la barra inferior si la hay; si no, respeta la zona segura del iPhone.
      style={{ bottom: barOffset, paddingBottom: barOffset ? 8 : "max(env(safe-area-inset-bottom), 8px)" }}
      role="region"
      aria-label="Aviso de cookies"
      data-testid="cookie-banner"
    >
      <div className="max-w-3xl mx-auto glass-card rounded-xl border border-white/10 p-3 md:p-5 shadow-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
        <p className="text-xs md:text-sm leading-snug text-muted-foreground flex-1">
          {/* Celular: versión corta para no tapar "Empezar gratis" en la primera vista (ronda 2, P2-1). */}
          <span className="sm:hidden" data-testid="cookie-text-short">
            Usamos almacenamiento esencial para tu sesión y, si aceptas, analítica de uso (PostHog){affiliates}. Los sitios de
            reserva ponen sus propias cookies.{" "}
          </span>
          <span className="hidden sm:inline">
            Usamos almacenamiento esencial para mantener tu sesión. Con tu permiso, también usamos analítica de
            uso (PostHog){affiliates} para mejorar IATOS. Al abrir un enlace de reserva,
            el proveedor final puede colocar su propia cookie.{" "}
          </span>
          {/* Texto descriptivo (no "Más información") y subrayado: se distingue sin depender del color. */}
          <Link to="/cookies" className="text-primary underline underline-offset-2 whitespace-nowrap">
            Política de Cookies
          </Link>
        </p>
        <div className="flex gap-2 w-full sm:w-auto shrink-0">
          <Button onClick={() => choose("essential")} size="sm" variant="outline" className="flex-1 sm:flex-none min-h-[44px]">
            Solo esenciales
          </Button>
          <Button onClick={() => choose("accepted")} size="sm" className="flex-1 sm:flex-none min-h-[44px] bg-gradient-gold text-primary-foreground hover:opacity-90">
            Aceptar
          </Button>
        </div>
      </div>
    </div>
  );
};
