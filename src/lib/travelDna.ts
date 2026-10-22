// Travel DNA (barras del perfil), puro para probarlo. Antes las barras estaban en inglés y casi todas
// en 0 %: solo contaban "lugares visitados" (que casi nadie registra) y nunca los viajes. Ahora:
//   · cada viaje HECHO (incluidos los importados de boletos y reservas) suma 3 puntos a lo que dice
//     su destino (playa → descanso, Patagonia → aventura, Oaxaca → gastronomía…), cada viaje planeado 1;
//   · lugares visitados y señales de comportamiento suman 1 por evento;
//   · lo declarado en el onboarding siembra poco (1-2 puntos) y se dice que viene de ahí;
//   · una barra sin ningún dato dice "Sin datos aún" en lugar de 0 %, y si no hay nada de nada el
//     perfil lo dice con honestidad ("Aún no hay datos").

export type DnaKey = "food" | "adventure" | "cultural" | "luxury" | "relax" | "nightlife" | "hidden";

export const DNA_LABELS: Record<DnaKey, { label: string; color: string }> = {
  food: { label: "Explorador gastronómico", color: "#f5c16c" },
  adventure: { label: "Energía aventurera", color: "#7bc97b" },
  cultural: { label: "Buscador cultural", color: "#a8a0e8" },
  luxury: { label: "Balance de lujo", color: "#e8c66c" },
  relax: { label: "Viajero de descanso", color: "#8edada" },
  nightlife: { label: "Amante de la vida nocturna", color: "#e84393" },
  hidden: { label: "Cazador de joyas ocultas", color: "#c9a861" },
};

/** Arquetipo (encabezado del perfil y tarjeta del avatar) según la barra dominante. */
export const DNA_ARCHETYPES: Record<Exclude<DnaKey, "hidden"> | "hidden", { label: string; tag: string }> = {
  food: { label: "Explorador gastronómico", tag: "Alma gastronómica" },
  adventure: { label: "Buscador de aventura", tag: "Energía salvaje" },
  cultural: { label: "Explorador cultural", tag: "Mente refinada" },
  luxury: { label: "Viajero de lujo", tag: "Identidad premium" },
  relax: { label: "Viajero de bienestar", tag: "Aura serena" },
  nightlife: { label: "Viajero social", tag: "Energía nocturna" },
  hidden: { label: "Cazador de joyas ocultas", tag: "Mirada curada" },
};

export type DnaStat = { key: DnaKey; label: string; color: string; value: number | null };

export type DnaInputs = {
  today: string;
  trips: Array<{
    destino?: string | null; pais_destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null;
    num_viajeros?: number | null; total_estimado?: number | null; itinerario_json?: unknown; hospedaje_json?: unknown;
  }>;
  visits: Array<{ category?: string | null }>;
  signalCategories?: Record<string, unknown> | null;
  declared?: { presupuesto?: string | null; estilo?: string[] | null; intereses?: string[] | null; actividades?: string[] | null };
};

export type DnaResultCore = {
  stats: DnaStat[];
  dominant: DnaKey | null;
  fuente: "real" | "declarado" | "ninguna";
  viajesHechos: number;
  viajesPlaneados: number;
  lugares: number;
};

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();

