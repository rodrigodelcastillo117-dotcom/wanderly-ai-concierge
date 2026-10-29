// Borrador rápido del viaje (28-oct-2026): la interpretación con IA tarda de 10 a 17 s en un viaje
// complejo. En cuanto la persona envía su texto ve "Tu viaje, como lo entendimos" con el borrador del
// lector local (sin IA ni red) y lo puede ir corrigiendo; cuando responde la IA, su interpretación
// reemplaza al borrador SIN pisar lo que la persona ya editó:
//  - una parada que quitó (o un lugar que excluyó) no se vuelve a agregar;
//  - una parada que agregó se conserva, en el lugar donde la puso;
//  - noches, rol, modo de llegada, crucero, fechas, viajeros u origen que escribió ganan sobre la IA;
//  - lo que ya respondió (ciudades de un país, escala o estancia, crucero) no se vuelve a preguntar.
// Después se aplica el validador de cobertura normal (finalizeSpec → ensureCoverage).
// Si la IA falla o tarda más de 45 s, el borrador se queda como base (nada escrito se pierde).
// Puro (sin red): lo prueba src/test/borradorRapido.test.tsx.
import { buildLocalSpec, finalizeSpec, type LocalContext } from "@/lib/tripSpecLocal";
import {
  excludeMention, listEs, normText, openQuestions, removeStop, replaceRegionStops, resolveQuestion, setCruise, setReturnVia,
  setTripBasics, updateStop, type Cruise, type Question, type Stop, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec.ts";

export const DRAFT_STATUS = "Borrador · Iato lo está revisando…";
export const DRAFT_WAITING_LABEL = "Esperando a Iato…";
export const DRAFT_FAIL_AVISO = "No pudimos completar tu viaje con Iato; revisa y corrige el resumen.";

/** Borrador local inmediato (el mismo lector que el respaldo de siempre). */
export function draftSpec(text: string, ctx: LocalContext = {}): TripSpec {
  return finalizeSpec(buildLocalSpec(text, ctx), text, ctx);
}

const k = normText;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Llave de una pregunta para emparejar la del borrador con la de la IA. */
const qKey = (q: Pick<Question, "tipo" | "texto">) => `${q.tipo}:${q.tipo === "fechas" || q.tipo === "origen" || q.tipo === "crucero" ? "" : k(q.texto)}`;
const sameCity = (a: Pick<Stop, "ciudad">, b: Pick<Stop, "ciudad">) => k(a.ciudad) === k(b.ciudad);
const stopOf = (spec: TripSpec, s: Pick<Stop, "ciudad">) => spec.paradas.find((x) => sameCity(x, s)) ?? null;
/** Paradas que salieron de una mención ("Hungría" → Budapest; "Cape Town" → Ciudad del Cabo). */
const stopsFor = (spec: TripSpec, texto: string, paradaId?: string | null) =>
  spec.paradas.filter((s) => (paradaId && s.id === paradaId) || [s.de_region, s.texto].some((n) => !!n && k(n) === k(texto)));
const cruiseFields = (c: Cruise | null) => (c ? Object.fromEntries(Object.entries(c).filter(([key, v]) => key !== "puertos_sugeridos" && v != null && v !== "")) as Partial<Cruise> : {});

/** Distancia de edición (para reconocer una errata: «beijin» → «beijing»). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
/** ¿La parada de la IA es la del borrador con la errata corregida? (lo escrito coincide o difiere ≤ 2 letras). */
const isTypoOf = (e: Pick<Stop, "ciudad" | "texto">, s: Pick<Stop, "ciudad" | "texto">) => {
  const written = [e.texto, e.ciudad].filter(Boolean).map((x) => k(String(x)));
  if (s.texto && written.includes(k(s.texto))) return true;
  const a = k(e.ciudad), b = k(s.ciudad);
  return a.length >= 4 && b.length >= 4 && editDistance(a, b) <= 2;
};

/** Sin el punto final ni espacios (la IA a veces manda "Toscana." o una frase). */
const bare = (t: string) => String(t ?? "").replace(/[.\s]+$/, "").trim();
/**
 * Cómo se nombra cada pendiente en el aviso. Una pregunta libre de la IA ("otro") no tiene una mención
 * que nombrar (su `texto` es una frase como «No indicaste cómo llegarán a Lima.»): se cuenta aparte
 * ("te dejó 1 pregunta abajo"); antes el aviso decía «preguntó por «No indicaste…».».
 */
const QUESTION_LABEL: Record<Question["tipo"], ((t: string) => string) | null> = {
  ciudades_de_pais: (t) => `las ciudades de ${bare(t)}`,
  lugar_desconocido: (t) => `«${bare(t)}»`,
  conexion_o_estancia: (t) => `la escala en ${bare(t)}`,
  crucero: () => "el crucero",
  fechas: () => "las fechas",
  origen: () => "tu ciudad de salida",
  otro: null,
};

export type DraftMerge = {
  spec: TripSpec;
  /** Ciudades que agregó la IA (no estaban en el borrador editado). */
  agrego: string[];
  /** Erratas que corrigió la IA («beijin» → Beijing): no son ciudades agregadas. */
  corrigio: Array<{ de: string; a: string }>;
  /** Pendientes nuevos de la IA (lo que el borrador no preguntaba). */
  pregunto: string[];
  /** "Iato completó tu viaje: agregó …; preguntó por …." */
  nota: string;
};

/** Aviso breve de lo que hizo la IA sobre el borrador (`libres`: preguntas libres nuevas, se cuentan). */
export function draftNote(agrego: string[], pregunto: string[], libres = 0, corrigio: Array<{ de: string; a: string }> = []): string {
  const parts: string[] = [];
  // Una errata corregida no es una ciudad agregada (R3 viajes P2-11: «beijin» decía «agregó Beijing»).
  if (corrigio.length) parts.push(`corrigió ${listEs(corrigio.map((c) => `«${c.de}» por ${c.a}`))}`);
  if (agrego.length) parts.push(`agregó ${listEs(agrego)}`);
  if (pregunto.length) parts.push(`preguntó por ${listEs(pregunto.map(bare))}`);
  if (libres > 0) parts.push(`te dejó ${libres === 1 ? "1 pregunta" : `${libres} preguntas`} abajo`);
  // La persona escribió un texto, no un «resumen»: se dice que no falta nada (antes «coincide con tu resumen»).
  return parts.length ? `Iato completó tu viaje: ${parts.join("; ")}.` : "Iato revisó tu viaje: no falta nada.";
}

/**
 * Reemplaza el borrador por la interpretación de la IA conservando lo que la persona editó.
 * `base`: el borrador tal como se mostró; `edited`: el borrador con las ediciones; `ai`: la IA (finalizada).
 */
export function mergeDraftWithAi(base: TripSpec, edited: TripSpec, ai: TripSpec, ctx: LocalContext = {}): DraftMerge {
  const text = edited.consulta_original || base.consulta_original;
  let out: TripSpec = { ...clone(ai), consulta_original: text, fuente: "ia" };
  const baseIds = new Set(base.paradas.map((s) => s.id));
  const editedIds = new Set(edited.paradas.map((s) => s.id));

  // 1. Fechas, viajeros y origen que escribió la persona ganan.
  const patch: Partial<Pick<TripSpec, "fecha_salida" | "fecha_regreso" | "viajeros" | "origen">> = {};
  for (const f of ["fecha_salida", "fecha_regreso", "viajeros", "origen"] as const) {
    if (edited[f] !== base[f]) (patch as Record<string, unknown>)[f] = edited[f];
  }
  if (Object.keys(patch).length) out = setTripBasics(out, patch);

  // 2. Lo que excluyó (una parada que quitó, "Quitar «Hungría»", "Sin crucero", "Quitar la escala") no vuelve.
  const wasExcluded = (s: TripSpec, t: string) => s.menciones.some((m) => m.estado === "excluido" && k(m.texto) === k(t));
  const excludedSet = new Set(edited.menciones.filter((m) => m.estado === "excluido" && !wasExcluded(base, m.texto)).map((m) => m.texto));
  // "Quitar «Hungría»" resuelve la pregunta y quita sus ciudades propuestas (la mención puede seguir como
  // parada): se reconoce por la pregunta respondida sin ciudades; "Quitar la escala", por el regreso sin vía.
  for (const bq of base.preguntas) {
    if (bq.resuelta || !edited.preguntas.find((q) => q.id === bq.id)?.resuelta) continue;
    if ((bq.tipo === "ciudades_de_pais" || bq.tipo === "lugar_desconocido") && !stopsFor(edited, bq.texto, bq.parada).length) excludedSet.add(bq.texto);
    if (bq.tipo === "conexion_o_estancia" && !edited.regreso.via && !edited.paradas.some((s) => k(s.ciudad) === k(bq.texto))) excludedSet.add(bq.texto);
  }
  const excluded = [...excludedSet];
  for (const ex of excluded) {
    const q = openQuestions(out).find((x) => k(x.texto) === k(ex));
    if (q) out = excludeMention(out, q.id);
    for (const s of out.paradas.filter((x) => [x.ciudad, x.texto, x.de_region].some((n) => !!n && k(n) === k(ex)))) {
      // Salvo que la persona la tenga (p. ej. la quitó de un lado y la volvió a agregar).
      if (!edited.paradas.some((e) => sameCity(e, s))) out = removeStop(out, s.id);
    }
    if (k(ex) === "crucero") out = { ...out, paradas: out.paradas.map((s) => (s.llegada_por === "crucero" && !edited.paradas.some((e) => sameCity(e, s) && e.llegada_por === "crucero") ? { ...s, llegada_por: "por_definir", crucero: null } : s)) };
    const has = out.menciones.some((m) => k(m.texto) === k(ex));
    out = {
      ...out,
      menciones: has
        ? out.menciones.map((m) => (k(m.texto) === k(ex) ? { ...m, estado: "excluido", ref: null } : m))
        : [...out.menciones, { texto: ex, tipo: "otro", estado: "excluido", ref: null }],
    };
  }

  // 3. Pendientes que ya respondió en el borrador: no se vuelven a preguntar.
  for (const bq of base.preguntas) {
    if (bq.resuelta) continue;
    const eq = edited.preguntas.find((q) => q.id === bq.id);
    if (!eq?.resuelta || excluded.some((ex) => k(ex) === k(bq.texto))) continue;
    const aq = openQuestions(out).find((q) => qKey(q) === qKey(bq));
    if (!aq) continue;
    if (bq.tipo === "ciudades_de_pais" || bq.tipo === "lugar_desconocido") {
      const mine = stopsFor(edited, bq.texto, bq.parada);
      if (mine.length) {
        out = replaceRegionStops(out, aq.id, mine.map((s) => s.ciudad));
        // replaceRegionStops crea paradas nuevas: se conserva el país/región de la persona.
        out = { ...out, paradas: out.paradas.map((s) => { const m = mine.find((x) => sameCity(x, s)); return m ? { ...s, de_region: m.de_region ?? s.de_region, sugerida: false } : s; }) };
      }
    } else if (bq.tipo === "conexion_o_estancia") {
      out = setReturnVia(out, aq.id, edited.paradas.some((s) => k(s.ciudad) === k(bq.texto)) ? "estancia" : "conexion");
    } else if (bq.tipo === "crucero") {
      const mine = edited.paradas.find((s) => s.llegada_por === "crucero");
      const target = out.paradas.find((s) => s.llegada_por === "crucero" && (!aq.parada || s.id === aq.parada)) ?? (mine ? stopOf(out, mine) : null);
      if (mine && target) {
        if (target.llegada_por !== "crucero") out = updateStop(out, target.id, { llegada_por: "crucero" });
        out = setCruise(out, target.id, cruiseFields(mine.crucero));
      }
    } else if (bq.tipo === "otro") {
      out = resolveQuestion(out, aq.id, "preferencia");
    }
  }

  // 4. Paradas que quitó del borrador (y no volvió a poner): fuera también de la IA.
  for (const r of base.paradas.filter((s) => !editedIds.has(s.id))) {
    if (edited.paradas.some((e) => sameCity(e, r))) continue;
    const t = stopOf(out, r);
    if (t) out = removeStop(out, t.id);
  }

  // 5. Cambios en paradas del borrador (noches, me quedo / escala, cómo llega, crucero): ganan.
  for (const e of edited.paradas) {
    const b = base.paradas.find((s) => s.id === e.id);
    const t = stopOf(out, e);
    if (!b || !t) continue;
    const p: Partial<Stop> = {};
    if (e.noches !== b.noches) p.noches = e.noches;
    if (e.rol !== b.rol) p.rol = e.rol;
    if (e.llegada_por !== b.llegada_por) p.llegada_por = e.llegada_por;
    if (Object.keys(p).length) out = updateStop(out, t.id, p);
    if (e.llegada_por === "crucero" && JSON.stringify(e.crucero) !== JSON.stringify(b.crucero)) out = setCruise(out, t.id, cruiseFields(e.crucero));
  }

  // 6. Paradas que agregó: se conservan, después de la parada que tenían antes.
  edited.paradas.forEach((e, i) => {
    if (baseIds.has(e.id)) return;
    const t = stopOf(out, e);
    if (t) {
      const p: Partial<Stop> = { sugerida: false, rol: e.rol };
      if (e.noches != null) p.noches = e.noches;
      if (e.llegada_por !== "por_definir") p.llegada_por = e.llegada_por;
      out = updateStop(out, t.id, p);
      if (e.llegada_por === "crucero" && e.crucero) out = setCruise(out, t.id, cruiseFields(e.crucero));
      return;
    }
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = out.paradas.findIndex((s) => sameCity(s, edited.paradas[j]));
      if (prev >= 0) { at = prev + 1; break; }
    }
    out = { ...out, paradas: [...out.paradas.slice(0, at), clone(e), ...out.paradas.slice(at)] };
  });

  // 7. Si cambió el orden del borrador, su orden gana (las ciudades que agregó la IA se quedan donde las puso).
  const order = (s: TripSpec) => s.paradas.filter((x) => baseIds.has(x.id) && editedIds.has(x.id)).map((x) => x.id).join("|");
  if (order(base) !== order(edited)) {
    const rank = (s: Stop) => edited.paradas.findIndex((e) => sameCity(e, s));
    const slots = out.paradas.map((s, i) => (rank(s) >= 0 ? i : -1)).filter((i) => i >= 0);
    const mine = slots.map((i) => out.paradas[i]).sort((a, b) => rank(a) - rank(b));
    const paradas = [...out.paradas];
    slots.forEach((slot, j) => { paradas[slot] = mine[j]; });
    out = { ...out, paradas };
  }

  // 8. Validador de cobertura normal (todo lo escrito queda en una parada, una pregunta o una exclusión).
  out = finalizeSpec(out, text, ctx);

  const nuevasParadas = out.paradas.filter((s) => !edited.paradas.some((e) => sameCity(e, s)));
  const sueltas = edited.paradas.filter((e) => !out.paradas.some((s) => sameCity(e, s)));
  const corrigio: Array<{ de: string; a: string }> = [];
  const agrego: string[] = [];
  for (const s of nuevasParadas) {
    const de = sueltas.find((e) => isTypoOf(e, s));
    if (de) corrigio.push({ de: de.texto || de.ciudad, a: s.ciudad });
    else agrego.push(s.ciudad);
  }
  const before = new Set(openQuestions(edited).map(qKey));
  const nuevas = openQuestions(out).filter((q) => !before.has(qKey(q)));
  const pregunto = [...new Set(nuevas.flatMap((q) => { const label = QUESTION_LABEL[q.tipo]; return label ? [label(q.texto)] : []; }))];
  const libres = nuevas.filter((q) => !QUESTION_LABEL[q.tipo]).length;
  return { spec: out, agrego, corrigio, pregunto, nota: draftNote(agrego, pregunto, libres, corrigio) };
}
