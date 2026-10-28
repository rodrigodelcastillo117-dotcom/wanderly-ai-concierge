import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MapPin, ExternalLink, CalendarCheck, X, Sparkles } from "lucide-react";
import { MembersVenueMeta } from "@/components/MembersVenueMeta";
import type { MembersVenue } from "@/lib/membersVenues";
import { VenueImage } from "@/components/media/VenueImage";

interface Venue {
  id: string;
  ciudad: string;
  ciudad_display: string;
  categoria: string;
  emoji: string | null;
  nombre: string;
  por_que: string | null;
  descripcion: string | null;
  dress_code: string | null;
  precio_estimado: string | null;
  reserva_requerida: boolean;
  tags: string[] | null;
  address: string | null;
  website: string | null;
  // Solo lo curado de Privé (members_venues): barrio, fuente y fecha de verificación.
  fuente?: MembersVenue["fuente"];
  neighborhood?: string | null;
  source_url?: string | null;
  verified_at?: string | null;
  season_state?: string | null;
  age_policy?: string | null;
}

interface Props<V extends Venue> {
  venue: V | null;
  open: boolean;
  onClose: () => void;
  onReserve: (v: V) => void;
  reserving: boolean;
}

export function VenueDetailDialog<V extends Venue>({ venue, open, onClose, onReserve, reserving }: Props<V>) {
  if (!venue) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border-primary/30 bg-gradient-to-b from-black/95 to-black/80 backdrop-blur-2xl p-0 overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 grid place-items-center rounded-full bg-black/60 backdrop-blur border border-primary/20 text-muted-foreground hover:text-foreground transition"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>
        <VenueImage venue={venue} size="hero" className="h-52 sm:h-60 w-full" />
        <div className="relative p-8 pt-6">
          <div className="flex items-center gap-2 text-primary text-[10px] tracking-[0.22em] uppercase mb-3">
            <Sparkles className="w-3 h-3" />
            {venue.ciudad_display}
          </div>

          <div className="flex items-start gap-4 mb-4">
            <div className="flex-1 min-w-0">
              {/* Título accesible del diálogo (antes: error "DialogContent requires a DialogTitle", Privé P1-6). */}
              <DialogTitle className="font-fraunces text-3xl text-foreground leading-tight font-normal">{venue.nombre}</DialogTitle>
              <DialogDescription className="sr-only">{`Ficha de ${venue.nombre} en ${venue.ciudad_display}: fuente, verificación y cómo pedir mesa.`}</DialogDescription>
              {venue.por_que && (
                <p className="text-primary text-sm mt-2 leading-snug font-fraunces italic">
                  {venue.por_que}
                </p>
              )}
            </div>
          </div>

          <MembersVenueMeta venue={{
            categoria: venue.categoria, ciudad_display: venue.ciudad_display, neighborhood: venue.neighborhood ?? null,
            season_state: venue.season_state ?? null, age_policy: venue.age_policy ?? null,
            fuente: venue.fuente ?? "members", source_url: venue.source_url ?? null, verified_at: venue.verified_at ?? null,
          }} />

          {venue.descripcion && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">{venue.descripcion}</p>
          )}

          <div className="grid grid-cols-2 gap-3 mb-5">
            {venue.dress_code && (
              <div className="rounded-xl border border-primary/15 bg-black/30 p-3">
                <p className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-1">Dress code</p>
                <p className="text-sm text-foreground">{venue.dress_code}</p>
              </div>
            )}
            {venue.precio_estimado && (
              <div className="rounded-xl border border-primary/15 bg-black/30 p-3">
                <p className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-1">Precio estimado</p>
                <p className="text-sm text-primary">{venue.precio_estimado}</p>
              </div>
            )}
            {venue.address && (
              <div className="rounded-xl border border-primary/15 bg-black/30 p-3 col-span-2">
                <p className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-1">Dirección</p>
                <p className="text-sm text-foreground">{venue.address}</p>
              </div>
            )}
          </div>

          {(venue.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {venue.reserva_requerida && (
                <span className="px-2.5 py-1 rounded-full text-[10px] tracking-wide bg-primary/15 text-primary">
                  Reserva requerida
                </span>
              )}
              {(venue.tags ?? []).map((t) => (
                <span key={t} className="px-2.5 py-1 rounded-full text-[10px] tracking-wide border border-white/10 text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onReserve(venue)}
              disabled={reserving}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm bg-gradient-gold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              <CalendarCheck className="w-4 h-4" />
              {reserving ? "Enviando…" : "Reservar con Concierge"}
            </button>
            {venue.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.nombre} ${venue.address}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm border border-primary/25 text-foreground hover:bg-primary/10 transition"
              >
                <MapPin className="w-4 h-4" /> Cómo llegar
              </a>
            )}
            {venue.website && (
              <a
                href={venue.website}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm border border-primary/25 text-foreground hover:bg-primary/10 transition"
              >
                <ExternalLink className="w-4 h-4" /> Sitio oficial
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