const PLACES: Record<Exclude<DnaKey, "luxury" | "hidden">, string[]> = {
  relax: ["cancun", "tulum", "playa del carmen", "riviera maya", "los cabos", "cabo san lucas", "puerto vallarta", "huatulco", "bacalar", "holbox",
    "cozumel", "isla mujeres", "acapulco", "mazatlan", "sayulita", "punta mita", "punta cana", "bali", "maldivas", "hawai", "honolulu", "maui",
    "santorini", "mykonos", "ibiza", "aruba", "bahamas", "phuket", "caribe", "playa", "spa", "zihuatanejo", "ixtapa", "puerto escondido", "costa amalfitana", "capri"],
  adventure: ["patagonia", "islandia", "iceland", "machu picchu", "cusco", "costa rica", "banff", "whistler", "galapagos", "kenia", "tanzania",
    "nueva zelanda", "chiapas", "atacama", "uyuni", "safari", "alaska", "noruega", "laponia", "torres del paine", "el calafate", "ushuaia", "barrancas del cobre", "nepal"],
  cultural: ["paris", "roma", "florencia", "venecia", "kioto", "kyoto", "atenas", "estambul", "praga", "viena", "ciudad de mexico", "cdmx", "oaxaca",
    "san miguel de allende", "guanajuato", "puebla", "madrid", "sevilla", "granada", "londres", "berlin", "budapest", "cairo", "egipto", "jerusalen",
    "lisboa", "merida", "quebec", "washington", "toledo", "india", "cartagena", "la habana", "cracovia", "salzburgo", "petra", "angkor"],
  food: ["oaxaca", "lima", "tokio", "tokyo", "ciudad de mexico", "cdmx", "bangkok", "san sebastian", "bolonia", "napoles", "lyon", "barcelona",
    "nueva york", "new york", "valle de guadalupe", "puebla", "merida", "seul", "osaka", "buenos aires", "tequila", "copenhague", "hong kong", "singapur"],
  nightlife: ["las vegas", "ibiza", "miami", "nueva york", "new york", "berlin", "cancun", "buenos aires", "bangkok", "amsterdam", "barcelona",
    "rio de janeiro", "medellin", "tulum", "mykonos", "playa del carmen"],
};
const LUXURY_PLACES = ["dubai", "maldivas", "monaco", "bora bora", "st barth", "saint barth", "positano", "costa amalfitana", "seychelles", "courchevel", "aspen", "st moritz"];
const LUXURY_HOTELS = /four seasons|ritz|aman|rosewood|st\.? regis|mandarin oriental|belmond|one ?& ?only|park hyatt|waldorf|bulgari|peninsula|six senses|cheval blanc/;

const VISIT_MAP: Record<string, DnaKey> = {
  restaurant: "food", food: "food", cafe: "food", bakery: "food", bar: "nightlife", night_club: "nightlife", lounge: "nightlife",
  park: "adventure", hiking: "adventure", nature: "adventure", beach: "relax", spa: "relax", wellness: "relax",
  museum: "cultural", art_gallery: "cultural", landmark: "cultural", historic: "cultural", hotel: "luxury", lodging: "luxury", resort: "luxury",
};

const has = (text: string, list: string[]) => list.some((w) => ` ${text} `.includes(` ${w} `));

function tripText(t: DnaInputs["trips"][number]): string {
  const itin = t.itinerario_json && typeof t.itinerario_json === "object" ? (t.itinerario_json as { destinations?: unknown }).destinations : null;
  return norm([t.destino, t.pais_destino, ...(Array.isArray(itin) ? itin : [])].filter(Boolean).join(" "));
}

const nights = (t: DnaInputs["trips"][number]) => {
  if (!t.fecha_salida || !t.fecha_regreso) return null;
  const n = Math.round((Date.parse(t.fecha_regreso) - Date.parse(t.fecha_salida)) / 86400000);
  return n > 0 ? n : null;
};

