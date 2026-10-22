// Ejecución de una acción que el usuario CONFIRMÓ en la tarjeta de Iato. Sin Deno: la base (con la
// sesión del propio usuario, así manda la RLS) y las llamadas a otras funciones llegan por parámetro.
//
// Antes de ejecutar se vuelve a validar todo (validateAction) con los viajes a los que el usuario
// tiene acceso hoy: la tarjeta pudo quedar vieja o venir alterada. Los límites del plan los aplican las
// funciones dueñas (price-watch: alertas activas; track-flight: vuelos seguidos; concierge-action:
// ritmo de solicitudes y reglas de Privé).

import { type ActionContext, addItineraryItem, mergePackingItems, validateAction } from "./actions.ts";

export interface FnResponse { status: number; json: any }

export interface ExecDeps {
  userId: string;
  // deno-lint-ignore no-explicit-any
  db: any;
  callFunction: (name: string, body: unknown, headers?: Record<string, string>) => Promise<FnResponse>;
  priveSession?: string | null;
  /** AUD-SEG-05: clave de idempotencia del cliente; se reenvía a concierge-action (no duplica la solicitud). */
  idempotencyKey?: string | null;
}

export interface ExecResult { ok: boolean; message: string; code?: string; link?: string; data?: Record<string, unknown> }

const SAFE_CODES = new Set(["FREE_LIMIT_REACHED", "INVALID_REQUEST", "SERVICE_UNAVAILABLE", "MEMBERS_PRO_REQUIRED"]);

const REASON_TEXT: Record<string, string> = {
  viaje_sin_acceso: "No tienes acceso a ese viaje.",
  falta_el_viaje: "Primero elige el viaje.",
  fecha_pasada: "Esa fecha ya pasó.",
  viaje_no_futuro: "Solo se pueden vigilar precios de viajes con fecha futura.",
  sin_sesion_prive: "Desbloquea IATOS Privé en la app para enviar esta solicitud.",
  experiencia_no_mostrada: "Esa experiencia ya no está en la propuesta; pídele a Iato que la busque de nuevo.",
  dia_sin_plan: "Ese día no tiene actividades en el itinerario.",
};

function fnError(r: FnResponse, fallback: string): ExecResult {
  const code = typeof r.json?.code === "string" ? r.json.code : undefined;
  const msg = code && SAFE_CODES.has(code) && typeof r.json?.message === "string" ? r.json.message : fallback;
  return { ok: false, message: msg, code: code ?? `http_${r.status}` };
}

