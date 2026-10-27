import { ExternalLink } from "lucide-react";

/**
 * Atribución de Tripadvisor Terra según sus políticas (consultadas el 27-oct-2026):
 *  - Linking Policy: el nombre del lugar, el número de reseñas y las fotos enlazan a la página del
 *    lugar en Tripadvisor; "Ver todas las fotos" enlaza a Tripadvisor.
 *  - Brand Guidelines for Partners: la palabra "Tripadvisor" (T mayúscula, a minúscula, sin espacio)
 *    en la misma pantalla; la calificación con el texto "Tripadvisor Traveler Rating" (aquí en
 *    español) y el número de reseñas; burbujas #00B747 (#00EB5B en modo oscuro, el de IATOS), las
 *    vacías transparentes con contorno verde, sobre fondo negro, nunca encima de una foto.
 */

const GREEN = "#00EB5B";

export function TripadvisorBubbles({ rating, className = "" }: { rating: number; className?: string }) {
  // Las calificaciones de Tripadvisor van de media en media burbuja.
  const r = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
  return (
    <span role="img" aria-label={`${r} de 5 burbujas`} className={`inline-flex items-center gap-[2px] rounded-full bg-black px-1.5 py-0.5 ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, r - i));
        return (
          <svg key={i} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" data-fill={fill}>
            <circle cx="6" cy="6" r="5" fill="none" stroke={GREEN} strokeWidth="1.5" />
            {fill >= 1 && <circle cx="6" cy="6" r="5" fill={GREEN} />}
            {fill > 0 && fill < 1 && <path d="M6 1 A5 5 0 0 0 6 11 Z" fill={GREEN} />}
          </svg>
        );
      })}
    </span>
  );
}

const fmt = (n: number) => n.toLocaleString("es-MX");

export function TripadvisorRating({ rating, numReviews, webUrl }: { rating: number | null; numReviews: number | null; webUrl: string | null }) {
  if (rating == null) return null;
  const reviews = numReviews != null ? `${fmt(numReviews)} ${numReviews === 1 ? "opinión" : "opiniones"}` : null;
  return (
    <div className="space-y-0.5" title="Calificación de viajeros de Tripadvisor">
      <p className="text-[11px] text-muted-foreground">Calificación de viajeros de Tripadvisor</p>
      <div className="flex items-center gap-2 text-sm">
        <TripadvisorBubbles rating={rating} />
        <span>{rating.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
        {reviews && (webUrl
          ? <a href={webUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{reviews}</a>
          : <span className="text-muted-foreground">{reviews}</span>)}
      </div>
    </div>
  );
}

/** Marca de origen de la lista (la palabra "Tripadvisor" debe estar en la pantalla). */
export function TripadvisorSourceNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Lugares, calificaciones y fotos de <span className="font-semibold text-foreground">Tripadvisor</span>. Cada nombre abre su página en Tripadvisor.
    </p>
  );
}

export function TripadvisorLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      {children} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
