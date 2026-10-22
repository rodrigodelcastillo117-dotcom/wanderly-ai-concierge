// FOR YOU (Documento A, Fases 1, 12 y 13): la portada de IATOS Privé. Tres propuestas comparables,
// todas funcionales y con los mismos datos; cambia la composición:
//   A · A PRIVATE EDITORIAL        revista: portada en dos columnas, historia de portada primero
//   B · CONTEMPORARY PRIVATE CLUB  club: saludo y accesos directos arriba, listas compactas
//   C · CINEMATIC JOURNEY          cine: foto o video a sangre completa, carriles de imagen (elegida)
// La elegida es C (criterios en docs/iatos/prive_reimagined/prive-ux.md); A y B se ven con ?portada=a|b.
import { createContext, useContext, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CuratedForYou, PriveKeyLauncher, YourNextJourney, YourWorldIsReady } from "@/components/prive/key";
import { DropsTeaser } from "@/components/prive/value";
import { PrivateEditionTeaser } from "@/components/prive/edition";
import { featuredDestinations } from "@/lib/priveBrowse";
import { usePriveT } from "@/components/prive/PriveLang";
import { PriveSpotlight } from "@/components/prive/catalog/PriveHomeLive";
import { usePriveHome, usePriveTrip } from "./context";
import { UniversalSearch } from "./UniversalSearch";
import { ExtraordinaryEdit, FeaturedDestinations } from "./sections";

export type HomeVariant = "a" | "b" | "c";
export const DEFAULT_HOME_VARIANT: HomeVariant = "c";
export const parseVariant = (v: string | null | undefined): HomeVariant => (v === "a" || v === "b" || v === "c" ? v : DEFAULT_HOME_VARIANT);

const VariantCtx = createContext<HomeVariant>(DEFAULT_HOME_VARIANT);
export const HomeVariantProvider = VariantCtx.Provider;
export const useHomeVariant = () => useContext(VariantCtx);

export function ForYouHome() {
  const t = usePriveT();
  const variant = useHomeVariant();
  const home = usePriveHome();
  const { dest } = usePriveTrip();
  const destinations = useMemo(() => home?.destinations ?? [], [home]);
  const fallbackCities = useMemo(() => (dest ? [dest.slug] : featuredDestinations(destinations.filter((d) => d.count > 0), 5).map((d) => d.slug)), [dest, destinations]);
  const universes = home?.universes ?? [];

  const search = <UniversalSearch destinations={destinations} fallbackCities={fallbackCities} variant="hero" />;
  const toUniverses = (
    <p className="text-center">
      <Link to="/prive/explorar" className="inline-flex items-center gap-2 text-[11px] tracking-[0.24em] uppercase prive-gold hover:text-[color:var(--pv-champagne)] min-h-[44px]">
        {t.explore.universesBrand}{t.explore.universesSub ? ` · ${t.explore.universesSub}` : ""}<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    </p>
  );
  const requests = <p className="text-sm text-center"><Link to="/prive/solicitudes" className="prive-gold underline-offset-2 hover:underline">{t.browse.myRequests}</Link></p>;

  const blocks: Record<HomeVariant, JSX.Element[]> = {
    c: [
      // Sube sobre la portada con desplazamiento (no margen negativo): el margen colapsaba hacia el contenedor
      // y movía la página al terminar de cargar (CLS medido 0.157).
      <div key="s" className="relative z-20 -top-8 -mb-8">{search}</div>,
      <YourWorldIsReady key="w" />,
      <CuratedForYou key="cf" />,
      <YourNextJourney key="nj" />,
      <ExtraordinaryEdit key="ed" universes={universes} />,
      <PriveKeyLauncher key="k" />,
      <PriveSpotlight key="sp" />,
      <FeaturedDestinations key="fd" destinations={destinations} />,
      <PrivateEditionTeaser key="pe" />,
      <DropsTeaser key="dr" />,
      <div key="u">{toUniverses}{requests}</div>,
    ],
    a: [
      <div key="s" className="pt-2">{search}</div>,
      <PriveSpotlight key="sp" />,
      <CuratedForYou key="cf" />,
      <ExtraordinaryEdit key="ed" universes={universes} />,
      <YourNextJourney key="nj" />,
      <PriveKeyLauncher key="k" />,
      <FeaturedDestinations key="fd" destinations={destinations} />,
      <PrivateEditionTeaser key="pe" />,
      <div key="u">{toUniverses}{requests}</div>,
    ],
    b: [
      <div key="s" className="pt-2">{search}</div>,
      <PriveKeyLauncher key="k" />,
      <YourNextJourney key="nj" />,
      <CuratedForYou key="cf" />,
      <DropsTeaser key="dr" />,
      <FeaturedDestinations key="fd" destinations={destinations} />,
      <ExtraordinaryEdit key="ed" universes={universes} />,
      <div key="u">{toUniverses}{requests}</div>,
    ],
  };
  return (
    <div className={`prive-home prive-home-${variant} space-y-16 sm:space-y-24`} data-testid="prive-catalog-home" data-variant={variant}>
      {blocks[variant]}
    </div>
  );
}
