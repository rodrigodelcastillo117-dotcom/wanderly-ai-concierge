import { Link } from "react-router-dom";
import { MapPin, Users } from "lucide-react";
import { SmartImage } from "@/components/media/SmartImage";
import { destinationQuery } from "@/lib/categoryImagery";
import { tripDates, type FriendTrip } from "@/lib/friendActivity";

const FASE: Record<FriendTrip["fase"], string> = { pasado: "Vivido", en_curso: "En curso", proximo: "Próximo" };

/** "Viajes de Carlo": lo que decidió mostrar (pasados por defecto con mes y año; próximos si los prendió). */
export function FriendTrips({ trips, nombre }: { trips: FriendTrip[]; nombre: string }) {
  if (!trips.length) {
    return <p className="text-sm text-muted-foreground" data-testid="friend-trips-empty">{nombre} aún no comparte viajes.</p>;
  }
  return (
    <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 overflow-x-auto sm:overflow-visible snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 pb-2 sm:pb-0 [scrollbar-width:none]"
      data-testid="friend-trips">
      {trips.map((t) => {
        const body = (
          <>
            <SmartImage alt={t.destino} imageUrl={t.portada} stockQuery={destinationQuery(t.destino, t.paises[0] ?? null)} icon={MapPin}
              className="h-32 md:h-36 w-full" imgClassName="group-hover:scale-105" captionPosition="top-right">
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
              <span className={`absolute top-3 left-3 z-[2] text-[10px] px-2.5 py-1 rounded-full backdrop-blur ${t.fase === "pasado" ? "bg-black/55 text-white/85" : "bg-primary/90 text-primary-foreground"}`}>
                {FASE[t.fase]}
              </span>
              {t.juntos && (
                <span className="absolute bottom-3 left-3 z-[2] text-[10px] px-2.5 py-1 rounded-full bg-gradient-gold text-primary-foreground inline-flex items-center gap-1">
                  <Users className="w-3 h-3" aria-hidden="true" /> Viajaron juntos
                </span>
              )}
            </SmartImage>
            <div className="px-4 py-3">
              <p className="text-[10px] text-primary tracking-[0.18em] uppercase truncate">{t.paises.join(" · ") || " "}</p>
              <h3 className="font-display text-lg truncate">{t.destino}</h3>
              <p className="text-xs text-muted-foreground">{tripDates(t) ?? "Sin fechas"}</p>
            </div>
          </>
        );
        return (
          <article key={t.clave} className="snap-start shrink-0 w-[70%] sm:w-auto glass-card rounded-2xl overflow-hidden border border-white/[0.05]" data-testid="friend-trip">
            {t.juntos && t.id ? <Link to={`/dashboard/viajes/${t.id}`} className="block group">{body}</Link> : <div className="group">{body}</div>}
          </article>
        );
      })}
    </div>
  );
}
