// Operador IATOS · herramientas. El modelo decide QUÉ hacer; estas funciones deciden si se PUEDE y lo hacen:
//   · nunca paga, reserva ni cancela (no existe ninguna herramienta que lo haga);
//   · ver los datos del viajero y enviar un reclamo exigen su consentimiento, comprobado en la base contra un
//     mensaje REAL suyo en la bitácora (operator_consent), no contra lo que diga el modelo;
//   · a un proveedor solo se le escribe a un contacto obtenido con fuente (sitio oficial, directorio, su reserva o
//     lo que el viajero escribió) y en su horario local;
//   · un mensaje con un correo o teléfono que nadie verificó, o que promete un pago/reembolso/cancelación, no sale;
//   · una sola búsqueda de vuelos por caso (operator_spend 'vuelos').
// Cada acción queda en la bitácora del incidente (la anota el bucle). Puro (sin Deno).
import { addIncidentEvent, assignIncident, setIncidentNextStep, setIncidentStatus } from "../incidents.ts";
import { runReclamosTool } from "../derechos/herramientas.ts";
import { confirmarEnvio, estadoReclamos } from "../derechos/servicio.ts";
import { autorizaReclamo, autorizaVerTodo, correosEnMensajes, datosNoVerificados, FIRMA_VIAJERO, firmaProveedor, promesaIndebida, type TipoProveedor, ventanaProveedor } from "./politica.ts";
import type { CasoTomado, ContactoProveedor, EventoCaso, OperadorDeps } from "./tipos.ts";

type Schema = { type?: string; description?: string; enum?: readonly string[]; items?: Schema; properties?: Record<string, Schema>; required?: readonly string[] };
export type HerramientaOperador = { name: string; description: string; input_schema: Schema & { type: "object"; properties: Record<string, Schema> } };

const TIPOS_PROVEEDOR: TipoProveedor[] = ["hotel", "aerolinea", "traslado", "restaurante", "tour", "agencia", "otro"];

