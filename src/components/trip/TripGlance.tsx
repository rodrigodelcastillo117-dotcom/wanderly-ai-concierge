import { MapPin, Star, Wallet } from "lucide-react";
import type { GlanceBullet } from "@/lib/tripGlance";

const ICON = { viaje: MapPin, destacado: Star, costo: Wallet } as const;

/**
 * "Tu viaje en 30 segundos": 2-3 puntos arriba del texto largo (a dónde y cuándo, lo más destacado y
 * cuánto cuesta o qué falta). Los puntos los arma tripGlance con datos del viaje y el total de la página.
 */
export function TripGlance({ bullets }: { bullets: GlanceBullet[] }) {
  if (!bullets.length) return null;
  return (
    <section aria-labelledby="trip-glance-title" className="glass-card rounded-2xl p-4 sm:p-5" data-testid="trip-glance">
      <h2 id="trip-glance-title" className="text-[11px] uppercase tracking-[0.2em] text-primary">Tu viaje en 30 segundos</h2>
      <ul className="mt-3 space-y-2.5">
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
