import { MapPin } from "lucide-react";
import { categoryLabel, isKnownCategory, sourceLine, type MembersVenue } from "@/lib/membersVenues";

type Props = { venue: Pick<MembersVenue, "categoria" | "neighborhood" | "ciudad_display" | "season_state" | "age_policy" | "fuente" | "source_url" | "verified_at"> };

/**
 * Datos extra de un lugar de Members Only: barrio, categoría que la lista no conoce, temporada, edad y
 * de dónde sale lo curado (dominio de la fuente y fecha de verificación). Lo viejo no muestra fuente
 * porque no la tiene.
 */
export function MembersVenueMeta({ venue }: Props) {
  const src = sourceLine(venue);
  const showNeighborhood = !!venue.neighborhood && venue.neighborhood !== venue.ciudad_display;
  const showCat = !!venue.categoria && !isKnownCategory(venue.categoria);
  if (!showNeighborhood && !showCat && !src && venue.season_state !== "cerrado_por_temporada" && venue.age_policy !== "21+") return null;
  return (
    <div className="mb-3 space-y-1">
      {(showNeighborhood || showCat || venue.season_state === "cerrado_por_temporada" || venue.age_policy === "21+") && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {showNeighborhood && (
            <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" />{venue.neighborhood}</span>
          )}
          {showCat && (
            <span className="px-2 py-0.5 rounded-full border border-white/10">{categoryLabel(venue.categoria)}</span>
          )}
          {venue.season_state === "cerrado_por_temporada" && (
            <span className="px-2 py-0.5 rounded-full border border-primary/25 text-foreground/80">Cerrado por temporada</span>
          )}
          {venue.age_policy === "21+" && (
            <span className="px-2 py-0.5 rounded-full border border-primary/25 text-foreground/80">21+</span>
          )}
        </div>
      )}
      {src && <p className="text-[11px] text-muted-foreground">{src}</p>}
    </div>
  );
}
