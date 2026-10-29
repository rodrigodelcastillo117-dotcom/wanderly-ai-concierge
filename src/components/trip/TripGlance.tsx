import { MapPin, Star, Wallet } from "lucide-react";
import type { GlanceBullet } from "@/lib/tripGlance";

const ICON = { viaje: MapPin, destacado: Star, costo: Wallet } as const;

/**
 * "Tu viaje en 30 segundos": la cabecera del tablero del Resumen. La página pasa solo lo que no repite
 * otra parte de la pantalla (ola «9.5 en todo»: destino, fechas y viajeros ya están en la portada y el
 * total en su tarjeta), así que normalmente queda «Lo más destacado». Los puntos los arma tripGlance.
 */
export function TripGlance({ bullets, embedded = false }: { bullets: GlanceBullet[]; embedded?: boolean }) {
  if (!bullets.length) return null;
  return (
    <section aria-labelledby="trip-glance-title" className={embedded ? "" : "glass-card rounded-2xl p-4 sm:p-5"} data-testid="trip-glance">
      <h2 id="trip-glance-title" className="text-[11px] uppercase tracking-[0.2em] text-primary">Tu viaje en 30 segundos</h2>
      <ul className="mt-2.5 space-y-2">
        {bullets.map((b) => {
          const Icon = ICON[b.key];
          return (
            <li key={b.key} className="flex items-start gap-2.5 text-sm leading-snug" data-testid={`trip-glance-${b.key}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 break-words">{b.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
