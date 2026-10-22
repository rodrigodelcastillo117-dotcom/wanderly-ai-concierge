// Mis planes de The Privé Key con seguimiento honesto: el estado de cada paso sale de lo que existe (en el viaje
// sin reservar, solicitud con su estado real, confirmado solo con evidencia del proveedor). Nunca se inventa.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { usePriveKeyApi, type SavedPlan } from "@/lib/priveKey";
import { TIER_META } from "../../../../supabase/functions/_shared/priveKey";
import type { KeyLang, KeyText } from "@/lib/priveKeyI18n";

const TONE: Record<string, string> = { confirmado_por_proveedor: "pk-badge-ok", rechazado: "pk-badge-warn", caducado: "pk-badge-warn", cancelado: "pk-badge-warn" };

export function MyPlans({ t, lang, refreshKey = 0 }: { t: KeyText; lang: KeyLang; refreshKey?: number }) {
  const api = usePriveKeyApi();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<SavedPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try { setPlans(await api.plans()); setFailed(false); }
    catch (e) { if (e instanceof PriveLockedError) navigate("/prive", { replace: true }); else setFailed(true); }
  }, [api, navigate]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return (
    <section aria-labelledby="pk-myplans" className="space-y-4" data-testid="pk-myplans">
      <div>
        <h2 id="pk-myplans" className="prive-serif text-2xl">{t.myPlans}</h2>
        <p className="text-sm prive-muted">{t.myPlansSub}</p>
      </div>
      {plans === null && !failed && <p className="text-sm prive-muted" role="status">…</p>}
      {failed && <button type="button" className="pk-chip" onClick={() => void load()}>{lang === "en" ? "Retry" : "Reintentar"}</button>}
      {plans?.length === 0 && <p className="text-sm prive-muted">{t.noPlans}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {plans?.map((p) => (
          <li key={p.id} className="pk-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="pk-tier-title text-xs">{p.mode === "surprise" ? "SURPRISE ME" : TIER_META[p.tier].title}</p>
                {p.wish && <p className="mt-1 text-sm prive-champagne">“{p.wish}”</p>}
                {p.trip_label && <p className="text-xs prive-muted">{t.forTrip(p.trip_label)}</p>}
              </div>
              <button type="button" className="text-xs prive-muted underline-offset-2 hover:underline" onClick={async () => { await api.archive(p.id).catch(() => null); void load(); }}>{t.archive}</button>
            </div>
            <ol className="mt-3 space-y-2">
              {p.steps.map((s, i) => (
                <li key={`${s.experience_id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {s.start && <span className="pk-time mr-2">{s.start}</span>}
                    {s.experience?.slug ? <Link className="hover:text-[color:var(--pv-gold)]" to={`/prive/experiencia/${s.experience.slug}`}>{s.experience.name}</Link>
                      : <span className="prive-muted">{s.experience?.age_locked ? (lang === "en" ? "Adults only" : "Solo mayores de edad") : "—"}</span>}
                    {!s.available && <span className="ml-2 text-xs text-amber-300">{lang === "en" ? "no longer available" : "ya no disponible"}</span>}
                  </span>
                  <span className={`pk-badge ${TONE[s.follow_up] ?? ""}`}>{t.followUp[s.follow_up] ?? s.follow_up}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
