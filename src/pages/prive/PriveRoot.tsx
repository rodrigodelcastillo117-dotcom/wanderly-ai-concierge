// Contenedor de todas las rutas /prive/*: estado Privé compartido, tipografía editorial y el marco
// negro. Todo esto vive en chunks aparte (React.lazy): el paquete inicial no crece.
import { Suspense, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PriveProvider, usePriveAccess } from "@/hooks/usePriveAccess";
import { PriveBottomNav, PriveInsiderShortcut, PriveTopNav } from "@/components/prive/shell/PriveNav";
import { Monogram } from "@/components/prive/Monogram";
import { PriveLangProvider, usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import "@/components/prive/prive.css";

const FONT_ID = "prive-font-cormorant";
// Una sola familia (Cormorant Garamond) con display=swap: el texto se ve al instante con la serifa
// del sistema y cambia cuando llega la fuente. Solo se pide al entrar a Privé.
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,400&display=swap";

function usePriveFont() {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById(FONT_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_ID;
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
}

const Spinner = () => {
  const t = usePriveT();
  return (
    <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label={t.common.loadingPrive}>
      <Monogram size={56} className="opacity-60" />
    </div>
  );
};

export default function PriveRoot() {
  return (
    <PriveLangProvider>
      <PriveFrame />
    </PriveLangProvider>
  );
}

function PriveFrame() {
  usePriveFont();
  const t = usePriveT();
  const lang = usePriveLang();
  const { pathname } = useLocation();
  // La invitación es una ceremonia a pantalla completa: sin barra.
  const immersive = pathname.startsWith("/prive/invitacion");
  useEffect(() => {
    const prev = document.title;
    document.title = "IATOS Privé";
    return () => { document.title = prev; };
  }, []);
  return (
    <PriveProvider>
      <FrameInner immersive={immersive} pathname={pathname} lang={lang} t={t} />
    </PriveProvider>
  );
}

function FrameInner({ immersive, pathname, lang, t }: { immersive: boolean; pathname: string; lang: string; t: ReturnType<typeof usePriveT> }) {
  const { view } = usePriveAccess();
  // Las seis áreas solo para quien ya está dentro (con candado o sin membresía no hay a dónde ir).
  const nav = !immersive && view === "unlocked";
  const hubPath = pathname === "/prive" || pathname === "/prive/";
  return (
      <div className={`prive-root ${nav ? "has-bottom-nav" : ""}`} lang={lang === "en" ? "en" : "es-MX"}>
        {!immersive && (
          <header className={`${hubPath ? "absolute inset-x-0 top-0" : "relative"} z-30 flex items-center justify-between gap-4 px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1rem)] pb-3`}>
            <Link to="/dashboard" className="inline-flex items-center gap-2 min-h-[44px] text-xs tracking-[0.2em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {t.common.back}
            </Link>
            <Link to="/prive" className="inline-flex items-center gap-2 min-h-[44px]" aria-label={t.common.homeAria}>
              <Monogram size={30} />
              <span className="prive-eyebrow hidden sm:inline">IATOS Privé</span>
            </Link>
            {nav ? (
              <>
                <PriveTopNav pathname={pathname} />
                <PriveInsiderShortcut pathname={pathname} />
              </>
            ) : (
              <Link to="/prive/membresia" className="inline-flex items-center min-h-[44px] text-xs tracking-[0.2em] uppercase prive-muted hover:text-[color:var(--pv-champagne)]">
                {t.common.membership}
              </Link>
            )}
          </header>
        )}
        {/* En /prive la barra flota sobre la portada; el relleno reserva su alto desde el primer render
            (sin él, la portada subía al cargar: CLS 0.12 medido). */}
        <main id="prive-main" className={hubPath && !immersive ? "pt-[calc(max(env(safe-area-inset-top),1rem)+44px+0.75rem)]" : undefined}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
        {nav && <PriveBottomNav pathname={pathname} />}
      </div>
  );
}
