import { useState } from "react";
import { ExternalLink, Loader2, MapPin, Phone, UtensilsCrossed, BedDouble, Landmark, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SmartImage } from "@/components/media/SmartImage";
import { TripadvisorLink, TripadvisorRating } from "@/components/tripadvisor/TripadvisorRating";

export type TAResult = {
  id: string; name: string; address: string; rating: number | null;
  num_reviews: number | null; ranking: string | null; web_url: string | null;
  phone: string | null; website: string | null; description: string | null;
  photos: string[]; category: string | null;
  /** Google Places: nombre de recurso de la foto (se pide por place-photo). */
  photo_ref?: string | null;
  /** Tripadvisor: página de fotos y cuántas hay (la búsqueda no trae las fotos). */
  photos_url?: string | null;
  photo_count?: number | null;
  write_review_url?: string | null;
};

/**
 * Lugar de Tripadvisor Terra. Nombre y número de reseñas enlazan a su página (Linking Policy). Las
 * fotos NO vienen en la búsqueda: se piden solo si la persona toca "Ver fotos" (1 entidad cobrable);
 * mientras tanto no se pone foto de Google ni ilustrativa junto al contenido de Tripadvisor.
 */
export function TripadvisorPlaceCard({ r, cat }: { r: TAResult; cat: "attractions" | "restaurants" | "hotels" }) {
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const photosHref = r.photos_url ?? r.web_url;
  async function verFotos() {
    setLoadingPhotos(true);
    try {
      const { data, error } = await supabase.functions.invoke("tripadvisor-search", {
        body: { action: "fotos", location_id: r.id, language: "es_MX", uso: "pantalla" },
      });
      if (error) throw error;
      const list: string[] = Array.isArray(data?.photos) ? data.photos : [];
      setPhotos(list);
      if (!list.length) toast.message("Tripadvisor no devolvió fotos de este lugar");
    } catch {
      toast.error("No pudimos traer las fotos. Intenta de nuevo.");
    } finally {
      setLoadingPhotos(false);
    }
  }
  const Icon = cat === "restaurants" ? UtensilsCrossed : cat === "hotels" ? BedDouble : Landmark;
  return (
    <div className="glass-card rounded-2xl overflow-hidden border border-white/10" data-fuente="tripadvisor">
      {photos && photos.length > 0 && (
        <a href={photosHref ?? undefined} target="_blank" rel="noopener noreferrer" aria-label={`Fotos de ${r.name} en Tripadvisor`}>
          <SmartImage alt={r.name} imageUrl={photos[0]} icon={Icon} className="h-48 w-full" googleCredit={false} />
        </a>
      )}
      <div className="p-4 space-y-2">
        <h3 className="font-display text-lg">
          {r.web_url
            ? <a href={r.web_url} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.name}</a>
            : r.name}
        </h3>
        <TripadvisorRating rating={r.rating} numReviews={r.num_reviews} webUrl={r.web_url} />
        {r.ranking && <p className="text-xs text-primary">{r.ranking}</p>}
        {r.address && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{r.address}</p>}
        {r.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{r.phone}</p>}
        {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
        {photos && photos.length > 0 && photosHref && (
          <TripadvisorLink href={photosHref}>Ver todas las fotos en Tripadvisor</TripadvisorLink>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          {r.web_url && (
            <Button size="sm" onClick={() => window.open(r.web_url!, "_blank", "noopener")} className="flex-1">
              Ver en Tripadvisor <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          )}
          {photos === null && (r.photo_count ?? 1) > 0 && (
            <Button size="sm" variant="outline" onClick={verFotos} disabled={loadingPhotos}>
              {loadingPhotos ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Images className="w-3 h-3 mr-1" />}
              Ver fotos
            </Button>
          )}
          {r.website && (
            <Button size="sm" variant="outline" onClick={() => window.open(r.website!, "_blank", "noopener")}>
              Web oficial
            </Button>
          )}
        </div>
        {r.write_review_url && <TripadvisorLink href={r.write_review_url}>Escribir una opinión en Tripadvisor</TripadvisorLink>}
      </div>
    </div>
  );
}