export const OPERADOR_TOOLS: HerramientaOperador[] = [
  {
    name: "ver_viaje",
    description: "Ver todo lo del viajero que ayude a resolver (viaje, vuelos, reservas, documentos enmascarados, gastos, conversaciones, correos reenviados, reclamos). " +
      "Solo funciona si el viajero ya dio permiso en el caso; si no, devuelve PERMISO_REQUERIDO: pídeselo con pedir_permiso.",
    input_schema: { type: "object", properties: { alcance: { type: "array", items: { type: "string", enum: ["viaje", "vuelos", "reservas", "boveda", "gastos", "conversaciones", "correos", "reclamos"] } } } },
  },
  {
    name: "pedir_permiso",
    description: "Pide al viajero un permiso explícito (sí/no) por la app y su canal. tipo 'ver_todo' para revisar sus datos; 'enviar_reclamo' para mandar " +
      "el reclamo con ese folio en su nombre. Su respuesta llega como mensaje nuevo; no supongas que dijo que sí.",
    input_schema: { type: "object", properties: { tipo: { type: "string", enum: ["ver_todo", "enviar_reclamo"] }, folio: { type: "string", description: "C-XXXXXX si es enviar_reclamo" }, mensaje: { type: "string", description: "La pregunta, breve y clara, en el idioma del viajero" } }, required: ["tipo", "mensaje"] },
  },
  {
    name: "revisar_derechos_vuelo",
    description: "Derechos del pasajero (México LAC, UE 261, UK261, DOT EE. UU., APPR Canadá, ANAC Brasil, Montreal) con monto, certeza y fuente oficial. Úsala antes de decir qué le corresponde.",
    input_schema: { type: "object", properties: {
      evento: { type: "string", enum: ["retraso", "cancelacion", "sobreventa", "conexion_perdida", "clase_inferior", "equipaje_perdido", "equipaje_danado", "equipaje_retrasado"] },
      origen: { type: "string" }, destino: { type: "string" }, aerolinea: { type: "string" }, vuelo: { type: "string" }, fecha: { type: "string" },
      horas_retraso_llegada: { type: "number" }, horas_retraso_salida: { type: "number" }, aviso_dias: { type: "number" }, reubicacion_ofrecida: { type: "boolean" },
      motivo: { type: "string" }, precio: { type: "number" }, moneda: { type: "string" },
    }, required: ["evento", "origen", "destino", "aerolinea"] },
  },
  {
    name: "revisar_derechos_servicio",
    description: "Derechos ante hotel, traslado, tour o agencia (cobro doble, servicio no prestado, sobreventa del hotel, reserva no encontrada, servicio deficiente): proveedor → banco → PROFECO.",
    input_schema: { type: "object", properties: {
      problema: { type: "string", enum: ["cobro_doble", "servicio_no_prestado", "sobreventa_hotel", "servicio_deficiente", "reserva_no_encontrada"] },
      proveedor: { type: "string" }, tipo_proveedor: { type: "string", enum: ["hotel", "traslado", "agencia", "tour", "otro"] }, pais_proveedor: { type: "string" },
      monto_pagado: { type: "number" }, monto_cobrado_de_mas: { type: "number" }, moneda: { type: "string" },
      pagado_con: { type: "string", enum: ["tarjeta_credito", "tarjeta_debito", "efectivo", "transferencia", "plataforma"] },
    }, required: ["problema", "proveedor", "tipo_proveedor"] },
  },
  {
    name: "preparar_reclamo",
    description: "Prepara la reclamación formal (carta con hechos, ley y monto) y le da folio C-XXXXXX. NO envía nada. Luego pide permiso con pedir_permiso tipo enviar_reclamo.",
    input_schema: { type: "object", properties: {
      tipo: { type: "string", enum: ["vuelo", "servicio"] },
      evento: { type: "string" }, origen: { type: "string" }, destino: { type: "string" }, aerolinea: { type: "string" }, vuelo: { type: "string" }, fecha: { type: "string" },
      horas_retraso_llegada: { type: "number" }, aviso_dias: { type: "number" }, reubicacion_ofrecida: { type: "boolean" }, motivo: { type: "string" },
      problema: { type: "string" }, proveedor: { type: "string" }, tipo_proveedor: { type: "string" }, pais_proveedor: { type: "string" },
      monto_cobrado_de_mas: { type: "number" }, moneda: { type: "string" }, pagado_con: { type: "string" }, relato: { type: "string" },
      correo_proveedor: { type: "string", description: "Solo un correo que ya esté en el caso con su fuente (contactos del caso); si no, omítelo" },
    }, required: ["tipo"] },
  },
  {
    name: "enviar_reclamo",
    description: "Envía el reclamo ya preparado. Solo procede si el viajero escribió en el caso un sí explícito con el folio (p. ej. «Sí, envía C-ABC123»). Si no, devuelve CONSENT_REQUIRED.",
    input_schema: { type: "object", properties: { folio: { type: "string", description: "C-XXXXXX" }, id: { type: "string", description: "id del reclamo (opcional)" } }, required: ["folio"] },
  },
  {
    name: "estado_vuelo",
    description: "Estado del vuelo desde la caché de seguimiento (sin gastar búsquedas).",
    input_schema: { type: "object", properties: { vuelo: { type: "string" }, fecha: { type: "string", description: "YYYY-MM-DD" } }, required: ["vuelo"] },
  },
  {
    name: "buscar_vuelos_alternativos",
    description: "Busca vuelos alternativos (caché compartida y cupo del viajero). UNA sola búsqueda por caso: piensa bien origen, destino y fecha. Muestra precios solo como referencia; no reserva.",
    input_schema: { type: "object", properties: { origen: { type: "string", description: "IATA" }, destino: { type: "string", description: "IATA" }, fecha: { type: "string", description: "YYYY-MM-DD" }, pasajeros: { type: "number" } }, required: ["origen", "destino", "fecha"] },
  },
  {
    name: "opciones_traslado",
    description: "Opciones honestas para moverse ahora (taxi oficial, app de transporte, transporte público, pedir a una persona de IATOS) según dónde está. Sin precios inventados.",
    input_schema: { type: "object", properties: { donde: { type: "string", description: "aeropuerto, hotel, ciudad…" }, hacia: { type: "string" }, de_noche: { type: "boolean" } }, required: ["donde"] },
  },
  {
    name: "lugares_cercanos",
    description: "Lugares reales cerca del viajero: hospital, policía, embajada/consulado, farmacia, hotel o cajero (Google Places). Requiere su ubicación en el caso.",
    input_schema: { type: "object", properties: { tipo: { type: "string", enum: ["hospital", "police", "embassy", "pharmacy", "lodging", "atm"] } }, required: ["tipo"] },
  },
  {
    name: "buscar_contacto_proveedor",
    description: "Busca el contacto OFICIAL de un proveedor (hotel, chofer, tour, restaurante): su sitio, Google Places o la reserva del viajero. Devuelve contacto_id con la fuente. Nunca adivines un correo.",
    input_schema: { type: "object", properties: { nombre: { type: "string" }, tipo: { type: "string", enum: TIPOS_PROVEEDOR }, ciudad: { type: "string" }, pais: { type: "string" } }, required: ["nombre", "tipo"] },
  },
  {
    name: "escribir_proveedor",
    description: "Escribe por correo a un proveedor usando un contacto_id obtenido con buscar_contacto_proveedor (o de las reservas/mensajes del viajero). Sale en el horario local del proveedor; si está cerrado, queda programado. " +
      "Pide algo concreto y verificable (confirmar llegada tardía, localizar al chofer, revisar un cobro). No prometas pagos.",
    input_schema: { type: "object", properties: { contacto_id: { type: "string" }, asunto: { type: "string" }, mensaje: { type: "string" }, idioma: { type: "string", enum: ["es", "en", "fr", "pt", "it", "de"] } }, required: ["contacto_id", "asunto", "mensaje"] },
  },
  {
    name: "escribir_viajero",
    description: "Escribe al viajero (app + push + su canal vinculado). Claro, breve, en su idioma: qué pasa, qué hiciste, qué sigue y cuándo. Sin datos que no vengan de tus herramientas.",
    input_schema: { type: "object", properties: { mensaje: { type: "string" }, urgente: { type: "boolean" } }, required: ["mensaje"] },
  },
  {
    name: "prometer_seguimiento",
    description: "Fija la hora en que vuelves a escribirle (siguiente paso visible al viajero). Si vence sin avance, el vigilante avisa al equipo.",
    input_schema: { type: "object", properties: { siguiente_paso: { type: "string" }, minutos: { type: "number", description: "5 a 1440" } }, required: ["siguiente_paso", "minutos"] },
  },
  {
    name: "pedir_humano",
    description: "Pasa el caso a una persona del equipo IATOS (dueño o Carlo) con un resumen accionable. Úsala si dudas, si hay riesgo, si hace falta pagar/cancelar/reservar, o si el viajero lo pide.",
    input_schema: { type: "object", properties: { resumen: { type: "string", description: "Qué pasa, qué ya hiciste, qué falta" }, motivo: { type: "string" } }, required: ["resumen", "motivo"] },
  },
  {
    name: "proponer_cierre",
    description: "Cuando el problema parece resuelto: pregunta al viajero si quedó resuelto (el caso NO se cierra sin su confirmación).",
    input_schema: { type: "object", properties: { resumen: { type: "string" } }, required: ["resumen"] },
  },
];
export const OPERADOR_TOOL_NAMES = OPERADOR_TOOLS.map((t) => t.name);

