// /prive/mi — MY PRIVÉ (Documento A Fase 9, Documento B §13): club personal, no tablero. Tarjeta de
// miembro, Pasaporte (ranura de privevalor), guardados, solicitudes, el valor de tu Privé (ranura) y
// preferencias y seguridad (las secciones de membresía existentes). Sin rankings ni exclusividad ficticia.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { usePriveCatalog, type PriveExperience, type PriveRequest } from "@/lib/priveCatalogApi";
import { shortDate } from "@/lib/priveCatalogView";
import { MemberCard } from "@/components/prive/MemberCard";
import { Monogram } from "@/components/prive/Monogram";
import { PassportCard, ValueOfYourPrive } from "@/components/prive/value";
import { FeaturedExperienceCard } from "@/components/prive/home/defaults";
import { BrandTitle } from "@/components/prive/home/BrandTitle";
import { Rail } from "@/components/prive/catalog/Rail";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import PriveMembership, { cardStatus } from "./PriveMembership";

function useSafeLoad<T>(fn: () => Promise<T>, enabled: boolean): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fn().then((x) => { if (alive) setV(x); }).catch(() => { if (alive) setV(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return v;
}

export default function PriveMyPage() {
  const t = usePriveT();
  const lang = usePriveLang();
  const { status, view, unlocked, loading } = usePriveAccess();
  const api = usePriveCatalog();
  const saved = useSafeLoad<PriveExperience[]>(() => api.saved(), unlocked);
  const requests = useSafeLoad<PriveRequest[]>(() => api.myRequests(), !!status && status.membership_status === "active");
  if (loading && !status) return <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label={t.membership.loading}><Monogram size={56} className="opacity-60" /></div>;
  const active = status?.membership_status === "active";
  const open = (requests ?? []).filter((r) => !["cancelado", "rechazado", "completado", "no_confirmado"].includes(r.status)).slice(0, 3);
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 pb-24 space-y-14" data-testid="prive-my">
      <header className="pt-6 grid lg:grid-cols-[1fr_auto] gap-8 items-end">
        <BrandTitle as="h1" brand={t.my.brand} sub={t.my.title !== t.my.brand ? t.my.title : ""} />
        {/* Con sesión Privé la tarjeta la dibuja THE PRIVÉ PASSPORT (privevalor); aquí solo si está cerrado. */}
        {status && active && !unlocked && (
          <MemberCard firstName={status.first_name} status={cardStatus(view)} activatedAt={status.activated_at} memberCode={status.member_code} />
        )}
      </header>
      <PassportCard />
      {unlocked && (
        <section aria-labelledby="prive-my-saved" data-testid="prive-my-saved">
          {saved && saved.length > 0 ? (
            <Rail label={t.my.saved} large heading={<h2 id="prive-my-saved" className="text-3xl">{t.my.saved}</h2>}>
              {saved.map((e) => <li key={e.id}><FeaturedExperienceCard e={{ ...e, saved: true }} size="md" /></li>)}
            </Rail>
          ) : (
            <div className="prive-panel p-6">
              <h2 id="prive-my-saved" className="text-3xl mb-2">{t.my.saved}</h2>
              <p className="text-sm prive-muted">{t.my.savedEmpty}</p>
            </div>
          )}
        </section>
      )}
      {active && (
        <section aria-labelledby="prive-my-req" className="space-y-4" data-testid="prive-my-requests">
          <div className="flex items-end justify-between gap-3">
            <h2 id="prive-my-req" className="text-3xl">{t.my.requests}</h2>
            <Link to="/prive/solicitudes" className="text-[11px] tracking-[0.2em] uppercase prive-gold inline-flex items-center gap-1 min-h-[44px]">{t.my.requestsAll}<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>
          </div>
          {open.length ? (
            <ul className="space-y-2">
              {open.map((r) => (
                <li key={r.id} className="prive-panel px-5 py-4 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="prive-serif text-lg">{r.title}</span>
                  <span className={`text-xs ${r.is_confirmed ? "text-emerald-300" : "prive-muted"}`}>{r.status_text} · {shortDate(r.created_at, lang)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm prive-muted">{t.my.requestsEmpty}</p>}
        </section>
      )}
      <ValueOfYourPrive />
      <section aria-labelledby="prive-my-settings" className="space-y-5">
        <h2 id="prive-my-settings" className="text-3xl">{t.my.settings}</h2>
        <PriveMembership embedded />
      </section>
    </div>
  );
}
