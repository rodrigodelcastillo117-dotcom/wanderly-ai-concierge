// Acciones de Iato ("que pueda hacer cosas por ti"). Lógica pura: validación, resumen legible,
// itinerario, lista de empaque y calendario (.ics). La importan el servidor y la pantalla, y se
// prueba con Vitest.
//
// Reglas:
//   * Nada se ejecuta por el texto del modelo. El modelo PROPONE {type, params}; el servidor valida y
//     arma el resumen exacto de lo que se hará (nunca se muestra el texto del modelo como resumen); la
//     pantalla muestra Confirmar / Cancelar; al confirmar, el servidor VUELVE a validar (permisos del
//     usuario con su propia sesión, viaje al que tiene acceso, límites del plan) y ejecuta.
//   * Ninguna acción reserva ni compra: las solicitudes al Fixer quedan "solicitado" y la pantalla
//     dice "Aún no está reservado".

export const ACTION_TYPES = [
  "create_trip", "add_itinerary_item", "add_expense", "add_packing_items", "create_price_alert", "track_flight",
  "save_place", "update_trip_hotel", "fixer_request", "prive_request", "export_calendar", "open_emergency",
] as const;
export type ActionType = typeof ACTION_TYPES[number];

/** Dónde corre al confirmar: en el servidor (cambia datos) o en la app (descarga o abre una pantalla). */
export const CLIENT_ACTIONS = new Set<ActionType>(["export_calendar", "open_emergency"]);

export const EXPENSE_CATEGORIES = ["Alojamiento", "Gastronomía", "Experiencias", "Transporte", "Otros"] as const;
export const FIXER_KINDS = ["reservation", "transport", "rebooking", "luggage", "other"] as const;

export interface ProposedAction {
  id: string;
  type: ActionType;
  params: Record<string, unknown>;
  /** Lo que pasará, armado por el servidor con los datos validados. */
  summary: string;
  confirm_label: string;
  runs: "server" | "client";
  /** Aclaración honesta (p. ej. "Aún no está reservado"). */
  note?: string;
}

export interface CalendarEvent { title: string; date: string; time?: string; durationMin?: number; location?: string; description?: string }

export interface ActionContext {
  todayISO: string;
  /** Viajes a los que el usuario tiene acceso (propios y compartidos). */
  trips: Array<{ id: string; destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null; itinerario_json?: unknown; ciudad_origen?: string | null }>;
  activeTripId: string | null;
  /** Experiencias Privé que devolvió search_prive en este turno (solo esas se pueden solicitar). */
  priveExperienceIds?: Set<string>;
  hasPriveSession?: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

const isIso = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
const txt = (v: unknown, max: number) => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};
const num = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(x) ? x : undefined;
};
const httpsUrl = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

