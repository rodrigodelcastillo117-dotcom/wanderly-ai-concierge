// Generar y guardar un viaje multi-destino: logistics-plan → filas del viaje (multiDestTripRows) →
// trips.insert → snapshot de la cotización. Antes vivía dentro de MultiDestRoute; ahora lo usan
// MultiDestRoute y el planeador normal (PlanTrip, "paris roma y atenas 10 dias"), para que una ruta
// escrita en el planeador salga EXACTAMENTE igual que una armada en "Ruta multi-destino".
import { multiDestTripRows } from "@/lib/multiDestTrip";
import { countryForStops } from "@/lib/booking";
import { clearRequestKey, getRequestKey } from "@/lib/requestKey";
import type { SavedConsulta, SeaLeg } from "../../supabase/functions/_shared/tripSpec.ts";

type Client = {
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: any; error: any }> };
  from: (table: string) => any;
};

export type MultiDestArgs = {
  userId: string | null;
  origin: string;
  stops: string[];
  fechaSalida?: string | null;
  fechaRegreso?: string | null;
  viajeros: number;
  presupuesto?: number | string | null;
  /** Preferencias de la ruta (conexión, emoción, modo de transporte…), tal como las manda MultiDestRoute. */
  prefs: Record<string, unknown>;
  /** Noches por ciudad elegidas por la persona (deben sumar las noches del viaje). */
  nightsPerCity?: number[] | null;
  /** Bases elegidas por región ({ "Toscana": ["Siena","Lucca"] }); el servidor solo acepta las de su tabla. */
  regionBases?: Record<string, string[]> | null;
  /** Clase del vuelo internacional ("premium" | "business" | "primera"); sin ella, turista. */
  travelClass?: string | null;
  /** Telemetría de behavioral_insights (como antes en MultiDestRoute). */
  telemetry?: { autonomous: boolean } | null;
  /** Crucero/ferry entre paradas (intérprete de viaje): noches a bordo, puertos y precio por cotizar. */
  seaLegs?: SeaLeg[] | null;
  /** Preferencias, reservas y conexiones que escribió la persona (van al plan como contexto). */
  travelerNotes?: string | null;
  /** Texto original + interpretación: se guarda en itinerario_json.consulta para depurar y corregir. */
  consulta?: SavedConsulta | null;
};

export type MultiDestResult = { logistics: any; tripId?: string };

/** Lo que se manda a logistics-plan (sin la llave). Las noches por ciudad solo si cuadran. */
export function logisticsPlanArgs(a: MultiDestArgs) {
  const nights = Array.isArray(a.nightsPerCity) && a.nightsPerCity.length === a.stops.length && a.nightsPerCity.every((n) => Number.isInteger(n) && n >= 1)
    ? a.nightsPerCity : null;
  return {
    origin: a.origin,
    destinations: a.stops,
    fecha_salida: a.fechaSalida || undefined,
    fecha_regreso: a.fechaRegreso || undefined,
    num_viajeros: a.viajeros,
    prefs: a.prefs,
    ...(nights ? { nights_per_city: nights } : {}),
    ...(a.regionBases && Object.keys(a.regionBases).length ? { region_bases: a.regionBases } : {}),
    ...(a.travelClass && ["premium", "business", "primera"].includes(a.travelClass) ? { travel_class: a.travelClass } : {}),
    ...(a.seaLegs && a.seaLegs.length ? { sea_legs: a.seaLegs } : {}),
    ...(a.travelerNotes && a.travelerNotes.trim() ? { traveler_notes: a.travelerNotes.trim().slice(0, 900) } : {}),
  };
}

