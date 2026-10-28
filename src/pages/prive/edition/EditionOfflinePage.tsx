// Lectura SIN CONEXIÓN de THE PRIVATE EDITION (piloto). Ruta propia fuera de ProtectedRoute/PriveRoot: en un
// avión la sesión de IATOS no se puede renovar y la sesión Privé no se puede comprobar, así que esta pantalla
// NO llama a la red: lee solo las copias que ESTE usuario guardó en ESTE dispositivo (se borran al cerrar
// sesión). No permite reservar, pagar ni consultar disponibilidad. Al volver la red (y con sesión Privé
// vigente) compara con el servidor: quita lo retirado y actualiza lo corregido.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { ArticleView, Cover, IssueIndex, ReadingModeToggle, useOnline, useReadingMode } from "@/components/prive/edition/Magazine";
import { MagazineReader } from "@/components/prive/edition/MagazineReader";
import { readView, writeView, type EditionView } from "@/lib/priveMagazine";
import { DEFAULT_PREFS, formatDate, personalizeIssue, reconcilePack, resolveLanguage, txt, type EditionImage, type IssuePayload } from "@/lib/priveEdition";
import { cachedImageUrl, listOfflinePacks, readOfflinePack, replaceOfflinePayload, storedUserId, type OfflineIndexEntry, type OfflinePack } from "@/lib/priveEditionOffline";
import { priveApi } from "@/lib/priveApi";
import { readPriveSession } from "@/lib/priveSession";
import { editionText } from "@/lib/priveEditionI18n";
import { usePriveFont } from "@/components/prive/usePriveFont";
import "@/components/prive/prive.css";
import "@/components/prive/edition/edition.css";

/** Las fotos de la copia salen de Cache Storage como blob: (no dependen de la red ni del Service Worker). */
function useLocalImages(images: Record<string, EditionImage> | undefined) {
  const [map, setMap] = useState<Record<string, EditionImage>>({});
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    (async () => {
      const out: Record<string, EditionImage> = {};
      for (const [k, img] of Object.entries(images ?? {})) {
        const local = await cachedImageUrl(img.url);
        if (local) { urls.push(local); out[k] = { ...img, url: local }; }
      }
      if (alive) setMap(out);
    })();
    return () => { alive = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [images]);
  return map;
}