// ───────────────────────────── contexto de una corrida ─────────────────────────────
export type ContextoOperador = {
  deps: OperadorDeps;
  caso: CasoTomado;
  incidentId: string;
  userId: string;
  contactos: Map<string, ContactoProveedor>;
  /** Todo lo que el operador "sabe" (bitácora + resultados): base para rechazar datos inventados. */
  conocido: string[];
  mensajesViajero: number;
  escalado: boolean;
  cierrePropuesto: boolean;
  seguimiento: { texto: string; due: string } | null;
  esperando: "usuario" | "proveedor" | null;
  pendiente: Record<string, unknown> | null;
};

const s = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const MAX_MENSAJES_POR_CORRIDA = 4;

export function nuevoContexto(deps: OperadorDeps, caso: CasoTomado): ContextoOperador {
  const ctx: ContextoOperador = {
    deps, caso, incidentId: caso.incident.id, userId: caso.incident.user_id, contactos: new Map(), conocido: [], mensajesViajero: 0,
    escalado: false, cierrePropuesto: false, seguimiento: null, esperando: null, pendiente: caso.case.pending ?? null,
  };
  for (const e of caso.events) ctx.conocido.push(String(e.body ?? ""), JSON.stringify(e.data ?? {}));
  ctx.conocido.push(JSON.stringify(caso.incident.payload ?? {}));
  // Correos que el propio viajero escribió en el caso: contactos válidos con su fuente (el id del evento).
  for (const c of correosEnMensajes(caso.events)) {
    registrarContacto(ctx, { proveedor: "Contacto que diste en el caso", tipo: "otro", email: c.email, telefono: null, sitio: null, tz: null, idioma: null,
      fuente: { kind: "mensaje_usuario", event_id: String(c.eventId) } });
  }
  return ctx;
}

