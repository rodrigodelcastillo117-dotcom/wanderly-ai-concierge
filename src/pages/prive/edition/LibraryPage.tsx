// LIBRARY: números publicados, The Reading List (guardados) y las copias guardadas en este dispositivo.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, WifiOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { PriveLocked } from "@/components/prive/catalog/PriveLocked";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { formatDate, imageAllowed, txt } from "@/lib/priveEdition";
import type { LibraryPayload, SavedPayload } from "@/lib/priveEditionApi";
import { deleteOfflinePack, listOfflinePacks, type OfflineIndexEntry } from "@/lib/priveEditionOffline";
import { editionText } from "@/lib/priveEditionI18n";

export default function LibraryPage() {
  const { api, lang } = useEdition();
  const { user } = useAuth();
  const T = editionText(lang);
  const [lib, setLib] = useState<LibraryPayload | null>(null);
  const [saved, setSaved] = useState<SavedPayload | null>(null);
  const [packs, setPacks] = useState<OfflineIndexEntry[]>([]);
  const [locked, setLocked] = useState<string | null>(null);
  const refreshPacks = useCallback(() => { if (user) void listOfflinePacks(user.id).then(setPacks); }, [user]);
  useEffect(() => {
    let alive = true;
    Promise.all([api.library(), api.saved()]).then(([l, s]) => { if (alive) { setLib(l); setSaved(s); } })
      .catch((e) => { if (alive && e instanceof PriveLockedError) setLocked(e.code); });
    refreshPacks();
    return () => { alive = false; };
  }, [api, refreshPacks]);
  if (locked) return <PriveLocked code={locked as never} />;
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-8 py-10">
      <p className="ped-kicker">{T.library.sub}</p>
      <h1 className="ped-display text-5xl sm:text-6xl mt-2">{T.library.title}</h1>
      <section className="mt-10" aria-labelledby="lib-issues">
        <h2 id="lib-issues" className="ped-kicker">{T.library.issues}</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(lib?.issues ?? []).map((i) => {
            const img = i.cover_image ? lib?.images[i.cover_image] : undefined;
            return (
              <Link key={i.slug} to={`/prive/edicion/numero/${i.slug}`} className="ped-card" data-testid="library-issue">
                {imageAllowed(img, "online") && <div className="ph" style={{ aspectRatio: "3/4" }}><img src={img.url} alt={txt(img.alt, lang)} loading="lazy" style={{ objectPosition: img.focal }} /></div>}
                <div className="tx">
                  <p className="ped-kicker">{T.issueNo(i.number)} · {txt(i.period_label, lang)}</p>
                  <p className="tt">{txt(i.title, lang)}</p>
                  <p className="ped-meta mt-1">{i.article_count} · {formatDate(i.published_at, lang)}</p>
                </div>
              </Link>
            );
          })}
          {lib && lib.issues.length === 0 && <p className="ped-dek">{T.emptyIssue}</p>}
        </div>
      </section>
      <div className="ped-spread mt-14">
        <section aria-labelledby="lib-rl">
          <h2 id="lib-rl" className="ped-display text-4xl">{T.library.readingList}</h2>
          <p className="ped-meta">{T.library.readingListSub}</p>
          <ul className="list-none p-0 mt-4" data-testid="reading-list">
            {(saved?.items ?? []).map((a) => (
              <li key={a.slug}><Link to={`/prive/edicion/articulo/${a.slug}`} className="ped-toc-item"><span className="n">◆</span>
                <span><span className="t">{txt(a.title, lang)}</span><span className="d">{txt(a.kicker, lang)}</span></span><span className="ped-meta">{a.reading_minutes} min</span></Link></li>
            ))}
          </ul>
          {saved && saved.items.length === 0 && <p className="ped-meta mt-3">{T.library.emptyList}</p>}
        </section>
        <section aria-labelledby="lib-off">
          <h2 id="lib-off" className="ped-display text-4xl flex items-center gap-2"><WifiOff className="h-6 w-6 text-[color:var(--ped-gold)]" aria-hidden="true" />{T.library.offlineCopies}</h2>
          <ul className="list-none p-0 mt-4" data-testid="offline-packs">
            {packs.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-b border-[color:var(--ped-line)] py-3">
                <Link to={`/prive/edicion/sin-conexion?p=${encodeURIComponent(p.id)}`} className="min-w-0">
                  <span className="block ped-display text-xl">{p.title}</span>
                  <span className="ped-meta">{p.article_count} · {p.image_count} img · {Math.round(p.bytes / 1024)} KB · {T.offline.generated} {formatDate(p.generated_at, lang)}</span>
                </Link>
                <button type="button" className="ped-choice !px-3" aria-label={`${T.library.remove}: ${p.title}`}
                  onClick={() => { if (user) void deleteOfflinePack(user.id, p.id).then(refreshPacks); }}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          {packs.length === 0 && <p className="ped-meta mt-3">{T.library.noOffline} <Link to="/prive/edicion/vuelo" className="ped-link">Flight Edition</Link></p>}
        </section>
      </div>
    </div>
  );
}