export default function EditionOfflinePage() {
  usePriveFont();
  const [params, setParams] = useSearchParams();
  const online = useOnline();
  const uid = useMemo(() => storedUserId(), []);
  const [packs, setPacks] = useState<OfflineIndexEntry[] | null>(null);
  const [pack, setPack] = useState<OfflinePack | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const packId = params.get("p");
  const slug = params.get("a");
  const lang = pack?.lang ?? resolveLanguage(null, typeof navigator !== "undefined" ? navigator.language : "es");
  const T = editionText(lang);
  const [reading, setReading] = useReadingMode();
  const [view, setViewState] = useState<EditionView>(readView);
  const setView = (v: EditionView) => { setViewState(v); writeView(v); };

  useEffect(() => { if (uid) void listOfflinePacks(uid).then(setPacks); else setPacks([]); }, [uid]);
  useEffect(() => {
    if (!uid) return;
    const id = packId ?? packs?.[0]?.id;
    if (!id) { setPack(null); return; }
    void readOfflinePack(uid, id).then(setPack);
  }, [uid, packId, packs]);

  // Al volver la red: reconciliar con lo publicado (solo con sesión Privé vigente; si no, no se llama).
  useEffect(() => {
    if (!online || !uid || !pack) return;
    const s = readPriveSession(uid);
    if (!s) return;
    let alive = true;
    void priveApi.content<IssuePayload>("prive_edition_issue", s.token, { _slug: pack.issue }).then(async (r) => {
      if (!alive || !r.ok || !r.data?.found) return;
      const { next, updated, removed } = reconcilePack(pack.payload, r.data);
      if (updated.length || removed.length) {
        await replaceOfflinePayload(uid, pack.id, next);
        setPack({ ...pack, payload: next });
        setNotice(T.offline.updated(updated.length, removed.length));
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, uid, pack?.id]);

  const images = useLocalImages(pack?.payload.images);
  const payload = useMemo<IssuePayload | null>(() => (pack ? { ...pack.payload, images } : null), [pack, images]);
  const ed = useMemo(() => (payload?.found ? personalizeIssue(payload, { ...DEFAULT_PREFS, reading_minutes: 120 }) : null), [payload]);
  const article = slug ? payload?.articles?.find((a) => a.slug === slug) : null;
  const hrefFor = (s: string) => `/prive/edicion/sin-conexion?p=${encodeURIComponent(pack?.id ?? "")}&a=${encodeURIComponent(s)}`;

  return (
    <div className="prive-root">
      <div className="ped min-h-screen" lang={lang} data-testid="edition-offline" data-reading={reading}>
        <div className={`ped-banner ${online ? "!bg-[#0f1a12] !text-[#cde8cf] !border-[#2d5a35]" : ""}`} role="status">
          {online ? <Wifi className="inline h-4 w-4 mr-2" aria-hidden="true" /> : <WifiOff className="inline h-4 w-4 mr-2" aria-hidden="true" />}
          {online ? T.offline.online : T.offline.banner}
          {pack && <small>{T.offline.generated} {formatDate(pack.generated_at, lang)} · {T.offlineNoBooking}</small>}
          {notice && <small data-testid="offline-notice">{notice}</small>}
        </div>
        <div className="flex items-center justify-between px-4 sm:px-8 py-2">
          {article && view === "continuous" ? (
            <button type="button" onClick={() => { params.delete("a"); setParams(params); }} className="inline-flex items-center gap-1 min-h-[44px] text-xs tracking-[0.2em] uppercase text-[color:var(--ped-muted)]">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />{T.contents}
            </button>
          ) : online ? (
            <Link to="/prive/edicion" className="inline-flex items-center gap-1 min-h-[44px] text-xs tracking-[0.2em] uppercase text-[color:var(--ped-muted)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{T.brand}</Link>
          ) : <span />}
          <span className="inline-flex items-center gap-3"><span className="ped-masthead text-sm text-[color:var(--ped-champagne)]">{T.offline.title}</span>
            {view === "continuous" && pack && (
              <button type="button" className="ped-btn ghost !min-h-[40px] !px-3 !text-[0.62rem]" onClick={() => setView("magazine")} data-testid="mz-enter">{T.mz.magazine}</button>
            )}
            <ReadingModeToggle mode={reading} onChange={setReading} lang={lang} /></span>
        </div>
        {!uid || (packs && packs.length === 0) ? (
          <div className="px-4 py-24 text-center space-y-4" data-testid="offline-empty">
            <p className="ped-dek">{T.library.noOffline}</p>
            {/* Qué hacer (auditoría 28-oct): sin esto la pantalla quedaba en un vacío sin salida. */}
            <p className="text-sm text-[color:var(--ped-muted)] max-w-md mx-auto">{T.offline.howTo}</p>
            {online && <Link to="/prive/edicion" className="ped-btn ghost inline-flex">{T.offline.goEdition}</Link>}
          </div>
        ) : !pack || !payload || !ed ? (
          <div className="min-h-[50vh]" role="status" aria-label="…" />
        ) : view === "magazine" ? (
          // La copia sin conexión también se lee como revista (sin red: sin reservas ni enlaces que la necesiten).
          <>
          {(packs?.length ?? 0) > 1 && (
            <nav className="px-4 sm:px-8 pb-3 flex flex-wrap gap-2" aria-label={T.offline.pick}>
              {packs!.map((p) => (
                <button key={p.id} type="button" className="ped-choice text-xs" aria-pressed={p.id === pack.id} onClick={() => setParams({ p: p.id })}>{p.title}</button>
              ))}
            </nav>
          )}
          <MagazineReader key={`${pack.id}:${slug ?? ""}`} issue={payload.issue ?? null} ed={ed} images={images} lang={lang} startSlug={slug} offline
            onExit={(s) => { setView("continuous"); const p = new URLSearchParams(params); if (s) p.set("a", s); else p.delete("a"); setParams(p); }} />
          </>
        ) : article ? (
          <ArticleView article={article} images={images} lang={lang} issue={payload.issue} offline />
        ) : (
          <>
            {(packs?.length ?? 0) > 1 && (
              <nav className="px-4 sm:px-8 pb-3 flex flex-wrap gap-2" aria-label={T.offline.pick}>
                {packs!.map((p) => (
                  <button key={p.id} type="button" className="ped-choice text-xs" aria-pressed={p.id === pack.id} onClick={() => setParams({ p: p.id })}>{p.title}</button>
                ))}
              </nav>
            )}
            <Cover issue={payload.issue!} images={images} lang={lang} coverImage={ed.coverImage} coverArticle={ed.cover} personalized={false}
              readHref={ed.cover ? hrefFor(ed.cover.slug) : undefined} />
            <div className="mx-auto max-w-4xl px-4 sm:px-8 py-12">
              <p className="ped-meta">{pack.title} · {pack.article_count} · {Math.round(pack.bytes / 1024)} KB</p>
              <IssueIndex sections={ed.sections.filter((s) => s.key !== "oportunidades")} lang={lang} hrefFor={hrefFor} readingMinutes={ed.readingMinutes} moreTime={ed.moreTime} />
              {pack.guide && pack.guide.tips.length > 0 && (
                <section className="mt-14" aria-labelledby="offline-guide" data-testid="offline-guide">
                  <p className="ped-kicker">{T.flight.guideKicker}</p>
                  <h2 id="offline-guide" className="ped-display text-4xl mt-2">{T.flight.guideTitle(pack.guide.destination)}</h2>
                  <p className="ped-meta mt-2">{T.flight.guideNote(formatDate(pack.guide.as_of, lang))}</p>
                  <ol className="list-none p-0 mt-6 space-y-6">
                    {pack.guide.tips.map((tip) => (
                      <li key={tip.id} className="border-t border-[color:var(--ped-line,rgba(201,169,97,.2))] pt-4">
                        <h3 className="ped-display text-2xl">{txt(tip.title, lang)}</h3>
                        <p className="mt-2 text-[1.05rem] leading-relaxed text-[color:var(--ped-body)]">{txt(tip.body, lang)}</p>
                        <p className="ped-meta mt-2">{T.opp.source}: {tip.source.name} · {T.flight.checked} {formatDate(tip.source.checked_at, lang)}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
