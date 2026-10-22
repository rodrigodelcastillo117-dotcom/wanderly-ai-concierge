// Navegación de las seis áreas de IATOS Privé (Documento B §4): FOR YOU · THE KEY · PRIVÉ DROPS ·
// INSIDER · EXPLORE · MY PRIVÉ. Escritorio: en la barra superior. Teléfono: barra inferior con cinco
// (Para ti, The Key, Explorar, Drops, Mi Privé) e Insider en la barra superior, así las seis siguen a
// un toque sin esconder funciones. Todo es navegación interna (misma pestaña).
// THE PRIVATE EDITION (la revista) no es un área más: es un acceso visible en la cabecera (escritorio y
// teléfono) que lleva a /prive/edicion; la sección completa vive en FOR YOU.
import { NavLink, Link } from "react-router-dom";
import { BookOpen, Compass, Gem, KeyRound, Newspaper, Sparkles, UserRound } from "lucide-react";
import { editionText } from "@/lib/priveEditionI18n";
import { usePriveT } from "@/components/prive/PriveLang";

export const PRIVE_AREAS = [
  { key: "forYou", to: "/prive", end: true, icon: Sparkles },
  { key: "key", to: "/prive/key", end: false, icon: KeyRound },
  { key: "drops", to: "/prive/drops", end: false, icon: Gem },
  { key: "insider", to: "/prive/insider", end: false, icon: BookOpen },
  { key: "explore", to: "/prive/explorar", end: false, icon: Compass },
  { key: "my", to: "/prive/mi", end: false, icon: UserRound },
] as const;

const EXPLORE_PATHS = ["/prive/explorar", "/prive/destino/", "/prive/universo/", "/prive/experiencia/"];
const MY_PATHS = ["/prive/mi", "/prive/membresia", "/prive/solicitudes"];

/** ¿Qué área está activa? (las fichas y destinos pertenecen a Explorar; solicitudes y membresía, a Mi Privé). */
export function activeArea(pathname: string): (typeof PRIVE_AREAS)[number]["key"] | null {
  if (EXPLORE_PATHS.some((p) => pathname.startsWith(p))) return "explore";
  if (MY_PATHS.some((p) => pathname.startsWith(p))) return "my";
  if (pathname.startsWith("/prive/key")) return "key";
  if (pathname.startsWith("/prive/drops")) return "drops";
  if (pathname.startsWith("/prive/insider")) return "insider";
  if (pathname === "/prive" || pathname === "/prive/") return "forYou";
  return null;
}

export function PriveTopNav({ pathname }: { pathname: string }) {
  const t = usePriveT();
  const area = activeArea(pathname);
  return (
    <nav aria-label={t.shell.navAria} className="hidden lg:block">
      <ul className="flex items-center gap-1">
        {PRIVE_AREAS.map((a) => (
          <li key={a.key}>
            <NavLink to={a.to} end={a.end} className={() => `prive-nav-link ${area === a.key ? "is-active" : ""}`} aria-current={area === a.key ? "page" : undefined}>
              {t.shell[a.key]}
            </NavLink>
          </li>
        ))}
        <li aria-hidden="true" className="mx-1 h-4 w-px bg-[color:var(--pv-line,rgba(201,169,97,.18))]" />
        <li><PriveEditionLink pathname={pathname} /></li>
      </ul>
    </nav>
  );
}

export const isEditionPath = (pathname: string) => pathname.startsWith("/prive/edicion");

/** Acceso a THE PRIVATE EDITION en la cabecera Privé ("Revista" / "Magazine"). */
export function PriveEditionLink({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  const t = usePriveT();
  const on = isEditionPath(pathname);
  const label = editionText(t.lang === "en" ? "en" : "es").section.navLabel;
  return (
    <Link to="/prive/edicion" data-testid="prive-edition-nav" aria-current={on ? "page" : undefined} title="THE PRIVATE EDITION"
      className={compact
        ? `inline-flex items-center gap-1.5 min-h-[44px] text-xs tracking-[0.2em] uppercase ${on ? "prive-champagne" : "prive-muted"}`
        : `prive-nav-link inline-flex items-center gap-1.5 ${on ? "is-active" : ""}`}>
      <Newspaper className="w-4 h-4" aria-hidden="true" />{label}
    </Link>
  );
}

export function PriveInsiderShortcut({ pathname }: { pathname: string }) {
  const t = usePriveT();
  const on = activeArea(pathname) === "insider";
  return (
    <span className="lg:hidden inline-flex items-center gap-4">
      <PriveEditionLink pathname={pathname} compact />
      <Link to="/prive/insider" className={`inline-flex items-center gap-1.5 min-h-[44px] text-xs tracking-[0.2em] uppercase ${on ? "prive-champagne" : "prive-muted"}`} aria-current={on ? "page" : undefined}>
        <BookOpen className="w-4 h-4" aria-hidden="true" />{t.shell.insider}
      </Link>
    </span>
  );
}

const MOBILE = ["forYou", "key", "explore", "drops", "my"] as const;

export function PriveBottomNav({ pathname }: { pathname: string }) {
  const t = usePriveT();
  const area = activeArea(pathname);
  return (
    <nav aria-label={t.shell.navAria} className="prive-bottom-nav lg:hidden" data-testid="prive-bottom-nav">
      <ul className="grid grid-cols-5">
        {MOBILE.map((k) => {
          const a = PRIVE_AREAS.find((x) => x.key === k)!;
          const Icon = a.icon;
          const on = area === k;
          return (
            <li key={k}>
              <NavLink to={a.to} end={a.end} className={() => `prive-bottom-link ${on ? "is-active" : ""}`} aria-current={on ? "page" : undefined}>
                <Icon className="w-5 h-5" aria-hidden="true" strokeWidth={1.5} />
                <span>{t.shell[k]}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
