// FOR YOU (Documento A, Fases 1, 12 y 13): la portada de IATOS Privé. Tres propuestas comparables,
// todas funcionales y con los mismos datos; cambia la composición:
//   A · A PRIVATE EDITORIAL        revista: portada en dos columnas, historia de portada primero
//   B · CONTEMPORARY PRIVATE CLUB  club: saludo y accesos directos arriba, listas compactas
//   C · CINEMATIC JOURNEY          cine: foto o video a sangre completa, carriles de imagen (elegida)
// La elegida es C (criterios en docs/iatos/prive_reimagined/prive-ux.md); A y B se ven con ?portada=a|b.
//
// Dueño, 23-oct-2026: "EXPLORE y FOR YOU hacen la misma función". Para ti queda 100 % PERSONAL: tu próximo
// viaje, lo elegido para tus fechas, destino y gustos, la experiencia de la semana, lo nuevo de esta semana
// (Drops y tu revista) y tus ideas. El catálogo genérico (buscador, destinos destacados por región,
// colecciones y universos) vive en Explorar, con un acceso claro "Explorar el mundo Privé →".
import { createContext, useContext } from "react";
import { Link } from "react-router-dom";
import { CuratedForYou, PriveKeyLauncher, YourNextJourney, YourWorldIsReady } from "@/components/prive/key";
import { DropsTeaser } from "@/components/prive/value";
import { PrivateEditionBand } from "@/components/prive/edition";
import { usePriveT } from "@/components/prive/PriveLang";
import { PriveSpotlight } from "@/components/prive/catalog/PriveHomeLive";
import { ExploreAccess, PersonalIdeas } from "./PersonalIdeas";

export type HomeVariant = "a" | "b" | "c";
export const DEFAULT_HOME_VARIANT: HomeVariant = "c";
export const parseVariant = (v: string | null | undefined): HomeVariant => (v === "a" || v === "b" || v === "c" ? v : DEFAULT_HOME_VARIANT);

const VariantCtx = createContext<HomeVariant>(DEFAULT_HOME_VARIANT);
export const HomeVariantProvider = VariantCtx.Provider;
export const useHomeVariant = () => useContext(VariantCtx);

export function ForYouHome() {
  const t = usePriveT();
  const variant = useHomeVariant();
  const requests = <p className="text-sm text-center"><Link to="/prive/solicitudes" className="prive-gold underline-offset-2 hover:underline">{t.browse.myRequests}</Link></p>;
  // Lo nuevo de esta semana: oportunidades vigentes (Drops) y THE PRIVATE EDITION (la revista, de otro equipo).
  const fresh = (
    <div key="new" className="space-y-12 sm:space-y-16" data-testid="prive-new-this-week">
      <DropsTeaser />
      <PrivateEditionBand />
    </div>
  );
  const explore = <div key="x" className="space-y-6"><ExploreAccess />{requests}</div>;

  const blocks: Record<HomeVariant, JSX.Element[]> = {
    c: [
      <YourNextJourney key="nj" />,
      <YourWorldIsReady key="w" />,
      <CuratedForYou key="cf" />,
      <PriveSpotlight key="sp" />,
      fresh,
      <PersonalIdeas key="ideas" />,
      <PriveKeyLauncher key="k" />,
      explore,
    ],
    a: [
      <PrivateEditionBand key="pe" />,
      <PriveSpotlight key="sp" />,
      <CuratedForYou key="cf" />,
      <YourNextJourney key="nj" />,
      <DropsTeaser key="dr" />,
      <PersonalIdeas key="ideas" />,
      <PriveKeyLauncher key="k" />,
      explore,
    ],
    b: [
      <PriveKeyLauncher key="k" />,
      <YourNextJourney key="nj" />,
      <CuratedForYou key="cf" />,
      fresh,
      <PersonalIdeas key="ideas" />,
      <PriveSpotlight key="sp" />,
      explore,
    ],
  };
  return (
    <div className={`prive-home prive-home-${variant} space-y-16 sm:space-y-24`} data-testid="prive-catalog-home" data-variant={variant}>
      {blocks[variant]}
    </div>
  );
}
