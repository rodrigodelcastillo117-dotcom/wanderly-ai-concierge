// THE PRIVATE EDITION · marco de /prive/edicion/* (dentro de PriveRoot: sesión Privé, candado y estilo).
// Navegación de seis áreas: Latest Issue · My Edition · World Briefing · Privé Opportunities · Flight Edition · Library.
import { Link, NavLink, Outlet } from "react-router-dom";
import { ArrowLeft, WifiOff } from "lucide-react";
import { EditionProvider, useEdition } from "@/components/prive/edition/EditionContext";
import { PriveLocked } from "@/components/prive/catalog/PriveLocked";
import { useOnline } from "@/components/prive/edition/Magazine";
import { editionText } from "@/lib/priveEditionI18n";
import "@/components/prive/edition/edition.css";

const AREAS = [
  { to: "/prive/edicion", end: true, key: "latest" },
  { to: "/prive/edicion/mi-edicion", key: "mine" },
  { to: "/prive/edicion/briefing", key: "brief" },
  { to: "/prive/edicion/oportunidades", key: "opportunities" },
  { to: "/prive/edicion/vuelo", key: "flight" },
  { to: "/prive/edicion/biblioteca", key: "library" },
] as const;

function Frame() {
  const { lang, setLang, locked, loading, error, reload } = useEdition();
  const online = useOnline();
  const T = editionText(lang);
  if (locked) return <PriveLocked code={locked} />;
  return (
    <div className="ped" lang={lang}>
      {!online && (
        <div className="ped-banner" role="status">
          <WifiOff className="inline h-4 w-4 mr-2" aria-hidden="true" />{T.offline.banner} ·{" "}
          <Link to="/prive/edicion/sin-conexion" className="underline">{T.offline.title}</Link>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 sm:px-8 pt-1 pb-2">
        <Link to="/prive" className="inline-flex items-center gap-1 min-h-[44px] text-xs tracking-[0.2em] uppercase text-[color:var(--ped-muted)] hover:text-[color:var(--ped-champagne)]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Privé
        </Link>
        <Link to="/prive/edicion" className="text-center leading-tight">
          <span className="ped-masthead block text-[0.95rem] sm:text-lg text-[color:var(--ped-champagne)]">{T.brand}</span>
          <span className="block text-[0.7rem] italic text-[color:var(--ped-muted)]" style={{ fontFamily: "var(--ped-display)" }}>{T.taglineSub}</span>
        </Link>
        <div role="group" aria-label={lang === "en" ? "Language" : "Idioma"} className="flex rounded-full border border-[color:var(--ped-line)]">
          {(["es", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
              className={`min-h-[40px] min-w-[44px] px-2 text-xs font-semibold tracking-widest uppercase rounded-full ${lang === l ? "bg-[color:var(--ped-gold)] text-black" : "text-[color:var(--ped-muted)]"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <nav className="ped-nav" aria-label={T.brand}>
        {AREAS.map((a) => (
          <NavLink key={a.key} to={a.to} end={"end" in a ? a.end : false}>
            <span className="b">{T.nav[a.key].brand}</span>
            <span className="s">{T.nav[a.key].sub}</span>
          </NavLink>
        ))}
      </nav>
      {loading ? (
        <div className="min-h-[60vh] grid place-items-center" role="status" aria-label={lang === "en" ? "Loading" : "Cargando"}>
          <p className="ped-masthead text-2xl opacity-40 animate-pulse">{T.brand}</p>
        </div>
      ) : error ? (
        <div className="px-4 py-16 text-center">
          <p role="alert" className="text-amber-300">{T.loadError}</p>
          <button type="button" className="ped-btn ghost mt-4" onClick={reload}>{T.retry}</button>
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

export default function EditionRoot() {
  return (
    <EditionProvider>
      <Frame />
    </EditionProvider>
  );
}
