/**
 * Personalización honesta de FOR YOU ("Curated for You", "Your Next Journey", "Your World is Ready").
 * Doc A Fase 1 §3 y §5: con viaje activo se prioriza su destino y sus fechas; sin datos suficientes, una
 * selección editorial verificable QUE SE DICE editorial; nunca se finge personalización ni se elige otro viaje.
 * Lógica pura (se prueba en src/test/priveKeyForYou.test.ts).
 */
import { resolveActiveTrip, tripLabel, type ActiveTripResult, type TripLike } from "@/lib/activeTrip";
import { detectPlace, placeBySlug } from "../../supabase/functions/_shared/priveKey";
import type { KeyLang } from "@/lib/priveKeyI18n";

export type HomeDestination = { slug: string; name: string; kind: string; count: number; region_group?: string | null };

export type ForYouSource =
  | { kind: "trip"; trip: TripLike; label: string; destination: { slug: string; name: string }; from: string | null; to: string | null }
  | { kind: "trip_no_coverage"; trip: TripLike; label: string; place: string; fallback: { slug: string; name: string } | null }
  | { kind: "ambiguous"; candidates: { id: string; label: string }[]; fallback: { slug: string; name: string } | null }
  | { kind: "chosen"; destination: { slug: string; name: string } }
  | { kind: "editorial"; destination: { slug: string; name: string } | null };

/** Destino Privé de un viaje (un barrio cuenta como su ciudad); null si el catálogo no lo tiene. */
export function tripDestination(trip: TripLike, home: HomeDestination[]): { slug: string; name: string } | null {
  const first = String(trip.destino ?? "").split(/→|->|,|;|\//)[0];
  const p = detectPlace(first) ?? detectPlace(String(trip.destino ?? ""));
  if (!p) return null;
  const slug = p.kind === "neighborhood" && p.parent ? p.parent : p.slug;
  const h = home.find((d) => d.slug === slug && d.count > 0);
  return h ? { slug, name: h.name } : null;
}

/** El destino editorial: el de más contenido verificado (determinista), nunca "por ti". */
export function editorialDestination(home: HomeDestination[], preferredSlug?: string | null): { slug: string; name: string } | null {
  const usable = home.filter((d) => d.count > 0 && d.kind !== "neighborhood");
  const pref = preferredSlug ? usable.find((d) => d.slug === preferredSlug) : null;
  if (pref) return { slug: pref.slug, name: pref.name };
  const best = [...usable].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
  return best ? { slug: best.slug, name: best.name } : null;
}

export function forYouSource(resolved: ActiveTripResult<TripLike>, home: HomeDestination[], opts: { chosenSlug?: string | null; chosenTripId?: string | null } = {}): ForYouSource {
  if (opts.chosenSlug) {
    const d = home.find((x) => x.slug === opts.chosenSlug);
    if (d) return { kind: "chosen", destination: { slug: d.slug, name: d.name } };
  }
  let trip = resolved.trip;
  if (!trip && opts.chosenTripId) trip = resolved.candidates.find((c) => c.id === opts.chosenTripId) ?? null;
  if (trip) {
    const dest = tripDestination(trip, home);
    if (dest) return { kind: "trip", trip, label: tripLabel(trip), destination: dest, from: trip.fecha_salida ? String(trip.fecha_salida).slice(0, 10) : null,
      to: trip.fecha_regreso ? String(trip.fecha_regreso).slice(0, 10) : null };
    return { kind: "trip_no_coverage", trip, label: tripLabel(trip), place: String(trip.destino ?? ""), fallback: editorialDestination(home) };
  }
  if (resolved.reason === "ambiguous") {
    return { kind: "ambiguous", candidates: resolved.candidates.map((c) => ({ id: c.id, label: tripLabel(c) })), fallback: editorialDestination(home) };
  }
  return { kind: "editorial", destination: editorialDestination(home) };
}

/** Razones del servidor (prive_score) → texto. Solo lo que el servidor calculó; nada se agrega. */
export function reasonText(reasons: string[] | null | undefined, lang: KeyLang): string[] {
  const out: string[] = [];
  for (const r of reasons ?? []) {
    if (r === "viaje:destino_del_viaje") out.push(lang === "en" ? "In your trip's destination" : "En el destino de tu viaje");
    else if (r === "viaje:evento_en_tus_fechas") out.push(lang === "en" ? "Event on your dates (per source)" : "Evento en tus fechas (según la fuente)");
    else if (r.startsWith("dna:")) out.push(lang === "en" ? "Matches your tastes (with your consent)" : "Encaja con tus gustos (con tu permiso)");
    else if (r.startsWith("presupuesto:nivel_")) out.push(lang === "en" ? "Fits your usual budget level" : "Acorde a tu nivel de presupuesto");
    else if (r === "calidad:verificado") out.push(lang === "en" ? "Verified with a source" : "Verificado con fuente");
    else if (r.startsWith("premio:")) out.push(lang === "en" ? `Sourced recognition ${r.slice(7)}` : `Reconocimiento ${r.slice(7)} con fuente`);
  }
  return [...new Set(out)];
}

/** ¿La selección está realmente personalizada? Solo si hay viaje elegido o razones de gustos con permiso. */
export function personalization(source: ForYouSource, items: { reasons?: string[] | null }[]): "trip" | "taste" | "chosen" | "editorial" {
  if (source.kind === "trip") return "trip";
  if (items.some((i) => (i.reasons ?? []).some((r) => r.startsWith("dna:")))) return "taste";
  if (source.kind === "chosen") return "chosen";
  return "editorial";
}

export function personalizationLabel(kind: ReturnType<typeof personalization>, source: ForYouSource, lang: KeyLang): string {
  const en = lang === "en";
  if (kind === "trip" && source.kind === "trip") return en ? `Prioritised for your trip: ${source.label}` : `Priorizado para tu viaje: ${source.label}`;
  if (kind === "taste") return en ? "Ordered by your tastes, with your consent" : "Ordenado por tus gustos, con tu permiso";
  if (kind === "chosen" && source.kind === "chosen") return en ? `Verified selection in ${source.destination.name}` : `Selección verificada en ${source.destination.name}`;
  return en ? "Verified editorial selection · not personalised yet" : "Selección editorial verificada · aún no personalizada";
}

/** Para pruebas y para reutilizar la misma regla del viaje activo. */
export function resolveTrips(trips: TripLike[], pinnedId: string | null, todayLocal: string) {
  return resolveActiveTrip(trips, { pinnedId, todayLocal });
}

export const placeNameFor = (slug: string, lang: KeyLang) => { const p = placeBySlug(slug); return p ? (lang === "en" ? p.name_en : p.name_es) : slug; };