/** Fila de trips para el plan (destino "París → Roma → Atenas", país de la primera ciudad). */
export function multiDestTripInsert(a0: MultiDestArgs, logistics: any) {
  // Si el servidor convirtió una región en ciudades base ("Toscana" → Siena, Lucca), el viaje
  // se guarda con esas ciudades: son las de per_destination.
  const served = Array.isArray(logistics?.destinations) && logistics.destinations.length ? logistics.destinations.map(String) : null;
  const a = served ? { ...a0, stops: served } : a0;
  const { vuelos_json, hospedaje_json, restaurantes_json, tours_json } = multiDestTripRows(logistics, a.stops, a.origin);
  // itinerario_json: TripDetail espera un array de días.
  const days = (logistics?.days ?? []).map((d: any) => ({
    dia: d.dia,
    titulo: d.ciudad ? `${d.ciudad} — ${d.titulo}` : d.titulo,
    ciudad: d.ciudad,
    "mañana": d["mañana"] ?? d.manana ?? "",
    tarde: d.tarde ?? "",
    noche: d.noche ?? "",
  }));
  return {
    user_id: a.userId,
    destino: a.stops.join(" → "),
    // País de la primera ciudad ("Italia"), nunca el nombre de la última ciudad ("Venecia").
    pais_destino: countryForStops(a.stops),
    ciudad_origen: a.origin.trim(),
    fecha_salida: a.fechaSalida || null,
    fecha_regreso: a.fechaRegreso || null,
    num_viajeros: a.viajeros,
    presupuesto_objetivo: a.presupuesto != null && a.presupuesto !== "" ? Number(a.presupuesto) : null,
    // Total real calculado en el servidor (suma del desglose del tier del usuario).
    total_estimado: Number(logistics?.total_estimado_mxn) || null,
    desglose_presupuesto: logistics?.desglose_presupuesto ?? null,
    moneda: "MXN",
    status: "listo",
    analisis_ai: logistics?.resumen ?? null,
    vuelos_json,
    hospedaje_json,
    restaurantes_json,
    tours_json,
    itinerario_json: {
      multi: true, destinations: a.stops, logistics, days,
      ...(Array.isArray(logistics?.region_expansions) && logistics.region_expansions.length ? { region_expansions: logistics.region_expansions } : {}),
      ...(a.consulta ? { consulta: a.consulta } : {}),
    },
    tips_personalizados: logistics?.resumen ? [logistics.resumen] : null,
  };
}

/**
 * Pide el plan y guarda el viaje. Lanza el error de la función (límite del plan, falla) para que quien
 * llama muestre el mensaje de siempre (toastFunctionError). Misma llave al reintentar: el servidor
 * devuelve el plan ya generado sin gastar otro análisis.
 */
export async function generateMultiDestTrip(client: Client, a: MultiDestArgs): Promise<MultiDestResult> {
  if (a.userId && a.telemetry) {
    try {
      await client.from("behavioral_insights").insert([{
        user_id: a.userId, action: "planned", target_type: "multi_destination", target_label: a.stops.join(" → "),
        metadata: { autonomous: a.telemetry.autonomous, prefs: a.prefs, origin: a.origin },
      }]);
    } catch { /* la telemetría nunca detiene el plan */ }
  }
  const planArgs = logisticsPlanArgs(a);
  const request_key = getRequestKey("logistics-plan", planArgs);
  const { data, error } = await client.functions.invoke("logistics-plan", { body: { ...planArgs, request_key } });
  if (error) throw error;
  if (!data?.logistics) throw new Error("La IA no devolvió logística");
  const logistics = data.logistics;

  let tripId: string | undefined;
  if (a.userId) {
    const { data: trip, error: tErr } = await client.from("trips").insert(multiDestTripInsert(a, logistics)).select("id").single();
    if (tErr) console.error(tErr);
    else {
      tripId = trip?.id;
      // Snapshot inmutable de la cotización (trip_quotes, solo service role): el servidor lo arma con
      // el plan que él generó para esta llave. Si falla, el viaje queda igual que antes.
      if (tripId) {
        try {
          const { data: snap, error: snapErr } = await client.functions.invoke("logistics-plan", { body: { action: "snapshot", trip_id: tripId, request_key } });
          if (snapErr || !snap?.ok) console.warn("logistics-plan snapshot no guardado", snapErr?.message ?? snap?.error);
        } catch (e) {
          console.warn("logistics-plan snapshot no guardado", (e as Error)?.message);
        }
      }
      clearRequestKey("logistics-plan");
    }
  }
  return { logistics, tripId };
}