export async function executeAction(type: unknown, params: unknown, ctx: ActionContext, d: ExecDeps): Promise<ExecResult> {
  const v = validateAction(type, params, ctx);
  if (!v.ok) {
    const reason = (v as { reason: string }).reason.replace(/ /g, "_");
    return { ok: false, code: reason, message: REASON_TEXT[reason] ?? "No pude validar esa acción. Pídele a Iato que la prepare de nuevo." };
  }
  const a = v.action;
  const p = a.params as Record<string, any>;
  if (a.runs === "client") return { ok: false, code: "CLIENT_ACTION", message: "Esta acción se hace en la app." };

  switch (a.type) {
    case "create_trip": {
      const { data, error } = await d.db.from("trips").insert({
        user_id: d.userId, destino: p.destino, fecha_salida: p.fecha_salida ?? null, fecha_regreso: p.fecha_regreso ?? null,
        num_viajeros: p.num_viajeros ?? 1, ciudad_origen: p.ciudad_origen ?? null, status: "borrador",
      }).select("id").single();
      if (error || !data?.id) return { ok: false, code: "DB_ERROR", message: "No pude crear el viaje. Intenta de nuevo." };
      return { ok: true, message: `Listo: creé tu viaje a ${p.destino}. Aún no tiene vuelos ni hotel reservados.`, link: `/dashboard/viajes/${data.id}`, data: { trip_id: data.id } };
    }
    case "add_itinerary_item": {
      const { data: trip, error } = await d.db.from("trips").select("id, fecha_salida, itinerario_json").eq("id", p.trip_id).maybeSingle();
      if (error || !trip) return { ok: false, code: "TRIP_NOT_FOUND", message: "No encontré ese viaje." };
      const next = addItineraryItem(trip.itinerario_json, trip, { fecha: p.fecha, titulo: p.titulo, hora: p.hora, lugar: p.lugar, nota: p.nota });
      const { error: upErr } = await d.db.from("trips").update({ itinerario_json: next }).eq("id", p.trip_id);
      if (upErr) return { ok: false, code: "DB_ERROR", message: "No pude guardar el itinerario." };
      return { ok: true, message: `Agregado a tu itinerario: ${p.titulo}${p.hora ? ` a las ${p.hora}` : ""}. No es una reserva.`, link: `/dashboard/viajes/${p.trip_id}` };
    }
    case "add_expense": {
      const { error } = await d.db.from("expenses").insert({
        user_id: d.userId, trip_id: p.trip_id ?? null, amount: p.monto, currency: p.moneda, category: p.categoria,
        description: p.descripcion ?? null, expense_date: p.fecha,
      });
      if (error) return { ok: false, code: "DB_ERROR", message: "No pude registrar el gasto." };
      return { ok: true, message: "Gasto registrado.", link: "/dashboard/gastos" };
    }
    case "add_packing_items": {
      const { data: row } = await d.db.from("packing_lists").select("id, lista_json, user_id").eq("trip_id", p.trip_id).maybeSingle();
      const lista = mergePackingItems(row?.lista_json ?? null, p.items);
      const { error } = row?.id
        ? await d.db.from("packing_lists").update({ lista_json: lista, updated_at: new Date().toISOString() }).eq("id", row.id)
        : await d.db.from("packing_lists").insert({ trip_id: p.trip_id, user_id: d.userId, lista_json: lista });
      if (error) return { ok: false, code: "DB_ERROR", message: "No pude actualizar la maleta (si el viaje es compartido, la lista es de quien la creó)." };
      return { ok: true, message: `Agregué ${p.items.length === 1 ? "1 cosa" : `${p.items.length} cosas`} a tu maleta.`, link: `/dashboard/viajes/${p.trip_id}/packing` };
    }
    case "create_price_alert": {
      const r = await d.callFunction("price-watch", { action: "start", trip_id: p.trip_id });
      if (r.status !== 200 || !r.json?.ok) return fnError(r, "No pude activar la alerta de precio ahora.");
      return { ok: true, message: "Alerta activada: te avisamos si el precio del vuelo baja. El precio base es el de hoy.", link: `/dashboard/viajes/${p.trip_id}` };
    }
    case "track_flight": {
      const r = await d.callFunction("track-flight", { flight: p.vuelo, flight_date: p.fecha, route: p.ruta ?? null, trip_id: p.trip_id ?? null, active: true, today: ctx.todayISO });
      if (r.status !== 200 || !r.json?.ok) return fnError(r, "No pude activar el seguimiento del vuelo ahora.");
      return { ok: true, message: `Listo: sigo el vuelo ${p.vuelo} y te aviso de cambios de puerta, retrasos o cancelación.` };
    }
    case "save_place": {
      const { data: existing } = await d.db.from("recomendaciones").select("id").eq("user_id", d.userId).eq("titulo", p.nombre).eq("tipo", "lugar").limit(1).maybeSingle();
      const row = { guardado: true, descripcion: p.direccion ?? null, metadata: { maps_url: p.maps_url ?? null, sitio: p.sitio ?? null, lat: p.lat ?? null, lng: p.lng ?? null, fuente: "iato" } };
      const { error } = existing?.id
        ? await d.db.from("recomendaciones").update(row).eq("id", existing.id)
        : await d.db.from("recomendaciones").insert({ user_id: d.userId, titulo: p.nombre, tipo: "lugar", ...row });
      if (error) return { ok: false, code: "DB_ERROR", message: "No pude guardarlo en favoritos." };
      return { ok: true, message: `${p.nombre} quedó en tus favoritos.`, link: "/dashboard/favoritos" };
    }
    case "update_trip_hotel": {
      const { data: trip, error } = await d.db.from("trips").select("id, hospedaje_json").eq("id", p.trip_id).maybeSingle();
      if (error || !trip) return { ok: false, code: "TRIP_NOT_FOUND", message: "No encontré ese viaje." };
      const prev = Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : [];
      const nuevo = { nombre: p.nombre, direccion: p.direccion ?? null, check_in: p.check_in ?? null, check_out: p.check_out ?? null, desde_usuario: true, agregado_por: "iato", agregado_at: new Date().toISOString() };
      const rest = prev.filter((h: any) => String(h?.nombre ?? "").toLowerCase() !== String(p.nombre).toLowerCase());
      const { error: upErr } = await d.db.from("trips").update({ hospedaje_json: [nuevo, ...rest] }).eq("id", p.trip_id);
      if (upErr) return { ok: false, code: "DB_ERROR", message: "No pude actualizar el hotel del viaje." };
      return { ok: true, message: `Actualicé tu hotel a ${p.nombre} (dato tuyo, sin verificar). Ya puedo buscarte cena o transporte cerca.`, link: `/dashboard/viajes/${p.trip_id}` };
    }
    case "fixer_request": {
      const typeMap: Record<string, string> = { reservation: "reservation", transport: "transport", rebooking: "rebooking", luggage: "pickup", other: "fixer_request" };
      const r = await d.callFunction("concierge-action", {
        type: typeMap[p.tipo] ?? "fixer_request", title: p.titulo, trip_id: p.trip_id ?? null,
        payload: { ...p, origen: "iato" },
        ...(d.idempotencyKey ? { idempotency_key: d.idempotencyKey } : {}),
      });
      if (r.status !== 200 || !r.json?.ok) return fnError(r, "No pude enviar la solicitud al Fixer. Usa el botón Contactar Fixer.");
      const folio = String(r.json?.request?.id ?? "").slice(0, 8).toUpperCase();
      // AUD-IATO-03: si el correo al equipo falló, la solicitud quedó guardada pero ningún humano la
      // vio todavía: no se promete respuesta (mismo criterio que RequestNote en ConciergeCards).
      if (r.json?.human_notified === false) {
        return {
          ok: true,
          message: `Tu solicitud quedó registrada${folio ? ` (folio ${folio})` : ""}, pero no pudimos avisar al equipo al instante. Aún no está reservado. Si no te respondemos pronto, usa el botón Contactar Fixer.`,
          data: { folio, status: "solicitado", human_notified: false },
        };
      }
      return { ok: true, message: `Solicitud enviada al Fixer${folio ? ` (folio ${folio})` : ""}. Estado: solicitado. Aún no está reservado; te avisamos cuando haya respuesta.`, data: { folio, status: "solicitado", human_notified: true } };
    }
    case "prive_request": {
      if (!d.priveSession) return { ok: false, code: "PRIVE_NO_SESSION", message: REASON_TEXT.sin_sesion_prive };
      const r = await d.callFunction("concierge-action", {
        type: "prive_request", title: p.nombre ? `Privé: ${p.nombre}` : "Solicitud Privé", trip_id: ctx.activeTripId,
        payload: { experience_id: p.experience_id, requested_for: p.fecha ? `${p.fecha}T20:00:00` : null, party_size: p.personas ?? null, preferences: p.preferencias ?? null, contact_method: "app" },
        ...(d.idempotencyKey ? { idempotency_key: d.idempotencyKey } : {}),
      }, { "x-prive-session": d.priveSession });
      if (r.status !== 200 || !r.json?.ok) return fnError(r, "No pude enviar la solicitud Privé. Revisa que Privé siga desbloqueado.");
      return { ok: true, message: "Solicitud Privé enviada. Estado: solicitado. Aún no está reservado: el equipo te confirma cuando el lugar responda.", link: "/prive/solicitudes" };
    }
    default:
      return { ok: false, code: "UNKNOWN", message: "Acción no disponible." };
  }
}
