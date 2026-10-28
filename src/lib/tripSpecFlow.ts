// Del texto libre al viaje: interpretar (interpretar-viaje, con respaldo local), revisar "Entendí…" y,
// solo cuando la persona confirma, generar por el flujo correcto:
//  - 2+ estancias o un crucero → multidestino (generateMultiDestTrip → logistics-plan), con modos por
//    tramo, tramos por mar y la última ciudad como origen del regreso (open-jaw real de logistics-plan).
//  - 1 estancia → destino único (analizar-viaje), como siempre.
// En ambos casos se guarda la consulta original y la interpretación en itinerario_json.consulta.
//
// Re-armar desde "¿No entendimos bien tu viaje?" crea un viaje NUEVO (revisión versionada) y deja el
// anterior intacto, con su diario, gastos y selecciones; el anterior apunta a la revisión.
import { generateMultiDestTrip } from "@/lib/multiDestGenerate";
import { clearRequestKey, getRequestKey } from "@/lib/requestKey";
import { buildLocalSpec, finalizeSpec, type LocalContext } from "@/lib/tripSpecLocal";
import {
  consultaOf, emptySpec, makeStop, newId, routeOfSpec, savedConsulta, withConsulta,
  type SavedConsulta, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec.ts";

type Client = {
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: any; error: any }> };
  from: (table: string) => any;
};

export type InterpretResult = {
  spec: TripSpec;
  /** La IA no respondió: el resumen es del lector local y la persona lo corrige (su texto se conservó). */
  aviso: string | null;
  recortadoParaIa: boolean;
};

export const INTERPRET_TIMEOUT_MS = 45_000;

export type AiInterpretResult = { ok: true; spec: TripSpec; recortadoParaIa: boolean } | { ok: false };

/**
 * Solo la IA (sin respaldo): para el borrador rápido, que ya muestra el lector local y decide qué hacer
 * si la IA falla o tarda más de `timeoutMs`. Nunca lanza.
 */
