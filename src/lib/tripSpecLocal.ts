// Lector LOCAL del viaje completo (sin IA ni costo). Dos usos:
//  1. Respaldo cuando interpretar-viaje falla o tarda: la solicitud original se conserva y la persona
//     corrige a mano el resumen (nunca se pierde lo escrito).
//  2. Segundo lector para el validador de cobertura: todo lugar, crucero y regreso que encuentra aquí
//     debe aparecer en la interpretación de la IA (ensureCoverage); lo que falte se vuelve pregunta.
//
// Lee la frase en el orden escrito con los mismos separadores que multiCityText ("," "y" "→" "a"…) y
// reconoce marcas de tramo: "un crucero", "crucero desde X", "desembarco en X", "tren a X", "regreso a X",
// "regreso por/vía X". Nada se inventa: país sin ciudad conocida y lugar desconocido → pregunta.
import { parseMultiCityText, SEPARATOR, stripNonPlaces, durationOf, type PlaceItem } from "@/lib/multiCityText";
import { parseTripFallback } from "@/lib/parseTripFallback";
import { mainCityOf } from "@/lib/tripCoverage";
import { sameCity } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { findRegion, basesForNights } from "../../supabase/functions/_shared/regions.ts";
import {
  addRequiredQuestions, emptyCruise, emptySpec, ensureCoverage, isoNights, makeStop, newId, normText,
  type Cruise, type LegMode, type MentionKind, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec.ts";
import { autoResolveQuestions } from "@/lib/tripSpecAnswers";

export type LocalContext = { origen?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null; viajeros?: number | null; today?: Date };

const MODE_WORDS: Record<string, LegMode> = {
  tren: "tren", "en tren": "tren", coche: "coche", "en coche": "coche", auto: "coche", "en auto": "coche", carro: "coche", "en carro": "coche",
  ferry: "ferry", "en ferry": "ferry", barco: "ferry", "en barco": "ferry", vuelo: "vuelo", avion: "vuelo", "en avion": "vuelo", volando: "vuelo",
};
const RETURN_RE = /^(?:y\s+)?(?:el\s+|la\s+)?(?:regreso|regresar|regresamos|regresando|vuelta|volver|volvemos)(?:\s+(?:a|al))?$/;
const RETURN_VIA_RE = /^(?:y\s+)?(?:el\s+|la\s+)?(?:regreso|regresar|regresamos|regresando|vuelta|volver|volvemos)\s+(?:por|via|desde|pasando por)\s+(.+)$/;
const CRUISE_FROM_RE = /\bcrucero\b(?:\s+(?:desde|de|saliendo de|que sale de|en))\s+(.+)$/;
const DISEMBARK_RE = /^(?:y\s+)?(?:desembarco|desembarcar|desembarque|desembarcamos|desembarcando|terminando|termina|llegando|llegada)(?:\s+(?:en|a|al))\s+(.+)$/;
// "crucero de 7 noches" / "7 noches de crucero": noches a bordo (lo dijo la persona; no se suman al hotel).
const CRUISE_NIGHTS_RE = /\bcrucero\s+de\s+(\d{1,3})\s+noches\b|\b(\d{1,3})\s+noches\s+(?:de|en)\s+crucero\b/;
// "crucero de Barcelona a Atenas" / "crucero desde Miami hasta Cozumel": el destino del crucero es el
// puerto de llegada (el separador " a " parte la frase; aquí se lee antes de partirla).
const CRUISE_TO_RE = /\bcrucero\s+(?:de|desde|saliendo de)\s+[^,;.]+?\s+(?:a|al|hasta)\s+([^,;.]+)/g;
const lightNorm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Primer lugar de un trozo ("Barcelona" de "crucero desde Barcelona"), conservando cómo se escribió. */
function placesOf(raw: string): PlaceItem[] {
  const p = parseMultiCityText(raw);
  if (p.items.length) return p.items;
  if (p.origin) return [{ kind: "city", text: p.origin, name: p.origin }];
  return [];
}

/** Recupera el texto original (con acentos) de un trozo normalizado. */
const restore = (orig: string, normPiece: string) => {
  const words = orig.split(/\s+/);
  const target = normText(normPiece);
  for (let i = 0; i < words.length; i++) {
    for (let j = words.length; j > i; j--) {
      const w = words.slice(i, j).join(" ");
      if (normText(w) === target) return w.replace(/[.,;!?¡¿"]+$/g, "");
    }
  }
  return normPiece;
};

/** Menciones encontradas localmente (para el validador de cobertura). */
export function localMentions(text: string): Array<{ texto: string; tipo: MentionKind }> {
  return buildLocalSpec(text).menciones.map((m) => ({ texto: m.texto, tipo: m.tipo }));
}

export function buildLocalSpec(text: string, ctx: LocalContext = {}): TripSpec {
  const spec = emptySpec(text, "local");
  const raw = String(text ?? "");
  // "crucero de 7 noches" se lee aparte (noches a bordo): no debe partir la frase ni volver origen el puerto.
  const clean = raw.replace(/\bcrucero\s+de\s+\d{1,3}\s+noches\b/gi, "crucero");
  const full = parseMultiCityText(clean, { origin: ctx.origen ?? null });
  spec.origen = full.origin ?? ctx.origen ?? null;
  const fb = parseTripFallback(raw, ctx.today ?? new Date());
  spec.fecha_salida = fb.fechaSalida ?? ctx.fecha_salida ?? null;
  spec.fecha_regreso = fb.fechaRegreso ?? ctx.fecha_regreso ?? null;
  spec.fechas_expresas = !!spec.fecha_salida;
  spec.noches_total = isoNights(spec.fecha_salida, spec.fecha_regreso) ?? durationOf(raw).nights;
  spec.viajeros = fb.viajeros ?? ctx.viajeros ?? null;
  if (/\blujo|luxury|5 estrellas|cinco estrellas|primera clase|business\b/i.test(raw)) spec.preferencias.push("Lujo");

  const lraw = lightNorm(raw);
  const nightsM = CRUISE_NIGHTS_RE.exec(lraw);
  const cruiseNights = nightsM ? Number(nightsM[1] ?? nightsM[2]) || null : null;
  const cruiseTo = [...lraw.matchAll(CRUISE_TO_RE)].map((m) => normText(m[1])).filter(Boolean);
  const isCruiseArrival = (...names: Array<string | null | undefined>) =>
    names.some((n) => { const k = normText(n); return !!k && cruiseTo.some((t) => t === k || t.startsWith(`${k} `)); });
  const newCruise = (puerto_salida: string | null): Cruise => ({ ...emptyCruise(), puerto_salida, noches: cruiseNights && cruiseNights <= 120 ? cruiseNights : null });
  const chunks = stripNonPlaces(clean).split(SEPARATOR).map((c) => c.trim()).filter(Boolean);
  let pendingMode: LegMode | null = null;
  let pendingCruise: Cruise | null = null;
  let pendingReturn = false;
  const mention = (texto: string, tipo: MentionKind, estado: TripSpec["menciones"][number]["estado"], ref: string | null) =>
    spec.menciones.push({ texto, tipo, estado, ref });

  const pushStop = (ciudad: string, extra: Parameters<typeof makeStop>[1]) => {
    const s = makeStop(ciudad, extra);
    if (pendingCruise) {
      s.llegada_por = "crucero";
      const arrival = pendingCruise.puerto_llegada ?? (isCruiseArrival(extra.texto, ciudad) ? ciudad : null);
      s.crucero = { ...pendingCruise, puerto_llegada: arrival };
      s.es_puerto = true;
      pendingCruise = null;
    } else if (pendingMode) {
      s.llegada_por = pendingMode;
    }
    pendingMode = null;
    spec.paradas.push(s);
    return s;
  };

  const placeItem = (it: PlaceItem, writtenAs: string) => {
    if (pendingReturn) {
      pendingReturn = false;
      spec.regreso.a = it.name;
      mention(writtenAs, "regreso", "regreso", null);
      return;
    }
    if (spec.origen && it.kind === "city" && sameCity(it.name, spec.origen) && !spec.paradas.length) {
      mention(writtenAs, "origen", "origen", null);
      return;
    }
    if (it.kind === "city") {
      const s = pushStop(it.name, { texto: writtenAs });
      mention(writtenAs, "ciudad", "parada", s.id);
      return;
    }
    if (it.kind === "country" || it.kind === "region") {
      const reg = it.kind === "region" ? findRegion(it.name) : null;
      const used = new Set(spec.paradas.map((s) => normText(s.ciudad)));
      const sugg = reg
        ? reg.bases.filter((b) => !b.some((n) => used.has(normText(n)))).map((b) => b[0]).slice(0, basesForNights(null))
        : [mainCityOf(it.name)].filter(Boolean) as string[];
      if (sugg.length) {
        const first = pushStop(sugg[0], { texto: writtenAs, de_region: it.name, sugerida: true });
        for (const c of sugg.slice(1)) spec.paradas.push(makeStop(c, { texto: writtenAs, de_region: it.name, sugerida: true }));
        mention(writtenAs, it.kind === "country" ? "pais" : "region", "parada", first.id);
      } else {
        const q = { id: newId("q"), tipo: "ciudades_de_pais" as const, texto: it.name, pregunta: `${it.name}: ¿qué ciudades quieres visitar?`,
          opciones: [], parada: null, posicion: spec.paradas.length, resuelta: false };
        spec.preguntas.push(q);
        mention(writtenAs, it.kind === "country" ? "pais" : "region", "pregunta", q.id);
      }
      return;
    }
    // No reconocido: va como parada tal como lo escribió y se pregunta (no se borra ni se adivina).
    const s = pushStop(it.name, { texto: writtenAs });
    const q = { id: newId("q"), tipo: "lugar_desconocido" as const, texto: writtenAs,
      pregunta: `No reconocimos «${writtenAs}»: ¿qué ciudad es?`, opciones: [`Sí, es ${writtenAs}`], parada: s.id, resuelta: false };
    spec.preguntas.push(q);
    mention(writtenAs, "otro", "pregunta", q.id);
  };

  for (const chunk of chunks) {
    const n = normText(chunk);
    if (!n) continue;
    if (MODE_WORDS[n]) { pendingMode = MODE_WORDS[n]; mention(chunk, "tramo", "tramo", null); continue; }
    // "desde Ciudad de México": el origen, no una parada.
    const fromOrigin = /^(?:desde|saliendo de|salgo de|salimos de|partiendo de)\s+(.+)$/.exec(n);
    if (fromOrigin) {
      const it = placesOf(restore(chunk, fromOrigin[1]))[0];
      if (it && it.kind === "city") {
        if (!spec.origen) spec.origen = it.name;
        mention(it.text, "origen", "origen", null);
        continue;
      }
    }
    if (RETURN_RE.test(n)) { pendingReturn = true; continue; }
    const via = RETURN_VIA_RE.exec(n);
    if (via) {
      const place = restore(chunk, via[1]);
      const it = placesOf(place)[0];
      spec.regreso.via = it?.name ?? place;
      mention(place, "regreso", "pregunta", null);
      continue;
    }
    const from = CRUISE_FROM_RE.exec(n);
    if (from) {
      const place = restore(chunk, from[1]);
      const it = placesOf(place)[0];
      mention(chunk, "crucero", "tramo", null);
      if (it) {
        const last = spec.paradas[spec.paradas.length - 1];
        const port = it.name;
        if (!last || !sameCity(last.ciudad, port)) placeItem(it, place);
        const p = spec.paradas[spec.paradas.length - 1];
        if (p) p.es_puerto = true;
        pendingCruise = newCruise(port);
      } else {
        pendingCruise = newCruise(place);
      }
      continue;
    }
    if (/\bcrucero\b/.test(n)) {
      mention(chunk, "crucero", "tramo", null);
      const last = spec.paradas[spec.paradas.length - 1];
      pendingCruise = newCruise(last && last.es_puerto ? last.ciudad : null);
      continue;
    }
    const dis = DISEMBARK_RE.exec(n);
    if (dis) {
      const place = restore(chunk, dis[1]);
      if (!pendingCruise) pendingCruise = newCruise(null);
      const it = placesOf(place)[0] ?? { kind: "unknown" as const, text: place, name: place };
      (pendingCruise as Cruise).puerto_llegada = it.name;
      placeItem(it, place);
      continue;
    }
    // "tren a Barcelona" ya viene partido por " a " ("tren" + "Barcelona"); "en tren hasta Roma", igual.
    const lead = /^(?:y\s+)?(?:en\s+)?(tren|coche|auto|carro|ferry|barco|vuelo|avion)\s+(.+)$/.exec(n);
    if (lead) {
      pendingMode = MODE_WORDS[lead[1]] ?? null;
      mention(chunk, "tramo", "tramo", null);
      for (const it of placesOf(restore(chunk, lead[2]))) placeItem(it, it.text);
      continue;
    }
    const items = placesOf(chunk);
    // Como lo escribió la persona ("Cape Town", no "Ciudad del Cabo").
    for (const it of items) placeItem(it, it.kind === "city" ? (items.length === 1 ? chunk.replace(/[.!?¡¿"]+/g, "").trim() : restore(chunk, it.name)) : it.text);
  }
  if (pendingCruise) {
    // Crucero sin puerto de llegada: se pregunta (no se inventa).
    const q = { id: newId("q"), tipo: "crucero" as const, texto: "crucero",
      pregunta: "Tu crucero: ¿en qué puerto desembarcas y cuántas noches dura?", opciones: [], parada: null, posicion: spec.paradas.length, resuelta: false };
    spec.preguntas.push(q);
  }
  // Última parada = el origen: es el regreso, no una estancia.
  const last = spec.paradas[spec.paradas.length - 1];
  if (spec.origen && last && spec.paradas.length >= 2 && sameCity(last.ciudad, spec.origen)) {
    spec.paradas.pop();
    spec.regreso.a = spec.origen;
    spec.menciones = spec.menciones.map((m) => (m.ref === last.id ? { ...m, estado: "regreso", ref: null } : m));
  }
  if (!spec.regreso.a) spec.regreso.a = spec.origen;
  if (!spec.fecha_salida || !spec.fecha_regreso) {
    spec.preguntas.push({ id: newId("q"), tipo: "fechas", texto: "fechas", pregunta: "¿Qué fechas? Elige salida y regreso.", opciones: [], parada: null, resuelta: false });
  }
  addRequiredQuestions(spec);
  return spec;
}

/**
 * Deja lista la interpretación (de la IA o local) para el resumen: el texto original EXACTO, el contexto
 * del formulario si faltaba y el validador de cobertura con el lector local.
 */
export function finalizeSpec(spec: TripSpec, text: string, ctx: LocalContext = {}): TripSpec {
  const out: TripSpec = { ...spec, consulta_original: text };
  if (!out.origen && ctx.origen) out.origen = ctx.origen;
  if (!out.regreso.a) out.regreso = { ...out.regreso, a: out.origen };
  if (!out.fecha_salida && ctx.fecha_salida) out.fecha_salida = ctx.fecha_salida;
  if (!out.fecha_regreso && ctx.fecha_regreso && (!out.fecha_salida || ctx.fecha_regreso > out.fecha_salida)) out.fecha_regreso = ctx.fecha_regreso;
  out.noches_total = isoNights(out.fecha_salida, out.fecha_regreso) ?? out.noches_total;
  if (!out.viajeros && ctx.viajeros) out.viajeros = ctx.viajeros;
  // Pregunta de origen ya respondida por el contexto.
  out.preguntas = out.preguntas.map((q) => (q.tipo === "origen" && out.origen ? { ...q, resuelta: true } : q))
    .map((q) => (q.tipo === "fechas" && out.fecha_salida && out.fecha_regreso ? { ...q, resuelta: true } : q));
  if ((!out.fecha_salida || !out.fecha_regreso) && !out.preguntas.some((q) => q.tipo === "fechas" && !q.resuelta)) {
    out.preguntas = [...out.preguntas, { id: newId("q"), tipo: "fechas", texto: "fechas", pregunta: "¿Qué fechas? Elige salida y regreso.", opciones: [], parada: null, resuelta: false }];
  }
  if (out.fuente !== "local") ensureCoverage(out, localMentions(text).filter((m) => m.tipo !== "tramo" && m.tipo !== "origen"));
  // Lo que el texto ya contesta no se pregunta ("¿Regresas en coche?" con "… en coche desde CDMX").
  return autoResolveQuestions(out);
}