function registrarContacto(ctx: ContextoOperador, c: Omit<ContactoProveedor, "id">): ContactoProveedor {
  const id = `K${ctx.contactos.size + 1}`;
  const full = { ...c, id };
  ctx.contactos.set(id, full);
  ctx.conocido.push(JSON.stringify(full));
  return full;
}

/** Último mensaje real del viajero en la bitácora (el consentimiento solo se busca ahí). */
export function mensajesDelViajero(events: EventoCaso[]): EventoCaso[] {
  return events.filter((e) => e.actor === "usuario" && e.direction === "entrante" && (e.kind === "mensaje" || e.kind === "creado"));
}

async function consentir(ctx: ContextoOperador, kind: string, check: (t: string) => boolean, mustContain: string | null): Promise<{ ok: boolean; eventId?: number; texto?: string }> {
  const previo = ctx.caso.case.consents?.[kind];
  if (previo) return { ok: true, eventId: previo.event_id };
  // Solo mensajes posteriores a la pregunta (o cualquiera si no se preguntó) y del más nuevo al más viejo.
  const msgs = mensajesDelViajero(ctx.caso.events).reverse();
  const m = msgs.find((e) => check(String(e.body ?? "")));
  if (!m) return { ok: false };
  const r = await ctx.deps.db.rpc("operator_consent", { _id: ctx.incidentId, _owner: ctx.deps.owner, _kind: kind, _event_id: m.id, _must_contain: mustContain });
  const d = r.data as { ok?: boolean } | null;
  if (r.error || !d?.ok) return { ok: false };
  ctx.caso.case.consents = { ...(ctx.caso.case.consents ?? {}), [kind]: { event_id: m.id, at: m.at } };
  return { ok: true, eventId: m.id, texto: String(m.body ?? "") };
}

const appUrl = (id: string) => `/dashboard/concierge?tab=requests&id=${id}`;

async function mensajeAlViajero(ctx: ContextoOperador, texto: string, urgente: boolean, data: Record<string, unknown> = {}) {
  const cuerpo = `${texto.trim()}\n\n${FIRMA_VIAJERO}`;
  const ev = await addIncidentEvent(ctx.deps.db, ctx.incidentId, {
    kind: "mensaje", actor: "iato_ops", channel: "app", direction: "saliente", visibleToUser: true, body: cuerpo, delivery: "enviado",
    counterpart: "viajero", data: { operador: { herramienta: "escribir_viajero", ...data } },
  });
  let canales: unknown[] = [];
  if (ctx.deps.avisarViajero) {
    canales = await ctx.deps.avisarViajero(ctx.userId, { titulo: `IATOS · tu caso ${ctx.incidentId.replace(/-/g, "").slice(0, 8).toUpperCase()}`, texto: cuerpo, url: appUrl(ctx.incidentId), urgente }, ctx.incidentId)
      .catch((e) => [{ ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) }]);
  }
  ctx.mensajesViajero++;
  return { ok: ev.ok, canales };
}

function revisarSaliente(ctx: ContextoOperador, texto: string): string | null {
  const p = promesaIndebida(texto);
  if (p) return `RECHAZADO: el mensaje promete algo que el operador no puede cumplir («${p}»). Di qué vas a intentar y quién lo decide; si hace falta pagar, cancelar o reservar, usa pedir_humano.`;
  const fuera = datosNoVerificados(texto, ctx.conocido.join("\n"));
  if (fuera.length) return `RECHAZADO: estos datos no vienen de ninguna herramienta ni del caso: ${fuera.join(", ")}. No los inventes: búscalos con una herramienta o quítalos.`;
  return null;
}