const fmtDate = (d: string) => {
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
const fmtMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

export type ValidateResult = { ok: true; action: Omit<ProposedAction, "id"> } | { ok: false; reason: string };

/** El viaje indicado si el usuario tiene acceso; si no se indicó, el viaje en contexto. */
function resolveTrip(raw: unknown, ctx: ActionContext, required: boolean) {
  const id = typeof raw === "string" && UUID.test(raw) ? raw : !raw ? ctx.activeTripId : null;
  if (!id) return required ? { error: "falta el viaje" } : { trip: null };
  const trip = ctx.trips.find((t) => t.id === id);
  if (!trip) return { error: "viaje sin acceso" };
  return { trip };
}

const tripName = (t: { destino?: string | null } | null | undefined) => (t?.destino ? `tu viaje a ${t.destino}` : "tu viaje");

export function validateAction(type: unknown, rawParams: unknown, ctx: ActionContext): ValidateResult {
  if (typeof type !== "string" || !(ACTION_TYPES as readonly string[]).includes(type)) return { ok: false, reason: "tipo_desconocido" };
  const p = rawParams && typeof rawParams === "object" && !Array.isArray(rawParams) ? (rawParams as Record<string, unknown>) : {};
  const t = type as ActionType;
  const runs = CLIENT_ACTIONS.has(t) ? "client" : "server";
  const ok = (params: Record<string, unknown>, summary: string, confirm_label = "Confirmar", note?: string): ValidateResult =>
    ({ ok: true, action: { type: t, params, summary, confirm_label, runs, ...(note ? { note } : {}) } });

  switch (t) {
    case "create_trip": {
      const destino = txt(p.destino, 120);
      if (!destino) return { ok: false, reason: "falta_destino" };
      const salida = isIso(p.fecha_salida) ? p.fecha_salida : undefined;
      const regreso = isIso(p.fecha_regreso) ? p.fecha_regreso : undefined;
      if (salida && salida < ctx.todayISO) return { ok: false, reason: "fecha_pasada" };
      if (salida && regreso && regreso < salida) return { ok: false, reason: "fechas_invertidas" };
      const viajeros = num(p.num_viajeros);
      const params = {
        destino, ...(salida ? { fecha_salida: salida } : {}), ...(regreso ? { fecha_regreso: regreso } : {}),
        ...(viajeros && viajeros >= 1 && viajeros <= 20 ? { num_viajeros: Math.round(viajeros) } : {}),
        ...(txt(p.ciudad_origen, 80) ? { ciudad_origen: txt(p.ciudad_origen, 80) } : {}),
      };
      const fechas = salida ? ` · ${fmtDate(salida)}${regreso ? ` – ${fmtDate(regreso)}` : ""}` : "";
      return ok(params, `Crear el viaje a ${destino}${fechas}`, "Crear viaje");
    }
    case "add_itinerary_item": {
      const r = resolveTrip(p.trip_id, ctx, true);
      if ("error" in r) return { ok: false, reason: r.error! };
      const titulo = txt(p.titulo, 120);
      if (!titulo) return { ok: false, reason: "falta_titulo" };
      const fecha = isIso(p.fecha) ? p.fecha : undefined;
      if (!fecha) return { ok: false, reason: "falta_fecha" };
      const hora = typeof p.hora === "string" && TIME.test(p.hora.trim()) ? p.hora.trim().padStart(5, "0") : undefined;
      const params = { trip_id: r.trip!.id, fecha, titulo, ...(hora ? { hora } : {}), ...(txt(p.lugar, 160) ? { lugar: txt(p.lugar, 160) } : {}), ...(txt(p.nota, 300) ? { nota: txt(p.nota, 300) } : {}) };
      return ok(params, `Agregar a ${tripName(r.trip)}: ${titulo} · ${fmtDate(fecha)}${hora ? ` ${hora}` : ""}`, "Agregar al itinerario");
    }
    case "add_expense": {
      const r = resolveTrip(p.trip_id, ctx, false);
      if ("error" in r) return { ok: false, reason: r.error! };
      const monto = num(p.monto ?? p.amount);
      if (!monto || monto <= 0 || monto > 10_000_000) return { ok: false, reason: "monto_invalido" };
      const moneda = typeof (p.moneda ?? p.currency) === "string" && /^[A-Za-z]{3}$/.test(String(p.moneda ?? p.currency).trim()) ? String(p.moneda ?? p.currency).trim().toUpperCase() : "MXN";
      const catRaw = txt(p.categoria ?? p.category, 40) ?? "Otros";
      const categoria = (EXPENSE_CATEGORIES as readonly string[]).find((c) => c.toLowerCase() === catRaw.toLowerCase()) ?? "Otros";
      const fecha = isIso(p.fecha) ? p.fecha : ctx.todayISO;
      const params = { monto: Math.round(monto * 100) / 100, moneda, categoria, fecha, ...(r.trip ? { trip_id: r.trip.id } : {}), ...(txt(p.descripcion, 200) ? { descripcion: txt(p.descripcion, 200) } : {}) };
      return ok(params, `Registrar gasto: ${fmtMoney(params.monto, moneda)} · ${categoria}${params.descripcion ? ` · ${params.descripcion}` : ""} · ${fmtDate(fecha)}`, "Registrar gasto");
    }
    case "add_packing_items": {
      const r = resolveTrip(p.trip_id, ctx, true);
      if ("error" in r) return { ok: false, reason: r.error! };
      const items = (Array.isArray(p.items) ? p.items : []).map((x) => txt(x, 80)).filter(Boolean) as string[];
      const unique = [...new Set(items)].slice(0, 20);
      if (!unique.length) return { ok: false, reason: "sin_items" };
      return ok({ trip_id: r.trip!.id, items: unique }, `Agregar a la maleta de ${tripName(r.trip)}: ${unique.slice(0, 5).join(", ")}${unique.length > 5 ? ` y ${unique.length - 5} más` : ""}`, "Agregar a la maleta");
    }
    case "create_price_alert": {
      const r = resolveTrip(p.trip_id, ctx, true);
      if ("error" in r) return { ok: false, reason: r.error! };
      if (!r.trip!.fecha_salida || String(r.trip!.fecha_salida) <= ctx.todayISO) return { ok: false, reason: "viaje_no_futuro" };
      return ok({ trip_id: r.trip!.id }, `Vigilar el precio del vuelo de ${tripName(r.trip)} y avisarte si baja`, "Activar alerta");
    }
    case "track_flight": {
      const code = String(p.vuelo ?? p.flight ?? "").toUpperCase().replace(/\s+/g, "");
      if (!/^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,4}$/.test(code)) return { ok: false, reason: "vuelo_invalido" };
      const fecha = isIso(p.fecha ?? p.flight_date) ? String(p.fecha ?? p.flight_date) : undefined;
      if (!fecha) return { ok: false, reason: "falta_fecha" };
      if (fecha < ctx.todayISO) return { ok: false, reason: "fecha_pasada" };
      const r = resolveTrip(p.trip_id, ctx, false);
      const params = { vuelo: code, fecha, ...(txt(p.ruta, 40) ? { ruta: txt(p.ruta, 40) } : {}), ...(!("error" in r) && r.trip ? { trip_id: r.trip.id } : {}) };
      return ok(params, `Seguir el vuelo ${code} del ${fmtDate(fecha)} y avisarte de cambios de puerta o retrasos`, "Seguir vuelo");
    }
    case "save_place": {
      const nombre = txt(p.nombre ?? p.name, 120);
      if (!nombre) return { ok: false, reason: "falta_nombre" };
      const lat = num(p.lat), lng = num(p.lng);
      const params = {
        nombre, ...(txt(p.direccion, 200) ? { direccion: txt(p.direccion, 200) } : {}),
        ...(httpsUrl(p.maps_url) ? { maps_url: httpsUrl(p.maps_url) } : {}), ...(httpsUrl(p.sitio) ? { sitio: httpsUrl(p.sitio) } : {}),
        ...(lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : {}),
        ...(txt(p.tipo, 40) ? { tipo: txt(p.tipo, 40) } : {}),
      };
      return ok(params, `Guardar ${nombre} en tus favoritos`, "Guardar");
    }
    case "update_trip_hotel": {
      const r = resolveTrip(p.trip_id, ctx, true);
      if ("error" in r) return { ok: false, reason: r.error! };
      const nombre = txt(p.nombre, 120);
      if (!nombre) return { ok: false, reason: "falta_nombre" };
      const ci = isIso(p.check_in) ? p.check_in : undefined;
      const co = isIso(p.check_out) ? p.check_out : undefined;
      if (ci && co && co < ci) return { ok: false, reason: "fechas_invertidas" };
      const params = { trip_id: r.trip!.id, nombre, ...(txt(p.direccion, 200) ? { direccion: txt(p.direccion, 200) } : {}), ...(ci ? { check_in: ci } : {}), ...(co ? { check_out: co } : {}) };
      return ok(params, `Cambiar el hotel de ${tripName(r.trip)} a ${nombre}${ci ? ` (${fmtDate(ci)}${co ? ` – ${fmtDate(co)}` : ""})` : ""}`, "Actualizar hotel",
        "Se guarda como dato tuyo (sin verificar); no es una reserva.");
    }
    case "fixer_request": {
      const tipo = (FIXER_KINDS as readonly string[]).includes(String(p.tipo)) ? String(p.tipo) : "other";
      const titulo = txt(p.titulo, 140);
      if (!titulo) return { ok: false, reason: "falta_titulo" };
      const r = resolveTrip(p.trip_id, ctx, false);
      const personas = num(p.personas);
      const params = {
        tipo, titulo, ...(txt(p.detalle, 600) ? { detalle: txt(p.detalle, 600) } : {}), ...(isIso(p.fecha) ? { fecha: p.fecha } : {}),
        ...(typeof p.hora === "string" && TIME.test(p.hora.trim()) ? { hora: p.hora.trim() } : {}),
        ...(personas && personas >= 1 && personas <= 30 ? { personas: Math.round(personas) } : {}),
        ...(txt(p.lugar, 160) ? { lugar: txt(p.lugar, 160) } : {}),
        ...(!("error" in r) && r.trip ? { trip_id: r.trip.id } : {}),
      };
      return ok(params, `Pedirle al Fixer: ${titulo}`, "Pedírselo al Fixer",
        "Un humano del equipo lo gestiona y te avisa. Aún no está reservado.");
    }
    case "prive_request": {
      const exp = typeof p.experience_id === "string" && UUID.test(p.experience_id) ? p.experience_id : null;
      if (!exp) return { ok: false, reason: "falta_experiencia" };
      if (!ctx.hasPriveSession) return { ok: false, reason: "sin_sesion_prive" };
      if (ctx.priveExperienceIds && !ctx.priveExperienceIds.has(exp)) return { ok: false, reason: "experiencia_no_mostrada" };
      const personas = num(p.personas);
      const params = {
        experience_id: exp, ...(isIso(p.fecha) ? { fecha: p.fecha } : {}),
        ...(personas && personas >= 1 && personas <= 30 ? { personas: Math.round(personas) } : {}),
        ...(txt(p.preferencias, 600) ? { preferencias: txt(p.preferencias, 600) } : {}),
        ...(txt(p.nombre, 120) ? { nombre: txt(p.nombre, 120) } : {}),
      };
      return ok(params, `Solicitar a IATOS Privé${params.nombre ? `: ${params.nombre}` : ""}${params.fecha ? ` · ${fmtDate(params.fecha as string)}` : ""}`, "Solicitar",
        "El equipo Privé lo gestiona con el lugar. Aún no está reservado.");
    }
    case "export_calendar": {
      const r = resolveTrip(p.trip_id, ctx, true);
      if ("error" in r) return { ok: false, reason: r.error! };
      const fecha = isIso(p.fecha) ? p.fecha : undefined;
      const events = calendarEventsForDay(r.trip!, fecha);
      if (!events.length) return { ok: false, reason: "dia_sin_plan" };
      return ok({ trip_id: r.trip!.id, ...(fecha ? { fecha } : {}), events }, `Descargar a tu calendario ${events.length === 1 ? "1 evento" : `${events.length} eventos`} de ${tripName(r.trip)}${fecha ? ` (${fmtDate(fecha)})` : ""}`, "Descargar .ics");
    }
    case "open_emergency":
      return ok({}, "Ver números de emergencia y el hospital más cercano", "Abrir emergencia");
  }
  return { ok: false, reason: "tipo_desconocido" };
}

