// /dashboard/recuerdos — "Recuerdos": las fotos y videos de la persona por fecha y por viaje, en
// calendario o en álbumes. Junta lo que sube aquí con sus Mejores momentos y las fotos de su diario
// (sin copiarlas). IATOS Wrapped toma de aquí las fotos del año y las favoritas ⭐ para «Hazme mi video».
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clapperboard, Images, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localISODate } from "@/lib/localDate";
import { deleteRecuerdo, loadRecuerdos, moveToTrip, setAlbumShared, setFavorite, type RecuerdosClient, type RecuerdosLoad } from "@/lib/recuerdos/api";
import {
  buildAlbums, filterByTrip, groupByDay, latestMonth, shiftMonth, sortItems, thumbOf, unifyItems, type RecuerdoItem, type RecuerdoRow,
} from "@/lib/recuerdos/model";
import { RecuerdosUploader, type UploadSummary } from "@/components/recuerdos/RecuerdosUploader";
import { RecuerdosCalendar } from "@/components/recuerdos/RecuerdosCalendar";
import { RecuerdosViewer } from "@/components/recuerdos/RecuerdosViewer";
import { AlbumDetail, AlbumGrid } from "@/components/recuerdos/RecuerdosAlbums";
import { useSignedUrls } from "@/components/recuerdos/useSignedUrls";

export const RECUERDOS_TABS = [
  { id: "calendario", label: "Calendario", icon: CalendarDays },
  { id: "viajes", label: "Por viaje", icon: Images },
] as const;
type Tab = (typeof RECUERDOS_TABS)[number]["id"];

