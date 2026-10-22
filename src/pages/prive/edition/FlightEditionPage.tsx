// FLIGHT EDITION · "Download My Flight Edition": el miembro elige viaje o destino, temas, tiempo, idioma y
// guía del destino; la edición se arma en el navegador con el número publicado (sin IA ni costo por miembro)
// y se descarga en PDF (jsPDF perezoso) o se guarda para leer sin conexión (Cache Storage + SW).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Plane, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { useOnline } from "@/components/prive/edition/Magazine";
import {
  destinationLabel, effectiveWeights, INTERESTS, liveOpportunities, matchDestination, selectFlightEdition, txt, type Lang,
} from "@/lib/priveEdition";
import { saveOfflinePack, storageInfo, warmAppShell, type StorageInfo } from "@/lib/priveEditionOffline";
import { editionText } from "@/lib/priveEditionI18n";

type Trip = { id: string; destino: string; pais_destino: string | null; fecha_salida: string | null; fecha_regreso: string | null };
const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

export default function FlightEditionPage() {
  const { issue, lang: uiLang, prefs, api } = useEdition();
  const { user } = useAuth();
  const online = useOnline();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState<string>("");
  const [destination, setDestination] = useState<string>("");
  const [interests, setInterests] = useState<string[]>(() => Object.keys(effectiveWeights(prefs)).slice(0, 6));
  const [minutes, setMinutes] = useState(20);
  const [lang, setLang] = useState<Lang>(uiLang);
  const [guide, setGuide] = useState(true);
  const [whole, setWhole] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pdf" | "offline" | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const T = editionText(uiLang);

  useEffect(() => {
    void storageInfo().then(setStorage);
    if (!user) return;
    void (supabase.from("trips").select("id,destino,pais_destino,fecha_salida,fecha_regreso") as unknown as Promise<{ data: Trip[] | null }>)
      .then(({ data }) => {
        const today = new Date().toISOString().slice(0, 10);
        setTrips((data ?? []).filter((t) => !t.fecha_regreso || t.fecha_regreso >= today).slice(0, 20));
      });
  }, [user]);

  const destinations = useMemo(() => [...new Set((issue?.articles ?? []).flatMap((a) => a.destinations))], [issue]);
  const trip = trips.find((t) => t.id === tripId);
  const dest = trip ? matchDestination(trip.destino, issue?.articles ?? []) : destination || null;
  const articles = useMemo(() => {
    if (!issue?.found) return [];
    if (whole) return [...(issue.articles ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    return selectFlightEdition(issue, { destination: dest, interests, minutes, includeGuide: guide });
  }, [issue, whole, dest, interests, minutes, guide]);
  const total = articles.reduce((s, a) => s + a.reading_minutes, 0);
  const label = trip ? trip.destino : dest ? destinationLabel(dest, lang) : null;
  const packId = whole ? `issue-${issue?.issue?.slug}-${lang}` : `flight-${issue?.issue?.slug}-${dest ?? "any"}-${lang}`;

  const onPdf = async () => {
    if (!issue?.found) return;
    setBusy("pdf"); setStatus(T.flight.pdfWorking);
    try {
      const opp = await api.opportunities({ destination: dest, interests: interests.length ? interests : null }).catch(() => null);
      const { buildEditionPdf, downloadPdf } = await import("@/lib/priveEditionPdf");
      const r = await buildEditionPdf({
        payload: issue, articles, lang, kind: whole ? "issue" : "flight", destinationLabel: whole ? null : label,
        memberName: prefs.show_name_on_cover ? prefs.first_name ?? null : null,
        opportunities: opp?.available ? liveOpportunities(opp.items) : opp ? [] : null, opportunitiesAsOf: opp?.generated_at ?? null,
        appOrigin: window.location.origin,
      });
      downloadPdf(r);
      setStatus(T.flight.pdfDone(Math.round(r.bytes.length / 1024), r.pages));
      void api.logDownload({ issue: issue.issue!.slug, format: "pdf", kind: whole ? "issue" : "flight", articles: articles.length, images: r.imagesEmbedded, bytes: r.bytes.length, ms: r.ms, lang });
    } catch {
      setStatus(T.mine.saveError);
    } finally { setBusy(null); }
  };

  const onOffline = async () => {
    if (!issue?.found || !user) return;
    setBusy("offline"); setStatus(T.flight.offlineWorking);
    const t0 = performance.now();
    // La pantalla de lectura sin conexión y el "app shell" quedan en caché antes de guardar el contenido.
    await import("./EditionOfflinePage").catch(() => null);
    await warmAppShell();
    const r = await saveOfflinePack(user.id, {
      id: packId, kind: whole ? "issue" : "flight", lang, payload: issue, articles,
      title: whole ? `${T.issueNo(issue.issue!.number)} · ${txt(issue.issue!.period_label, lang)}` : `Flight Edition${label ? ` · ${label}` : ""}`,
    });
    setBusy(null);
    setStorage(await storageInfo());
    if (!r.ok) { setStatus(T.flight.offlineFail); return; }
    setStatus(T.flight.offlineDone(r.articles, r.images, Math.round(r.bytes / 1024)));
    void api.logDownload({ issue: issue.issue!.slug, format: "offline", kind: whole ? "issue" : "flight", articles: r.articles, images: r.images, bytes: r.bytes, ms: Math.round(performance.now() - t0), lang });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-8 py-10">
      <p className="ped-kicker">{T.flight.sub}</p>
      <h1 className="ped-display text-5xl sm:text-6xl mt-2 flex items-center gap-3"><Plane className="h-8 w-8 text-[color:var(--ped-gold)]" aria-hidden="true" />{T.flight.title}</h1>
      <p className="ped-dek mt-4 max-w-3xl">{T.flight.intro}</p>
      <div className="ped-spread mt-10">
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()} aria-label={T.flight.title}>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={!whole} className="ped-choice" onClick={() => setWhole(false)}>Flight Edition</button>
            <button type="button" role="radio" aria-checked={whole} className="ped-choice" onClick={() => setWhole(true)}>{uiLang === "en" ? "Whole issue" : "Número completo"}</button>
          </div>
          {!whole && (
            <>
              <label className="block"><span className="ped-field-label">{T.flight.trip}</span>
                <select className="ped-input mt-2" value={tripId} onChange={(e) => setTripId(e.target.value)} data-testid="flight-trip">
                  <option value="">{T.flight.noTrip}</option>
                  {trips.map((t) => <option key={t.id} value={t.id}>{t.destino}{t.fecha_salida ? ` · ${t.fecha_salida}` : ""}</option>)}
                </select>
              </label>
              {!tripId && (
                <label className="block"><span className="ped-field-label">{T.flight.destination}</span>
                  <select className="ped-input mt-2" value={destination} onChange={(e) => setDestination(e.target.value)} data-testid="flight-destination">
                    <option value="">{T.flight.anyDestination}</option>
                    {destinations.map((d) => <option key={d} value={d}>{destinationLabel(d, uiLang)}</option>)}
                  </select>
                </label>
              )}
              {tripId && !dest && <p className="ped-meta" role="note">{uiLang === "en" ? "This issue has no pieces about that destination yet; we will choose by your topics." : "Este número aún no tiene piezas de ese destino; elegimos por tus temas."}</p>}
              <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a961]" checked={guide} onChange={(e) => setGuide(e.target.checked)} />
                <span className="text-sm">{T.flight.guide}</span></label>
              <fieldset><legend className="ped-field-label">{T.flight.interests}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {INTERESTS.map((it) => (
                    <button key={it.key} type="button" className="ped-choice text-xs" aria-pressed={interests.includes(it.key)}
                      onClick={() => setInterests((xs) => xs.includes(it.key) ? xs.filter((x) => x !== it.key) : [...xs, it.key])}>{it[uiLang]}</button>
                  ))}
                </div>
              </fieldset>
              <label className="block"><span className="ped-field-label">{T.flight.minutes}: {minutes} min</span>
                <input type="range" min={5} max={60} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full mt-3 accent-[#c9a961]" /></label>
            </>
          )}
          <label className="block"><span className="ped-field-label">{T.flight.language}</span>
            <select className="ped-input mt-2" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="es">Español</option><option value="en">English</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3 pt-2">
            <button type="button" className="ped-btn" onClick={() => void onPdf()} disabled={!!busy || !articles.length || !online} data-testid="flight-pdf">
              <Download className="h-4 w-4" aria-hidden="true" />{busy === "pdf" ? T.flight.pdfWorking : T.flight.pdf}
            </button>
            <button type="button" className="ped-btn ghost" onClick={() => void onOffline()} disabled={!!busy || !articles.length || !online} data-testid="flight-offline">
              <WifiOff className="h-4 w-4" aria-hidden="true" />{busy === "offline" ? T.flight.offlineWorking : T.flight.offline}
            </button>
          </div>
          {status && <p role="status" className="ped-meta" data-testid="flight-status">{status}</p>}
          <p className="ped-meta">{T.flight.privacy}</p>
          {storage && storage.quota > 0 && <p className="ped-meta">{T.flight.storage(fmtBytes(storage.usage), fmtBytes(storage.quota))}</p>}
          <p className="ped-meta"><Link to="/prive/edicion/sin-conexion" className="ped-link">{T.offline.title}</Link> · {T.flight.audio}</p>
        </form>
        <section aria-labelledby="flight-sel">
          <p className="ped-kicker">{label ? `Flight Edition · ${label}` : "Flight Edition"}</p>
          <h2 id="flight-sel" className="ped-display text-4xl mt-2">{T.flight.ready(articles.length, total)}</h2>
          <ol className="list-none p-0 mt-4" data-testid="flight-selection">
            {articles.map((a, i) => (
              <li key={a.slug} className="ped-toc-item"><span className="n">{String(i + 1).padStart(2, "0")}</span>
                <span><span className="t">{txt(a.title, lang)}</span><span className="d">{txt(a.kicker, lang)}</span></span>
                <span className="ped-meta">{a.reading_minutes} min</span></li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