export function computeTravelDna(input: DnaInputs): DnaResultCore {
  const real: Record<DnaKey, number> = { food: 0, adventure: 0, cultural: 0, luxury: 0, relax: 0, nightlife: 0, hidden: 0 };
  const declared: Record<DnaKey, number> = { food: 0, adventure: 0, cultural: 0, luxury: 0, relax: 0, nightlife: 0, hidden: 0 };
  let viajesHechos = 0;
  let viajesPlaneados = 0;
  let hiddenTrips = 0;

  for (const t of input.trips) {
    const end = t.fecha_regreso || t.fecha_salida;
    const done = !!end && end < input.today;
    if (done) viajesHechos++; else viajesPlaneados++;
    const w = done ? 3 : 1;
    const text = tripText(t);
    let matched = false;
    for (const k of Object.keys(PLACES) as Array<keyof typeof PLACES>) {
      if (text && has(text, PLACES[k])) { real[k] += w; matched = true; }
    }
    const hotels = Array.isArray(t.hospedaje_json) ? t.hospedaje_json.map((h: any) => norm(h?.nombre)).join(" ") : "";
    const n = nights(t);
    const perPersonNight = n && t.total_estimado && t.num_viajeros ? Number(t.total_estimado) / Math.max(1, Number(t.num_viajeros)) / n : 0;
    if (has(text, LUXURY_PLACES) || LUXURY_HOTELS.test(hotels) || perPersonNight >= 7000) { real.luxury += w; matched = true; }
    if (text && !matched) { hiddenTrips++; real.hidden += w; }
  }

  for (const v of input.visits) {
    const k = VISIT_MAP[String(v.category ?? "")];
    if (k) real[k] += 1;
  }
  for (const [c, n] of Object.entries(input.signalCategories ?? {})) {
    const k = VISIT_MAP[c];
    if (k) real[k] += Math.max(0, Math.min(50, Number(n) || 0));
  }

  const d = input.declared ?? {};
  if (d.presupuesto === "alto" || d.presupuesto === "premium") declared.luxury += 2;
  if ((d.estilo ?? []).some((s) => /lujo|premium/i.test(s))) declared.luxury += 2;
  if ((d.actividades ?? []).some((s) => /noche|night/i.test(s))) declared.nightlife += 1;
  const intereses = d.intereses ?? [];
  if (intereses.some((s) => /cultura|museo|arte|historia/i.test(s))) declared.cultural += 1;
  if (intereses.some((s) => /aventura|natur/i.test(s))) declared.adventure += 1;
  if (intereses.some((s) => /gastro|comida|food/i.test(s))) declared.food += 1;
  if (intereses.some((s) => /spa|wellness|playa|relax|descanso/i.test(s))) declared.relax += 1;

  const main: DnaKey[] = ["food", "adventure", "cultural", "luxury", "relax", "nightlife"];
  const realTotal = main.reduce((s, k) => s + real[k], 0);
  const declTotal = main.reduce((s, k) => s + declared[k], 0);
  const fuente: DnaResultCore["fuente"] = realTotal > 0 || viajesHechos + viajesPlaneados > 0 || input.visits.length > 0
    ? "real" : declTotal > 0 ? "declarado" : "ninguna";
  const total = realTotal + declTotal;

  const stats: DnaStat[] = main.map((k) => {
    const pts = real[k] + declared[k];
    return { key: k, ...DNA_LABELS[k], value: pts > 0 && total > 0 ? Math.max(1, Math.round((pts / total) * 100)) : null };
  });
  const tripsTotal = viajesHechos + viajesPlaneados;
  stats.push({ key: "hidden", ...DNA_LABELS.hidden, value: tripsTotal > 0 && hiddenTrips > 0 ? Math.round((hiddenTrips / tripsTotal) * 100) : null });

  const top = stats.filter((s) => s.key !== "hidden" && s.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const dominant = top?.key ?? (stats.find((s) => s.key === "hidden")?.value ? "hidden" : null);
  return { stats, dominant, fuente, viajesHechos, viajesPlaneados, lugares: input.visits.length };
}

/** Texto de "de dónde sale esto" bajo las barras. */
export function dnaBasisText(r: Pick<DnaResultCore, "fuente" | "viajesHechos" | "viajesPlaneados" | "lugares">): string {
  if (r.fuente === "ninguna") return "Aún no hay datos.";
  if (r.fuente === "declarado") return "Por ahora, según lo que nos contaste en tus preferencias.";
  const parts: string[] = [];
  if (r.viajesHechos) parts.push(`${r.viajesHechos} ${r.viajesHechos === 1 ? "viaje hecho" : "viajes hechos"}`);
  if (r.viajesPlaneados) parts.push(`${r.viajesPlaneados} ${r.viajesPlaneados === 1 ? "planeado" : "planeados"}`);
  if (r.lugares) parts.push(`${r.lugares} ${r.lugares === 1 ? "lugar visitado" : "lugares visitados"}`);
  return `Basado en ${parts.join(", ") || "tus señales"}.`;
}