export default function Recuerdos({ client: injected }: { client?: RecuerdosClient } = {}) {
  const { user } = useAuth();
  const client = (injected ?? (supabase as unknown as RecuerdosClient));
  const today = localISODate();
  const [data, setData] = useState<RecuerdosLoad | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<Tab>("calendario");
  const [filter, setFilter] = useState("todos");
  const [ym, setYm] = useState<{ year: number; month: number } | null>(null);
  const [viewer, setViewer] = useState<{ keys: string[]; index: number } | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const signed = useSignedUrls(client);

  useEffect(() => { document.title = "Recuerdos · IATOS"; }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError(false);
    loadRecuerdos(client, user.id)
      .then((d) => { if (cancelled) return; setData(d); setYm((cur) => cur ?? latestMonth(d.items, today)); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [user?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => filterByTrip(data?.items ?? [], filter), [data, filter]);
  const byKey = useMemo(() => new Map((data?.items ?? []).map((i) => [i.key, i])), [data]);
  const albums = useMemo(() => (data ? buildAlbums(data.items, data.trips, data.sharedTrips) : []), [data]);
  const month = ym ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 };
  const mm = `${month.year}-${String(month.month + 1).padStart(2, "0")}`;
  const monthItems = useMemo(() => items.filter((i) => i.day.slice(0, 7) === mm), [items, mm]);
  const album = albums.find((a) => a.id === albumId) ?? null;
  const albumItems = useMemo(() => (album ? sortItems((data?.items ?? []).filter((i) => (i.tripId ?? "sin-viaje") === album.id)) : []), [album, data]);

  const thumbUrl = useCallback((it: RecuerdoItem) => it.legacyUrl ?? signed.get(it.bucket, thumbOf(it)), [signed]);
  const fullUrl = useCallback((it: RecuerdoItem) => signed.get(it.bucket, it.path), [signed]);

  // Miniaturas de lo que está en pantalla.
  useEffect(() => {
    const visible = tab === "calendario" ? monthItems : album ? albumItems : albums.map((a) => a.cover).filter((c): c is RecuerdoItem => !!c);
    signed.request(visible.map((it) => ({ bucket: it.bucket, path: thumbOf(it) })));
  }, [tab, monthItems, album, albumItems, albums, signed.request]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewerItems = useMemo(() => (viewer ? viewer.keys.map((k) => byKey.get(k)).filter((x): x is RecuerdoItem => !!x) : []), [viewer, byKey]);
  useEffect(() => {
    if (!viewer) return;
    const near = viewerItems.slice(Math.max(0, viewer.index - 1), viewer.index + 2);
    signed.request(near.map((it) => ({ bucket: it.bucket, path: it.path })));
  }, [viewer, viewerItems, signed.request]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchItem = (key: string, patch: Partial<RecuerdoItem>) =>
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : d));

  const onUploaded = useCallback((row: RecuerdoRow) => {
    if (!user) return;
    const [it] = unifyItems(user.id, { recuerdos: [row], moments: [], journal: [] });
    setData((d) => (d ? { ...d, items: sortItems([...d.items, it]) } : d));
  }, [user]);
  const onDone = useCallback((s: UploadSummary) => {
    if (s.ok) toast.success(`${s.ok === 1 ? "Se guardó 1 recuerdo" : `Se guardaron ${s.ok} recuerdos`}${s.byTrip ? `; ${s.byTrip} quedaron en su viaje por la fecha` : ""}.`);
    if (s.failed) toast.error(s.failed === 1 ? "Un archivo no se pudo subir (mira el motivo en la lista)." : `${s.failed} archivos no se pudieron subir (mira el motivo en la lista).`);
  }, []);

  const openDay = (day: string) => {
    const list = groupByDay(items).get(day) ?? [];
    if (list.length) setViewer({ keys: list.map((i) => i.key), index: 0 });
  };

  const onFavorite = async (it: RecuerdoItem, fav: boolean) => {
    patchItem(it.key, { favorite: fav });
    if (!(await setFavorite(client, it.id, fav))) { patchItem(it.key, { favorite: !fav }); toast.error("No se pudo guardar. Intenta de nuevo."); }
  };
  const onMove = async (it: RecuerdoItem, tripId: string | null) => {
    const prev = { tripId: it.tripId, tripSource: it.tripSource };
    patchItem(it.key, { tripId, tripSource: tripId ? "manual" : "ninguno" });
    if (!(await moveToTrip(client, it.id, tripId))) { patchItem(it.key, prev); toast.error("No se pudo mover. Intenta de nuevo."); return; }
    const t = data?.trips.find((x) => x.id === tripId);
    toast.success(tripId ? `Movida a ${t?.destino ?? "ese viaje"}.` : "Quedó sin viaje.");
  };
  const onDelete = async (it: RecuerdoItem) => {
    const ok = await deleteRecuerdo(client, it);
    if (!ok) { toast.error("No se pudo borrar. Intenta de nuevo."); return false; }
    setData((d) => (d ? { ...d, items: d.items.filter((i) => i.key !== it.key) } : d));
    setViewer((v) => (v ? { ...v, keys: v.keys.filter((k) => k !== it.key) } : v));
    return true;
  };
  const onShare = async (shared: boolean) => {
    if (!user || !album || album.id === "sin-viaje") return;
    setSharing(true);
    const ok = await setAlbumShared(client, user.id, album.id, shared);
    setSharing(false);
    if (!ok) { toast.error("No se pudo cambiar. Intenta de nuevo."); return; }
    setData((d) => {
      if (!d) return d;
      const s = new Set(d.sharedTrips);
      if (shared) s.add(album.id); else s.delete(album.id);
      return { ...d, sharedTrips: s };
    });
  };

  const total = data?.items.length ?? 0;
  const favorites = data?.items.filter((i) => i.favorite).length ?? 0;
  return (
    <DashboardLayout>
      <div className="max-w-5xl px-4 py-6 md:p-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 md:mb-6">
          <div>
            <h1 className="mb-1 font-display text-3xl md:mb-2 md:text-5xl">Recuerdos</h1>
            <p className="text-sm text-muted-foreground md:text-base">Tus fotos y videos por fecha y por viaje. Tu IATOS Wrapped hace tu video con ellas.</p>
          </div>
          <Link to="/wrapped?video=1" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/40 px-4 text-sm font-semibold text-primary hover:bg-primary/10">
            <Clapperboard className="h-4 w-4" aria-hidden="true" /> Hazme mi video
          </Link>
        </div>

        {!user ? null : error ? (
          <div className="rounded-2xl border border-border p-8 text-center">
            <p className="font-display text-xl">No pudimos cargar tus recuerdos</p>
            <p className="mt-1 text-sm text-muted-foreground">Revisa tu conexión e intenta de nuevo.</p>
            <button type="button" onClick={() => setReload((n) => n + 1)} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground">Reintentar</button>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-border p-10 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando tus recuerdos…
          </div>
        ) : (
          <div className="space-y-5">
            <RecuerdosUploader client={client} userId={user.id} trips={data.trips} onUploaded={onUploaded} onDone={onDone} />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="tablist" aria-label="Vistas de Recuerdos" className="grid w-full shrink-0 grid-cols-2 rounded-full border border-border bg-surface p-1 sm:inline-grid sm:w-auto">
                {RECUERDOS_TABS.map((t) => {
                  const Icon = t.icon;
                  const sel = tab === t.id;
                  return (
                    <button key={t.id} type="button" role="tab" aria-selected={sel} onClick={() => { setTab(t.id); setAlbumId(null); }}
                      className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm transition ${sel ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" /> {t.label}
                    </button>
                  );
                })}
              </div>
              {tab === "calendario" && (
                // min-w-0 + ancho máximo: con nombres de viaje largos el <select> crecía hasta salirse de la
                // columna y aplastaba las pestañas Calendario / Por viaje (quedaban encimadas e intocables).
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <label htmlFor="recuerdos-filter" className="text-muted-foreground">Viaje:</label>
                  <select id="recuerdos-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-sm sm:w-64 sm:flex-none">
                    <option value="todos">Todos</option>
                    <option value="sin-viaje">Sin viaje</option>
                    {data.trips.map((t) => <option key={t.id} value={t.id}>{t.destino || "Viaje"}</option>)}
                  </select>
                </div>
              )}
            </div>

            {total === 0 ? (
              <div className="rounded-2xl border border-border p-8 text-center">
                <p className="font-display text-xl">Aún no hay recuerdos</p>
                <p className="mt-1 text-sm text-muted-foreground">Sube las fotos de tus viajes: las acomodamos por fecha y por viaje, y tu Wrapped las usa para tu video.</p>
              </div>
            ) : tab === "calendario" ? (
              <RecuerdosCalendar year={month.year} month={month.month} items={items} today={today}
                onMonth={(d) => setYm(shiftMonth(month.year, month.month, d))} onOpenDay={openDay} thumbUrl={thumbUrl} />
            ) : album ? (
              <AlbumDetail album={album} items={albumItems} trip={data.trips.find((t) => t.id === album.id)} thumbUrl={thumbUrl}
                onBack={() => setAlbumId(null)} onOpenItem={(i) => setViewer({ keys: albumItems.map((x) => x.key), index: i })}
                onShare={album.id !== "sin-viaje" ? onShare : undefined} sharing={sharing} />
            ) : (
              <AlbumGrid albums={albums} thumbUrl={thumbUrl} onOpen={setAlbumId} />
            )}

            {total > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                Solo tú ves tus recuerdos (salvo los álbumes que compartas con los de un viaje). Les quitamos la ubicación antes de subirlos.
                {favorites ? ` Tienes ${favorites} ${favorites === 1 ? "favorita" : "favoritas"}: tu video empieza con ellas.` : " Marca tus favoritas ⭐ y tu video empezará con ellas."}
                {" "}Si borras un viaje, se borran también tus fotos de ese viaje.
              </p>
            )}
          </div>
        )}
      </div>

      {viewer && viewerItems.length > 0 && data && (
        <RecuerdosViewer items={viewerItems} index={Math.min(viewer.index, viewerItems.length - 1)} onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setViewer(null)} urlOf={fullUrl} trips={data.trips} onFavorite={onFavorite} onMove={onMove} onDelete={onDelete} />
      )}
    </DashboardLayout>
  );
}