/**
 * Acciones propuestas por el modelo + las sugeridas por el planeador (si el modelo no las incluyó),
 * validadas, sin duplicados y como máximo 3.
 */
export function validateActions(raw: unknown, suggested: Array<{ type: string; params: Record<string, unknown> }>, ctx: ActionContext, makeId: () => string = () => crypto.randomUUID()) {
  const out: ProposedAction[] = [];
  const dropped: { type: string; reason: string }[] = [];
  const seen = new Set<string>();
  const list = [...(Array.isArray(raw) ? raw : []), ...suggested];
  for (const item of list) {
    if (out.length >= 3) break;
    const a = item as { type?: unknown; params?: unknown };
    const v = validateAction(a?.type, a?.params, ctx);
    if (!v.ok) { dropped.push({ type: String(a?.type ?? "?"), reason: (v as { reason: string }).reason }); continue; }
    // Una acción por tipo (dos fixer_request seguidos confunden).
    if (seen.has(v.action.type)) continue;
    seen.add(v.action.type);
    out.push({ id: makeId(), ...v.action });
  }
  return { actions: out, dropped };
}

// ═══ Itinerario ═══

export interface ItineraryAddition { fecha: string; titulo: string; hora?: string; lugar?: string; nota?: string }

const dayIndex = (start: string | null | undefined, fecha: string) =>
  start && ISO.test(String(start).slice(0, 10)) ? Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`)) / 86400000) + 1 : null;

/**
 * Agrega un elemento al día correspondiente del itinerario (array de días o {days, ...}). Lo agregado
 * va en `agregados` del día (TripDetail lo muestra) sin tocar el texto que armó el análisis. Si el día
 * no existe se crea con ese número.
 */
export function addItineraryItem(itinerario: unknown, trip: { fecha_salida?: string | null }, add: ItineraryAddition): unknown {
  const isObj = !!itinerario && typeof itinerario === "object" && !Array.isArray(itinerario);
  const days: any[] = Array.isArray(itinerario) ? [...itinerario] : isObj && Array.isArray((itinerario as any).days) ? [...(itinerario as any).days] : [];
  const idx = dayIndex(trip.fecha_salida, add.fecha);
  const entry = { ...add, agregado_por: "iato", agregado_at: new Date().toISOString() };
  let pos = days.findIndex((d) => d && (d.fecha === add.fecha || (idx !== null && Number(d.dia) === idx)));
  if (pos < 0) {
    days.push({ dia: idx && idx > 0 ? idx : days.length + 1, fecha: add.fecha, titulo: add.titulo, agregados: [entry] });
    days.sort((a, b) => Number(a?.dia ?? 0) - Number(b?.dia ?? 0));
  } else {
    const d = { ...days[pos] };
    d.agregados = [...(Array.isArray(d.agregados) ? d.agregados : []), entry]
      .sort((a: any, b: any) => String(a?.hora ?? "99").localeCompare(String(b?.hora ?? "99")));
    days[pos] = d;
    pos = -1;
  }
  return isObj ? { ...(itinerario as Record<string, unknown>), days } : days;
}

// ═══ Lista de empaque ═══

export function mergePackingItems(lista: any, items: string[]): any {
  const base = lista && typeof lista === "object" && Array.isArray(lista.categorias)
    ? { ...lista, categorias: [...lista.categorias] }
    : { resumen: "Lista iniciada con Iato. Puedes generar la lista completa desde Equipaje.", categorias: [], tips_iato: [] };
  const existing = new Set(base.categorias.flatMap((c: any) => (c?.items ?? []).map((i: any) => String(i?.nombre ?? "").toLowerCase())));
  const pos = base.categorias.findIndex((c: any) => c?.id === "iato");
  const cat = pos >= 0 ? { ...base.categorias[pos], items: [...(base.categorias[pos].items ?? [])] } : { id: "iato", nombre: "Agregado con Iato", items: [] as any[] };
  for (const name of items) {
    if (existing.has(name.toLowerCase())) continue;
    existing.add(name.toLowerCase());
    cat.items.push({ id: `iato-${cat.items.length + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`, nombre: name, cantidad: "1", prioridad: "recomendado", donde: "ambos" });
  }
  if (pos >= 0) base.categorias[pos] = cat;
  else base.categorias.push(cat);
  return base;
}

// ═══ Calendario (.ics) ═══

const itineraryDays = (trip: { itinerario_json?: unknown }): any[] => {
  const it = trip.itinerario_json as any;
  return Array.isArray(it) ? it : Array.isArray(it?.days) ? it.days : [];
};

const dateForDay = (trip: { fecha_salida?: string | null }, d: any): string | null => {
  if (isIso(d?.fecha)) return d.fecha;
  const start = String(trip.fecha_salida ?? "").slice(0, 10);
  if (!ISO.test(start) || !Number.isFinite(Number(d?.dia))) return null;
  return new Date(Date.parse(`${start}T00:00:00Z`) + (Number(d.dia) - 1) * 86400000).toISOString().slice(0, 10);
};

/** Eventos de un día del itinerario (o del viaje completo si no hay fecha), máximo 30. */
export function calendarEventsForDay(trip: { destino?: string | null; fecha_salida?: string | null; itinerario_json?: unknown }, fecha?: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const slots: Array<[string, string]> = [["mañana", "09:00"], ["tarde", "14:00"], ["noche", "20:00"]];
  for (const d of itineraryDays(trip)) {
    const date = dateForDay(trip, d);
    if (!date || (fecha && date !== fecha)) continue;
    for (const [k, time] of slots) {
      const v = txt(d?.[k] ?? (k === "mañana" ? d?.manana : undefined), 500);
      if (v) out.push({ title: `${txt(d?.titulo, 80) ?? `Día ${d?.dia ?? ""}`} · ${k}`, date, time, durationMin: 180, description: v, location: trip.destino ?? undefined });
    }
    for (const a of Array.isArray(d?.agregados) ? d.agregados : []) {
      const title = txt(a?.titulo, 120);
      if (title) out.push({ title, date, time: typeof a?.hora === "string" && TIME.test(a.hora) ? a.hora : undefined, durationMin: 90, location: txt(a?.lugar, 160), description: txt(a?.nota, 300) });
    }
    if (out.length >= 30) break;
  }
  return out.slice(0, 30);
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/** Archivo .ics (RFC 5545) con hora local flotante: se agenda en la hora del lugar del viaje. */
export function buildIcs(events: CalendarEvent[], calName = "IATOS"): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IATOS//Concierge//ES", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(calName)}`];
  events.forEach((e, i) => {
    const d = e.date.replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:iatos-${d}-${i}-${Math.abs(hash(e.title))}@traveliatos.life`, `DTSTAMP:${stamp}`);
    if (e.time && TIME.test(e.time)) {
      const [h, m] = e.time.split(":").map(Number);
      const start = h * 60 + m;
      const end = start + (e.durationMin ?? 60);
      const fmt = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}${String(mins % 60).padStart(2, "0")}00`;
      const endDate = end >= 1440 ? new Date(Date.parse(`${e.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10).replace(/-/g, "") : d;
      lines.push(`DTSTART:${d}T${fmt(start)}`, `DTEND:${endDate}T${fmt(end % 1440)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ═══ Enlaces de reserva (sin socios conectados: el mejor camino honesto) ═══

/**
 * Enlaces para reservar un restaurante. El del propio lugar (si vino en los datos) va primero; después
 * búsquedas prellenadas en OpenTable (fecha y personas) y la ficha de Google Maps (que muestra
 * "Reservar" cuando el lugar lo ofrece). Son búsquedas: el lugar puede no estar ahí.
 */
export function restaurantBookingLinks(v: { name: string; city?: string; website?: string; mapsUrl?: string; date?: string; time?: string; party?: number }) {
  const links: Array<{ kind: "booking" | "website" | "maps"; label: string; url: string }> = [];
  const site = httpsUrl(v.website);
  if (site) links.push({ kind: "website", label: "Sitio del lugar", url: site });
  const ot = new URL("https://www.opentable.com/s");
  ot.searchParams.set("term", [v.name, v.city].filter(Boolean).join(" "));
  ot.searchParams.set("covers", String(Math.min(20, Math.max(1, Math.round(v.party ?? 2)))));
  if (v.date && ISO.test(v.date)) ot.searchParams.set("dateTime", `${v.date}T${v.time && TIME.test(v.time) ? v.time.padStart(5, "0") : "20:00"}`);
  links.push({ kind: "booking", label: "Buscar mesa en OpenTable", url: ot.toString() });
  const maps = httpsUrl(v.mapsUrl) ?? (() => {
    const u = new URL("https://www.google.com/maps/search/");
    u.searchParams.set("api", "1");
    u.searchParams.set("query", [v.name, v.city].filter(Boolean).join(", "));
    return u.toString();
  })();
  links.push({ kind: "maps", label: "Ver en Google Maps", url: maps });
  return links;
}