/** Resultado de un reclamo para el modelo: lo que necesita para decidir (sin la carta en HTML, que es enorme). */
function compactarReclamo(r: Record<string, unknown>): Record<string, unknown> {
  const c = (r.claim ?? {}) as Record<string, unknown>;
  const carta = (r.carta ?? null) as Record<string, unknown> | null;
  const { claim: _c, carta: _k, ...resto } = r;
  return {
    ...Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 600) : Array.isArray(v) ? v.slice(0, 6) : v])),
    claim: { id: c.id, ref_code: c.ref_code, status: c.status, provider_name: c.provider_name, channel: c.channel, recipient_email: c.recipient_email ?? null, form_url: c.form_url ?? null },
    ...(carta ? { carta: { para: carta.para ?? null, canal: carta.canal, url: carta.url ?? null, asunto: carta.asunto, idioma: carta.idioma, inicio: String(carta.texto ?? "").slice(0, 700) } } : {}),
  };
}

// ───────────────────────────── ejecutor ─────────────────────────────
export async function ejecutarHerramienta(nombre: string, a: Record<string, unknown>, ctx: ContextoOperador): Promise<Record<string, unknown>> {
  const d = ctx.deps;
  const inc = ctx.caso.incident;
  const hoy = d.ahora().toISOString().slice(0, 10);
  switch (nombre) {
    case "ver_viaje": {
      const c = await consentir(ctx, "ver_todo", autorizaVerTodo, null);
      if (!c.ok) return { ok: false, code: "PERMISO_REQUERIDO", instruccion: "Pide permiso con pedir_permiso tipo ver_todo y espera su respuesta." };
      if (!d.verTodo) return { ok: false, code: "NO_DISPONIBLE" };
      const datos = await d.verTodo(ctx.userId, inc.trip_id, Array.isArray(a.alcance) ? a.alcance.map(String) : null);
      return { ok: true, fuente: "cuenta IATOS del viajero (con su permiso)", datos };
    }
    case "pedir_permiso": {
      const tipo = a.tipo === "enviar_reclamo" ? "enviar_reclamo" : "ver_todo";
      const folio = s(a.folio, 10);
      if (tipo === "enviar_reclamo" && !folio) return { ok: false, error: "falta el folio C-XXXXXX" };
      if (ctx.mensajesViajero >= MAX_MENSAJES_POR_CORRIDA) return { ok: false, error: "Ya le escribiste suficiente en esta corrida; espera su respuesta." };
      const pregunta = s(a.mensaje, 1200) ?? "";
      const extra = tipo === "enviar_reclamo" ? `\n\nSi estás de acuerdo, responde: «Sí, envía ${folio}».` : "\n\nResponde «sí» para darme permiso o «no» si prefieres que no.";
      const bad = revisarSaliente(ctx, pregunta);
      if (bad) return { ok: false, error: bad };
      const r = await mensajeAlViajero(ctx, pregunta + extra, false, { permiso: tipo, folio });
      ctx.esperando = "usuario";
      ctx.pendiente = { permiso: tipo, folio: folio ?? null, preguntado_at: d.ahora().toISOString() };
      return { ok: r.ok, enviado: true, nota: "Su respuesta llegará como mensaje nuevo; termina esta corrida." };
    }
    case "revisar_derechos_vuelo":
    case "revisar_derechos_servicio": {
      const r = await runReclamosTool(nombre, a, { userId: ctx.userId, lector: { from: () => { throw new Error("sin lector"); } } as never, deps: null, hoy });
      return r as Record<string, unknown>;
    }
    case "preparar_reclamo": {
      const deps = d.reclamos?.(ctx.incidentId) ?? null;
      if (!deps) return { ok: false, code: "RECLAMOS_NO_DISPONIBLE" };
      // Correo del proveedor para el reclamo: SOLO uno que ya tenga fuente en este caso (nunca lo que proponga el modelo).
      const pedido = s(a.correo_proveedor, 200)?.toLowerCase() ?? null;
      const conocido = pedido ? [...ctx.contactos.values()].find((c) => c.email?.toLowerCase() === pedido) : null;
      if (pedido && !conocido) return { ok: false, code: "CORREO_SIN_FUENTE", error: "Ese correo no viene de ninguna fuente del caso. Prepara el reclamo sin correo (queda para su formulario oficial) o pide al viajero el correo que le dio el proveedor." };
      const fuente = conocido ? (conocido.fuente.kind === "mensaje_usuario" ? "usuario_confirmado" : conocido.fuente.kind === "reserva" ? "reserva" : "correo_del_proveedor") : null;
      const r = await runReclamosTool("preparar_reclamo", { ...a, correo_proveedor: conocido?.email ?? null, fuente_correo: fuente, trip_id: inc.trip_id },
        { userId: ctx.userId, lector: { from: () => { throw new Error("sin lector"); } } as never, deps, hoy }) as Record<string, unknown>;
      return compactarReclamo(r);
    }
    case "enviar_reclamo": {
      const folio = (s(a.folio, 10) ?? "").toUpperCase();
      if (!/^C-[A-Z0-9]{6}$/.test(folio)) return { ok: false, error: "folio inválido (C-XXXXXX)" };
      const deps = d.reclamos?.(ctx.incidentId) ?? null;
      if (!deps) return { ok: false, code: "RECLAMOS_NO_DISPONIBLE" };
      // El reclamo se busca por su folio entre los del viajero (el modelo no puede apuntar a uno ajeno).
      const lista = await estadoReclamos(deps, ctx.userId, {});
      const rec = ((lista.body.reclamos ?? []) as Array<{ id: string; ref_code: string }>).find((x) => x.ref_code === folio);
      if (!rec) return { ok: false, code: "NOT_FOUND", error: `No hay un reclamo ${folio} de este viajero.` };
      const id = rec.id;
      const c = await consentir(ctx, `enviar_reclamo:${folio}`, (t) => autorizaReclamo(t, folio), folio);
      if (!c.ok) return { ok: false, code: "CONSENT_REQUIRED", instruccion: `No se envía nada sin su sí explícito. Usa pedir_permiso tipo enviar_reclamo con folio ${folio}.` };
      const r = await confirmarEnvio(deps, ctx.userId, { id, confirm: true, confirm_text: (c.texto ?? `Consentimiento en el evento ${c.eventId}`).slice(0, 300) });
      return compactarReclamo(r.body);
    }
    case "estado_vuelo": {
      if (!d.estadoVuelo) return { ok: false, code: "NO_DISPONIBLE" };
      const vuelo = (s(a.vuelo, 12) ?? "").replace(/\s+/g, "").toUpperCase();
      if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(vuelo)) return { ok: false, error: "número de vuelo inválido" };
      return { ok: true, resultado: await d.estadoVuelo(vuelo, s(a.fecha, 10), ctx.userId) };
    }
    case "buscar_vuelos_alternativos": {
      const previo = ctx.caso.events.find((e) => (e.data as { operador?: { herramienta?: string } } | null)?.operador?.herramienta === "buscar_vuelos_alternativos");
      const q = { origen: (s(a.origen, 3) ?? "").toUpperCase(), destino: (s(a.destino, 3) ?? "").toUpperCase(), fecha: s(a.fecha, 10) ?? "", pasajeros: Math.max(1, Math.min(9, n(a.pasajeros) ?? 1)) };
      if (!/^[A-Z]{3}$/.test(q.origen) || !/^[A-Z]{3}$/.test(q.destino) || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha)) return { ok: false, error: "origen/destino IATA y fecha YYYY-MM-DD" };
      const gasto = await d.db.rpc("operator_spend", { _id: ctx.incidentId, _owner: d.owner, _kind: "vuelos", _amount: 1 });
      const g = gasto.data as { ok?: boolean; code?: string } | null;
      if (!g?.ok) return { ok: false, code: g?.code ?? "CAP_BUSQUEDA", mensaje: "Ya se hizo la búsqueda de vuelos de este caso: usa ese resultado o pide a una persona.", resultado_anterior: previo?.data ?? null };
      if (!d.buscarVuelos) return { ok: false, code: "NO_DISPONIBLE" };
      const r = await d.buscarVuelos(q, ctx.userId);
      return { ok: true, consulta: q, resultado: r, aviso: "Precios de referencia de la búsqueda; no hay nada reservado." };
    }
    case "opciones_traslado": {
      const donde = s(a.donde, 120) ?? "";
      const noche = a.de_noche === true;
      const aeropuerto = /aeropuerto|airport|terminal|\b[A-Z]{3}\b/i.test(donde);
      return {
        ok: true, donde, hacia: s(a.hacia, 120),
        opciones: [
          aeropuerto ? "Taxi o transporte autorizado del aeropuerto: compra el boleto en el módulo oficial dentro de la terminal, no con personas en la salida." : "Taxi de sitio o el que llame la recepción de tu hotel o del lugar donde estás.",
          "App de transporte si la usas en ese país (verifica placa y nombre antes de subir).",
          noche ? "De noche, evita el transporte público y espera en una zona iluminada y con gente." : "Transporte público si conoces la ruta (pregunta en información turística).",
          "Si quieres que una persona de IATOS te consiga el traslado, dilo y lo paso al equipo.",
        ],
        nota: "Opciones generales sin precios: no se reservó nada.",
      };
    }
    case "lugares_cercanos": {
      const u = (inc.payload?.ubicacion ?? {}) as { lat?: number; lng?: number };
      if (typeof u.lat !== "number" || typeof u.lng !== "number") return { ok: false, code: "SIN_UBICACION", instruccion: "Pídele que comparta su ubicación o la dirección donde está." };
      if (!d.lugares) return { ok: false, code: "NO_DISPONIBLE" };
      const tipo = ["hospital", "police", "embassy", "pharmacy", "lodging", "atm"].includes(String(a.tipo)) ? String(a.tipo) : "hospital";
      const r = await d.lugares({ lat: u.lat, lng: u.lng, tipo }, ctx.userId);
      return Array.isArray(r) ? { ok: true, fuente: "Google Places", lugares: r.slice(0, 5) } : { ok: false, ...r };
    }
    case "buscar_contacto_proveedor": {
      const nombreP = s(a.nombre, 120);
      if (!nombreP) return { ok: false, error: "falta el nombre" };
      const tipo = (TIPOS_PROVEEDOR.includes(a.tipo as TipoProveedor) ? a.tipo : "otro") as TipoProveedor;
      const encontrados: ContactoProveedor[] = [];
      if (d.contactosDeReservas) {
        for (const c of await d.contactosDeReservas(ctx.userId, inc.trip_id).catch(() => [])) {
          if (c.proveedor.toLowerCase().includes(nombreP.toLowerCase().slice(0, 12)) || nombreP.toLowerCase().includes(c.proveedor.toLowerCase().slice(0, 12))) encontrados.push(registrarContacto(ctx, c));
        }
      }
      if (!encontrados.some((c) => c.email) && d.buscarContacto) {
        const ubic = (inc.payload?.ubicacion ?? {}) as { ciudad?: string; pais?: string };
        const c = await d.buscarContacto({ nombre: nombreP, ciudad: s(a.ciudad, 80) ?? ubic.ciudad ?? null, pais: s(a.pais, 2) ?? ubic.pais ?? null, tipo }).catch(() => null);
        if (c) encontrados.push(registrarContacto(ctx, { ...c, tipo }));
      }
      // Lo que el viajero escribió en el caso también cuenta (con su fuente).
      const delViajero = [...ctx.contactos.values()].filter((c) => c.fuente.kind === "mensaje_usuario");
      if (!encontrados.length && !delViajero.length) return { ok: false, code: "SIN_CONTACTO", mensaje: "No hay un correo verificable de este proveedor. No lo adivines: pide al viajero el correo o teléfono que le dieron, o pasa el caso a una persona." };
      return { ok: true, contactos: [...encontrados, ...delViajero].map((c) => ({ contacto_id: c.id, proveedor: c.proveedor, email: c.email, telefono: c.telefono, sitio: c.sitio, zona_horaria: c.tz, fuente: c.fuente })) };
    }
    case "escribir_proveedor": {
      const c = ctx.contactos.get(String(a.contacto_id ?? ""));
      if (!c) return { ok: false, code: "CONTACTO_DESCONOCIDO", mensaje: "Usa un contacto_id devuelto por buscar_contacto_proveedor. Nunca escribas a un correo que no venga de una herramienta." };
      if (!c.email) return { ok: false, code: "SIN_CORREO", mensaje: "Ese contacto no tiene correo verificado (solo teléfono o sitio). Pide a una persona que llame, o al viajero que lo haga." };
      const asunto = s(a.asunto, 180) ?? "";
      const cuerpo = s(a.mensaje, 4000) ?? "";
      if (asunto.length < 3 || cuerpo.length < 10) return { ok: false, error: "asunto y mensaje claros" };
      const bad = revisarSaliente(ctx, `${asunto}\n${cuerpo}`);
      if (bad) return { ok: false, error: bad };
      const g = (await d.db.rpc("operator_spend", { _id: ctx.incidentId, _owner: d.owner, _kind: "correo_proveedor", _amount: 1 })).data as { ok?: boolean; code?: string } | null;
      if (!g?.ok) return { ok: false, code: g?.code ?? "CAP_CORREOS", mensaje: "Tope de correos a proveedores en este caso: pásalo a una persona." };
      const idioma = ["es", "en", "fr", "pt", "it", "de"].includes(String(a.idioma)) ? String(a.idioma) : c.idioma ?? "es";
      const viajero = d.nombreViajero ? await d.nombreViajero(ctx.userId).catch(() => null) : null;
      const v = ventanaProveedor(c.tipo, c.tz, d.ahora());
      const r = await d.db.rpc("operator_outbox_add", {
        _id: ctx.incidentId, _owner: d.owner,
        _o: { provider_name: c.proveedor, to_email: c.email, source: c.fuente, subject: asunto, body: `${cuerpo}\n\n—\n${firmaProveedor(viajero, idioma)}`,
          language: idioma, provider_tz: c.tz, send_after: v.enviarDesde.toISOString(), dedupe_key: `${c.email}:${asunto}`.slice(0, 200) },
      });
      const o = r.data as { ok?: boolean; code?: string; send_after?: string; duplicate?: boolean } | null;
      if (!o?.ok) return { ok: false, code: o?.code ?? "NO_SE_GUARDO" };
      ctx.esperando = ctx.esperando ?? "proveedor";
      return { ok: true, estado: v.enviarYa ? "sale ahora" : "programado", sale_a_las_utc: o.send_after ?? v.enviarDesde.toISOString(), hora_local_proveedor: v.horaLocal, duplicado: o.duplicate === true,
        nota: v.enviarYa ? "Su respuesta llegará al caso." : "El proveedor está fuera de horario: sale cuando abra. Díselo al viajero con la hora." };
    }
    case "escribir_viajero": {
      const texto = s(a.mensaje, 3000);
      if (!texto) return { ok: false, error: "mensaje vacío" };
      if (ctx.mensajesViajero >= MAX_MENSAJES_POR_CORRIDA) return { ok: false, error: "Ya le escribiste suficiente en esta corrida." };
      const bad = revisarSaliente(ctx, texto);
      if (bad) return { ok: false, error: bad };
      const r = await mensajeAlViajero(ctx, texto, a.urgente === true);
      return { ok: r.ok, enviado: true, canales: r.canales };
    }
    case "prometer_seguimiento": {
      const texto = s(a.siguiente_paso, 280);
      const min = Math.round(n(a.minutos) ?? 0);
      if (!texto || min < 5 || min > 1440) return { ok: false, error: "siguiente_paso y minutos entre 5 y 1440" };
      const due = new Date(d.ahora().getTime() + min * 60_000);
      const r = await setIncidentNextStep(d.db, ctx.incidentId, texto, due, "iato_ops");
      if (!r.ok) return { ok: false, code: (r as { code: string }).code };
      ctx.seguimiento = { texto, due: due.toISOString() };
      return { ok: true, hora: due.toISOString() };
    }
    case "pedir_humano": {
      const resumen = s(a.resumen, 450) ?? "El operador pide a una persona";
      const motivo = s(a.motivo, 120) ?? "duda";
      const r = await assignIncident(d.db, ctx.incidentId, { to: "humano", reason: `${motivo}: ${resumen}`.slice(0, 500) }, "iato_ops");
      if (!r.ok && (r as { code: string }).code !== "TAKEN_BY_HUMAN") return { ok: false, code: (r as { code: string }).code };
      ctx.escalado = true;
      return { ok: true, nota: "El equipo quedó avisado. Dile al viajero que una persona lo toma y cuándo." };
    }
    case "proponer_cierre": {
      const resumen = s(a.resumen, 600) ?? "";
      const r = await setIncidentStatus(d.db, ctx.incidentId, "resuelto", { actor: "iato_ops", note: resumen });
      if (!r.ok) return { ok: false, code: (r as { code: string }).code };
      ctx.cierrePropuesto = true;
      ctx.esperando = "usuario";
      return { ok: true, estado: (r as { status: string }).status, nota: "Queda esperando que el viajero confirme en la app." };
    }
    default:
      return { ok: false, error: `herramienta desconocida: ${nombre}` };
  }
}
