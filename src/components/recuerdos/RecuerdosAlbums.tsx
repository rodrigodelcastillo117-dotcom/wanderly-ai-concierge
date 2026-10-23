// "Por viaje": un álbum por viaje con portada, fechas y número de fotos; dentro, la cuadrícula de fotos.
// Compartir el álbum con los miembros del viaje es opcional y empieza apagado.
import { ArrowLeft, Images, Play, Star, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { countLabel, rangeLabelEs, thumbOf, type Album, type RecuerdoItem, type RecuerdoTrip } from "@/lib/recuerdos/model";

export function AlbumGrid({ albums, thumbUrl, onOpen }: { albums: Album[]; thumbUrl: (it: RecuerdoItem) => string | null; onOpen: (id: string) => void }) {
  if (!albums.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-label="Álbumes por viaje">
      {albums.map((a) => {
        const url = a.cover ? thumbUrl(a.cover) : null;
        return (
          <li key={a.id}>
            <button type="button" onClick={() => onOpen(a.id)} data-testid={`album-${a.id}`}
              className="group block w-full overflow-hidden rounded-2xl border border-border bg-surface/50 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <div className="relative aspect-[4/3] bg-black/40">
                {url ? <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105" />
                  : <Images className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
                {a.shared && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-primary"><Users className="h-3 w-3" aria-hidden="true" /> Compartido</span>}
              </div>
              <div className="p-3">
                <p className="truncate font-display text-lg leading-tight">{a.title}</p>
                <p className="truncate text-xs text-muted-foreground">{rangeLabelEs(a.start, a.end)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{countLabel(a.photos, a.videos)}</p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AlbumDetail({ album, items, trip, thumbUrl, onBack, onOpenItem, onShare, sharing }: {
  album: Album;
  items: RecuerdoItem[];
  trip: RecuerdoTrip | undefined;
  thumbUrl: (it: RecuerdoItem) => string | null;
  onBack: () => void;
  onOpenItem: (index: number) => void;
  onShare?: (shared: boolean) => void;
  sharing?: boolean;
}) {
  return (
    <section aria-label={`Álbum ${album.title}`} className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Todos los álbumes
      </button>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-display text-2xl md:text-3xl">{album.title}</h2>
          <p className="text-sm text-muted-foreground">{rangeLabelEs(album.start, album.end)} · {countLabel(album.photos, album.videos)}</p>
        </div>
        {trip && onShare && (
          <div className="rounded-2xl border border-border p-3 md:max-w-sm">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="album-share" className="text-sm font-semibold">Compartir con los del viaje</label>
              <Switch id="album-share" checked={album.shared} disabled={sharing} onCheckedChange={(v) => onShare(v)} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {album.shared ? "Los miembros de este viaje ven tus fotos de este álbum (nadie más)." : "Solo tú ves estas fotos. Puedes compartirlas con quienes viajaron contigo."}
            </p>
          </div>
        )}
      </div>
      {album.fromOthers > 0 && <p className="text-xs text-muted-foreground">Incluye {album.fromOthers} {album.fromOthers === 1 ? "foto compartida" : "fotos compartidas"} por otros miembros del viaje.</p>}
      <ul className="grid grid-cols-3 gap-1 md:grid-cols-5 md:gap-2">
        {items.map((it, i) => {
          const url = thumbUrl(it);
          return (
            <li key={it.key}>
              <button type="button" onClick={() => onOpenItem(i)} aria-label={`Abrir ${it.mediaType === "video" ? "video" : "foto"} ${i + 1}`}
                className="relative block aspect-square w-full overflow-hidden rounded-lg bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {url ? <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  : thumbOf(it) == null ? <Play className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/70" aria-hidden="true" /> : null}
                {it.mediaType === "video" && url && <Play className="absolute right-1 top-1 h-3.5 w-3.5 text-white" aria-hidden="true" />}
                {it.favorite && <Star className="absolute bottom-1 left-1 h-3.5 w-3.5 fill-primary text-primary" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