export async function interpretTripAi(client: Client, text: string, ctx: LocalContext = {}, timeoutMs = INTERPRET_TIMEOUT_MS): Promise<AiInterpretResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const call = client.functions.invoke("interpretar-viaje", {
      body: { texto: text, contexto: { origen: ctx.origen ?? null, fecha_salida: ctx.fecha_salida ?? null, fecha_regreso: ctx.fecha_regreso ?? null, viajeros: ctx.viajeros ?? null } },
    });
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), timeoutMs); });
    const { data, error } = await Promise.race([call, timeout]);
    if (error || !data?.ok || !data?.spec) throw error ?? new Error(data?.code ?? "sin_respuesta");
    return { ok: true, spec: finalizeSpec(data.spec as TripSpec, text, ctx), recortadoParaIa: !!data.texto_recortado_para_ia };
  } catch {
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Interpretar NO usa búsquedas del plan (solo la IA de interpretación, con su límite por minuto). */
export async function interpretTrip(client: Client, text: string, ctx: LocalContext = {}, timeoutMs = INTERPRET_TIMEOUT_MS): Promise<InterpretResult> {
  const local = () => finalizeSpec(buildLocalSpec(text, ctx), text, ctx);
  const r = await interpretTripAi(client, text, ctx, timeoutMs);
  if (r.ok) return { spec: r.spec, aviso: null, recortadoParaIa: r.recortadoParaIa };
  return {
    spec: local(),
    aviso: "No pudimos interpretar todo con Iato ahora. Guardamos tu texto completo: revisa lo que entendimos y corrígelo.",
    recortadoParaIa: false,
  };
}

/** Lo que entendimos de un viaje guardado sin consulta (viajes viejos): destino(s), fechas y viajeros. */
export function specFromTrip(trip: any): TripSpec {
  const saved = consultaOf(trip);
  if (saved?.interpretacion) return { ...saved.interpretacion, consulta_original: saved.consulta_original };
  const spec = emptySpec("", "manual");
  const it = trip?.itinerario_json;
  const list: string[] = it && !Array.isArray(it) && Array.isArray(it.destinations) && it.destinations.length
    ? it.destinations.map(String) : String(trip?.destino ?? "").split(/\s*→\s*/).filter(Boolean);
  spec.origen = trip?.ciudad_origen ?? null;
  spec.regreso = { a: spec.origen, via: null, modo: "por_definir" };
  spec.paradas = list.map((c) => makeStop(c, { texto: c }));
  spec.fecha_salida = trip?.fecha_salida ?? null;
  spec.fecha_regreso = trip?.fecha_regreso ?? null;
  spec.fechas_expresas = !!(spec.fecha_salida && spec.fecha_regreso);
  spec.viajeros = Number(trip?.num_viajeros) || null;
  if (!spec.fecha_salida || !spec.fecha_regreso) {
    spec.preguntas.push({ id: newId("q"), tipo: "fechas", texto: "fechas", pregunta: "¿Qué fechas? Elige salida y regreso.", opciones: [], parada: null, resuelta: false });
  }
  const seaLegs: any[] = Array.isArray(it?.logistics?.sea_legs) ? it.logistics.sea_legs : [];
  for (const l of seaLegs) {
    const s = spec.paradas[Number(l.index) + 1];
    if (s) {
      s.llegada_por = l.tipo === "ferry" ? "ferry" : "crucero";
      s.crucero = { naviera: l.naviera ?? null, barco: null, puerto_salida: l.puerto_salida ?? null, puerto_llegada: l.puerto_llegada ?? null,
        fecha_salida: l.fecha_salida ?? null, fecha_llegada: l.fecha_llegada ?? null, noches: Number(l.noches) || null };
    }
  }
  return spec;
}

/** Qué se recalcula y qué cuesta, para decirlo ANTES de gastar. */
export function recalcSummary(spec: TripSpec): { flujo: "multi" | "unico" | null; recalcula: string[]; costo: string } {
  const r = routeOfSpec(spec);
  if (r.kind === "multi") {
    return {
      flujo: "multi",
      recalcula: ["Vuelos (incluido el regreso desde la última ciudad)", "Hoteles por ciudad", "Tramos entre ciudades", "Itinerario día por día",
        ...(r.seaLegs.length ? ["Crucero: solo puertos y fechas (el precio se cotiza con la naviera)"] : [])],
      costo: "Armar tu viaje usa una búsqueda de tu plan.",
    };
  }
  if (r.kind === "unico") return { flujo: "unico", recalcula: ["Vuelos", "Hotel", "Itinerario día por día"], costo: "Armar tu viaje usa una búsqueda de tu plan." };
  return { flujo: null, recalcula: [], costo: "" };
}

export type GenerateOptions = {
  userId: string | null;
  travelClass?: string | null;
  presupuesto?: number | null;
  /** Revisión de un viaje existente (que se conserva intacto). */
  previous?: { id: string; itinerario_json?: unknown } | null;
};

/** Versión siguiente de la revisión de un viaje. */
export function nextRevision(prev: SavedConsulta | null): number {
  const list = prev?.revisiones ?? [];
  return Math.max(prev?.revision ?? 1, ...list.map((r) => r.version)) + 1;
}

/**
 * Genera el viaje por el flujo que toca. Lanza el error de la función (límite del plan, falla) para que
 * quien llama muestre el aviso de siempre (toastFunctionError). Solo se llama tras confirmar el costo.
 */
export async function generateFromSpec(client: Client, spec: TripSpec, o: GenerateOptions): Promise<{ tripId: string | null; flujo: "multi" | "unico" }> {
  const r = routeOfSpec(spec);
  const prevConsulta = o.previous ? consultaOf(o.previous) : null;
  const rev = o.previous ? { de: o.previous.id, version: nextRevision(prevConsulta) } : null;
  const consulta = savedConsulta(spec, new Date().toISOString(), rev);
  let tripId: string | null = null;
  let flujo: "multi" | "unico";
  if (r.kind === "multi") {
    flujo = "multi";
    const res = await generateMultiDestTrip(client, {
      userId: o.userId, origin: r.origen, stops: r.destinos, fechaSalida: r.fecha_salida, fechaRegreso: r.fecha_regreso, viajeros: r.viajeros,
      presupuesto: o.presupuesto ?? null,
      prefs: { connection: "smart", roadtripStops: true, luggageLogistics: true, ...(r.legModes ? { transport_mode: "mixto", leg_modes: r.legModes } : {}) },
      nightsPerCity: r.noches, travelClass: o.travelClass ?? null, telemetry: { autonomous: false },
      seaLegs: r.seaLegs, travelerNotes: r.notas, consulta,
    });
    tripId = res.tripId ?? null;
  } else if (r.kind === "unico") {
    flujo = "unico";
    const args = {
      destino: r.destino, ciudad_origen: r.origen, fecha_salida: r.fecha_salida, fecha_regreso: r.fecha_regreso, num_viajeros: r.viajeros,
      presupuesto_objetivo: o.presupuesto ?? null,
      notas_usuario: [`Lo que escribió el viajero: ${spec.consulta_original.slice(0, 1500)}`, r.notas].filter((x) => x && x.trim()).join("\n"),
    };
    const request_key = getRequestKey("analizar-viaje", args);
    const { data, error } = await client.functions.invoke("analizar-viaje", { body: { ...args, request_key } });
    if (error) throw error;
    if (!data?.trip?.id) throw new Error("Sin resultado");
    clearRequestKey("analizar-viaje");
    tripId = data.trip.id;
    // Destino único: itinerario_json era un array de días; se guarda como { days, consulta }.
    try {
      await client.from("trips").update({ itinerario_json: withConsulta(data.trip.itinerario_json ?? [], consulta) }).eq("id", tripId);
    } catch (e) { console.warn("consulta no guardada", (e as Error)?.message); }
  } else {
    throw new Error("El viaje tiene pendientes por resolver.");
  }
  // El viaje anterior se conserva; solo se anota que tiene una revisión nueva.
  if (o.previous && tripId) {
    try {
      const base = prevConsulta ?? { ...savedConsulta(specFromTrip(o.previous), new Date().toISOString()), consulta_original: "" };
      const revisiones = [...(base.revisiones ?? []), { version: rev!.version, trip_id: tripId, at: consulta.guardado_at, consulta_original: spec.consulta_original }];
      await client.from("trips").update({ itinerario_json: withConsulta(o.previous.itinerario_json ?? [], { ...base, revisiones }) }).eq("id", o.previous.id);
    } catch (e) { console.warn("revisión no anotada en el viaje anterior", (e as Error)?.message); }
  }
  return { tripId, flujo };
}
