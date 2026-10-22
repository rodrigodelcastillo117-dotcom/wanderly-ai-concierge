import { Link } from "react-router-dom";
import { Monogram } from "@/components/prive/Monogram";
import { usePriveT } from "@/components/prive/PriveLang";
import { askIatoHref } from "@/lib/priveLinks";

/** Pantalla honesta para un área que otro equipo todavía está terminando (nunca una página vacía). */
export function PriveComingSoon({ brand, sub }: { brand: string; sub: string }) {
  const t = usePriveT();
  return (
    <section className="max-w-xl mx-auto px-4 py-20 text-center" data-testid="prive-coming-soon">
      <Monogram size={64} className="mx-auto mb-8" />
      <p className="prive-eyebrow mb-3">{t.shell.soon}</p>
      <h1 className="prive-display text-4xl sm:text-5xl">{brand}</h1>
      <p className="prive-champagne mt-2">{sub}</p>
      <p className="prive-muted text-sm mt-6">{t.shell.soonBody}</p>
      <div className="flex flex-wrap justify-center gap-3 mt-8">
        <Link to={askIatoHref("")} className="prive-btn prive-btn-gold">{t.home.askIato}</Link>
        <Link to="/prive" className="prive-btn prive-btn-ghost">{t.shell.forYou}</Link>
      </div>
    </section>
  );
}
