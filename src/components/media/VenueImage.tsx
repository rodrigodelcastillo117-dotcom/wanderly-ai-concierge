import { Wine } from "lucide-react";
import { SmartImage } from "@/components/media/SmartImage";
import { venueQuery } from "@/lib/categoryImagery";

type VenueLike = {
  nombre: string; ciudad_display: string; categoria: string;
};

/**
 * Portada de un venue de Members Only: la foto real del lugar (Google, solo si encuentra ESE lugar
 * por nombre y ciudad) o, si no, una foto ilustrativa de su categoría marcada como tal.
 */
export function VenueImage({ venue, className = "h-44 w-full", size = "card" }: {
  venue: VenueLike; className?: string; size?: "card" | "hero" | "thumb";
}) {
  return (
    <SmartImage
      alt={`Foto de ${venue.nombre}`}
      lookup={{ name: venue.nombre, city: venue.ciudad_display }}
      stockQuery={venueQuery(venue.categoria)}
      size={size}
      icon={Wine}
      className={className}
      imgClassName="group-hover:scale-105"
      captionPosition="bottom-right"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
    </SmartImage>
  );
}

export default VenueImage;
