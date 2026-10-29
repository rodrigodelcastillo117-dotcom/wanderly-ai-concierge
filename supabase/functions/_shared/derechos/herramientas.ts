// Herramientas del motor de derechos para Iato (concierge-chat) y para el operador (Mesa de operaciones).
// Formato neutral (mismo que concierge-chat/toolDefs.ts: name, description, input_schema plano) y un
// ejecutor único con dependencias inyectadas. Sin Deno: probado en src/test/derechosHerramientas.test.ts.
//
// Consentimiento para ENVIAR: no basta con que el modelo lo pida. enviar_reclamo solo procede si el
// ÚLTIMO mensaje del usuario contiene el folio del reclamo (C-XXXXXX) y una afirmación explícita, y no
// una negación. El ejecutor lo comprueba con el texto real del usuario, no con lo que diga el modelo.
import { type CasoVuelo, evaluarVuelo, type TipoEvento } from "./motor.ts";
import { evaluarServicio, type ProblemaServicio, type TipoServicio } from "./servicios.ts";
import { type Lector, verTodo } from "./contexto.ts";
import {
  confirmarEnvio, estadoReclamos, escalarReclamo, marcarEnviadoPorUsuario, prepararReclamoServicio, prepararReclamoVuelo, type ReclamosDeps,
  registrarQueja, resolverReclamo,
} from "./servicio.ts";

type Schema = { type?: string; description?: string; enum?: readonly string[]; items?: Schema; properties?: Record<string, Schema>; required?: readonly string[] };
export type ToolDefNeutral = { name: string; description: string; input_schema: Schema & { type: "object"; properties: Record<string, Schema> } };

const EVENTOS: TipoEvento[] = ["retraso", "cancelacion", "sobreventa", "conexion_perdida", "clase_inferior", "equipaje_perdido", "equipaje_danado", "equipaje_retrasado"];
const PROBLEMAS: ProblemaServicio[] = ["cobro_doble", "servicio_no_prestado", "sobreventa_hotel", "servicio_deficiente", "reserva_no_encontrada"];

const CAMPOS_VUELO: Record<string, Schema> = {
  evento: { type: "string", enum: EVENTOS, description: "Qué pasó con el vuelo o el equipaje" },
  origen: { type: "string", description: "IATA de salida del vuelo afectado, ej. MAD" },
  destino: { type: "string", description: "IATA de llegada del vuelo afectado, ej. MEX" },
  destino_final: { type: "string", description: "IATA del destino final si había conexión (opcional)" },
  pais_origen: { type: "string", description: "ISO2 del país de salida si el aeropuerto es poco conocido (opcional)" },
  pais_destino: { type: "string", description: "ISO2 del país de llegada si el aeropuerto es poco conocido (opcional)" },
  aerolinea: { type: "string", description: "Aerolínea que OPERÓ el vuelo: nombre, código (IB) o número de vuelo (IB6403)" },
  vuelo: { type: "string", description: "Número de vuelo, ej. IB6403 (opcional)" },
  fecha: { type: "string", description: "Fecha programada YYYY-MM-DD (opcional)" },
  horas_retraso_llegada: { type: "number", description: "Horas de retraso con que LLEGÓ al destino final (clave en UE, Canadá y EE. UU.)" },
  horas_retraso_salida: { type: "number", description: "Horas de retraso a la SALIDA (clave en México y para la asistencia)" },
  aviso_dias: { type: "number", description: "Con cuántos días de anticipación avisaron la cancelación" },
  reubicacion_ofrecida: { type: "boolean", description: "¿Le ofrecieron otro vuelo?" },
  reubicacion_sale_antes_horas: { type: "number", description: "Cuántas horas ANTES de la hora original salía el vuelo ofrecido" },
  reubicacion_llega_despues_horas: { type: "number", description: "Cuántas horas DESPUÉS de la hora original llegaba el vuelo ofrecido" },
  motivo: { type: "string", description: "Motivo que dio la aerolínea, tal cual" },
  precio: { type: "number", description: "Precio pagado del boleto (opcional)" },
  moneda: { type: "string", description: "Moneda del precio, ISO 4217 (MXN, USD, EUR…)" },
  voluntario: { type: "boolean", description: "Sobreventa: ¿cedió su lugar voluntariamente?" },
  pernocta: { type: "boolean", description: "¿Tuvo que pasar la noche?" },
  equipaje_de_mano: { type: "boolean", description: "Equipaje: ¿era de mano (no facturado)?" },
  dias_desde_recibido: { type: "number", description: "Equipaje dañado: días desde que le entregaron la maleta" },
};

export const RECLAMOS_TOOL_DEFS: ToolDefNeutral[] = [
  {
    name: "revisar_derechos_vuelo",
    description:
      "Derechos del pasajero por retraso, cancelación, sobreventa, conexión perdida, clase inferior o equipaje, con la ley que aplica " +
      "(México LAC, UE 261/2004, UK261, DOT de EE. UU., APPR de Canadá, ANAC 400 de Brasil, Convenio de Montreal), monto, certeza, fuente oficial, " +
      "pruebas que guardar, qué hacer ahora y a quién reclamar. Sin red, al instante. Úsala SIEMPRE antes de decir qué le corresponde a alguien; " +
      "di la certeza tal cual (te corresponde / probablemente / depende de…) y nunca prometas un pago.",
    input_schema: { type: "object", properties: CAMPOS_VUELO, required: ["evento", "origen", "destino", "aerolinea"] },
  },
  {
    name: "revisar_derechos_servicio",
    description: "Derechos ante un hotel, traslado, tour o agencia: cobro doble, servicio no prestado, sobreventa del hotel, reserva no encontrada o servicio deficiente. " +
      "Da la ruta proveedor → banco (aclaración/contracargo) → PROFECO con plazos y fuente.",
    input_schema: {
      type: "object",
      properties: {
        problema: { type: "string", enum: PROBLEMAS },
        proveedor: { type: "string", description: "Nombre del hotel, empresa de traslado o agencia" },
        tipo_proveedor: { type: "string", enum: ["hotel", "traslado", "agencia", "tour", "otro"] },
        pais_proveedor: { type: "string", description: "ISO2 del país del proveedor (MX por defecto)" },
        monto_pagado: { type: "number" }, monto_cobrado_de_mas: { type: "number" }, moneda: { type: "string" },
        pagado_con: { type: "string", enum: ["tarjeta_credito", "tarjeta_debito", "efectivo", "transferencia", "plataforma"] },
        fecha_cargo: { type: "string", description: "YYYY-MM-DD del cargo" },
      },
      required: ["problema", "proveedor", "tipo_proveedor"],
    },
  },
  {
    name: "preparar_reclamo",
    description:
      "Prepara la reclamación formal (carta en el idioma del proveedor, con hechos, fundamento legal, monto pedido y plazo) y la guarda como caso. " +
      "NO envía nada. Devuelve el texto, a quién va y el folio C-XXXXXX. Si el proveedor solo tiene formulario, el texto es para pegarlo ahí. " +
      "Después muéstrale al usuario a quién va y pídele que, si quiere que lo enviemos, conteste con el folio, p. ej. «Sí, envía C-ABC123».",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["vuelo", "servicio"] },
        ...CAMPOS_VUELO,
        evento: { type: "string", enum: EVENTOS, description: "Solo vuelos" },
        problema: { type: "string", enum: PROBLEMAS, description: "Solo servicios" },
        proveedor: { type: "string", description: "Solo servicios: nombre del hotel/traslado/agencia" },
        tipo_proveedor: { type: "string", enum: ["hotel", "traslado", "agencia", "tour", "otro"] },
        pais_proveedor: { type: "string" },
        correo_proveedor: { type: "string", description: "Correo del proveedor SOLO si el usuario lo dio o venía en su reserva/correo del proveedor. Nunca lo adivines." },
        fuente_correo: { type: "string", enum: ["correo_del_proveedor", "reserva", "usuario_confirmado"] },
        monto_pagado: { type: "number" }, monto_cobrado_de_mas: { type: "number" },
        pagado_con: { type: "string", enum: ["tarjeta_credito", "tarjeta_debito", "efectivo", "transferencia", "plataforma"] },
        nombre_pasajero: { type: "string" }, reserva: { type: "string", description: "Código de reserva" }, boleto: { type: "string" },
        relato: { type: "string", description: "Lo que pasó, con las palabras del usuario (opcional)" },
        eleccion: { type: "string", enum: ["reembolso", "reubicacion"], description: "Si el usuario eligió reembolso o vuelo alternativo" },
        trip_id: { type: "string" },
      },
      required: ["tipo"],
    },
  },
  {
    name: "enviar_reclamo",
    description:
      "Envía por correo un reclamo ya preparado, en nombre del usuario. Úsala SOLO cuando el usuario, en su último mensaje, autorizó " +
      "explícitamente el envío escribiendo el folio (C-XXXXXX). Si no, no la llames: pregunta.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "id del reclamo" }, folio: { type: "string", description: "C-XXXXXX" }, copia_al_usuario: { type: "boolean" } },
      required: ["id", "folio"],
    },
  },
  {
    name: "seguimiento_reclamo",
    description: "Estado de los reclamos del usuario, su dirección personal para reenviar correos, y acciones: marcar que él mismo lo envió por formulario, " +
      "escalar al organismo (PROFECO, autoridad UE, DOT…) con la carta lista, o marcarlo resuelto.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["estado", "ya_lo_envie", "escalar", "resuelto"] },
        id: { type: "string" }, numero_caso: { type: "string", description: "Número de caso que le dio el proveedor (opcional)" },
      },
      required: ["accion"],
    },
  },
  {
    name: "registrar_queja",
    description: "Registra una queja del viajero contra IATOS o contra un proveedor: la clasifica (qué pasó, qué espera, gravedad, sentimiento), " +
      "abre el caso para el equipo humano y devuelve una respuesta empática y concreta. Úsala cuando el usuario se queja, aunque no lo pida.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" }, contra: { type: "string", enum: ["iatos", "proveedor"] }, proveedor: { type: "string" }, trip_id: { type: "string" } },
      required: ["texto"],
    },
  },
  {
    name: "ver_mi_viaje",
    description:
      "Lee, con la sesión del usuario, su viaje, vuelos, reservas, documentos de la Bóveda (números enmascarados), gastos, conversaciones, " +
      "correos que reenvió y reclamos. Requiere su permiso explícito: pon permiso=true SOLO si en esta conversación dijo que sí; si no, " +
      "la herramienta devuelve la pregunta que debes hacerle.",
    input_schema: {
      type: "object",
      properties: {
        permiso: { type: "boolean" },
        alcance: { type: "array", items: { type: "string", enum: ["viaje", "vuelos", "reservas", "boveda", "gastos", "conversaciones", "correos", "reclamos"] } },
        trip_id: { type: "string" },
      },
      required: ["permiso"],
    },
  },
];

/** Herramientas del operador (equipo IATOS): solo administradores; usan la sesión del administrador. */
export const OPERADOR_TOOL_DEFS: ToolDefNeutral[] = [
  { name: "operador_listar_reclamos", description: "Lista los reclamos de todos los usuarios (solo administradores).", input_schema: { type: "object", properties: { estado: { type: "string" } } } },
  { name: "operador_ver_reclamo", description: "Detalle de un reclamo: carta, historial y correos reenviados ligados al caso (solo administradores).", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  ...RECLAMOS_TOOL_DEFS.filter((t) => t.name === "revisar_derechos_vuelo" || t.name === "revisar_derechos_servicio"),
];

export const RECLAMOS_TOOL_NAMES = RECLAMOS_TOOL_DEFS.map((t) => t.name);

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const b = (v: unknown) => (typeof v === "boolean" ? v : null);

export function casoDesdeArgs(a: Record<string, unknown>, hoy?: string | null): CasoVuelo {
  const precio = n(a.precio);
  const ofrecida = b(a.reubicacion_ofrecida);
  return {
    evento: (EVENTOS.includes(a.evento as TipoEvento) ? a.evento : "retraso") as TipoEvento,
    origen: s(a.origen, 3) ?? "", destino: s(a.destino, 3) ?? "", destino_final: s(a.destino_final, 3),
    pais_origen: s(a.pais_origen, 2), pais_destino: s(a.pais_destino, 2),
    aerolinea: s(a.aerolinea, 60) ?? "", vuelo: s(a.vuelo, 12), fecha: s(a.fecha, 10),
    horas_retraso_llegada: n(a.horas_retraso_llegada), horas_retraso_salida: n(a.horas_retraso_salida), aviso_dias: n(a.aviso_dias),
    reubicacion: ofrecida === null ? null : { ofrecida, sale_antes_horas: n(a.reubicacion_sale_antes_horas), llega_despues_horas: n(a.reubicacion_llega_despues_horas) },
    motivo: s(a.motivo, 300), precio: precio && precio > 0 ? { monto: precio, moneda: (s(a.moneda, 3) ?? "MXN").toUpperCase() } : null,
    voluntario: b(a.voluntario), pernocta: b(a.pernocta),
    equipaje: { de_mano: b(a.equipaje_de_mano), dias_desde_recibido: n(a.dias_desde_recibido) },
    hoy: hoy ?? null,
  };
}

/** ¿El texto del usuario autoriza el envío del folio? Afirmación explícita + folio, sin negación. */
export function autorizaEnvio(textoUsuario: string | null | undefined, folio: string): boolean {
  const t = String(textoUsuario ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const f = String(folio ?? "").toLowerCase();
  if (!/^c-[a-z0-9]{6}$/.test(f) || !t.includes(f)) return false;
  if (/\b(no|todavia no|aun no|espera|cancela|no lo envies|no envies)\b/.test(t)) return false;
  return /\b(si|envia|envialo|enviala|mandalo|mandala|manda|adelante|autorizo|de acuerdo|ok|okay|confirmo|dale)\b/.test(t);
}

export type ContextoHerramienta = {
  userId: string;
  /** Cliente con la sesión del usuario (RLS). */
  lector: Lector & { rpc?(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
  /** Dependencias del servicio (llave de servicio solo dentro de las RPC del servidor). null = sin base. */
  deps: ReclamosDeps | null;
  /** Último mensaje del usuario, tal cual (para comprobar el consentimiento). */
  ultimoMensajeUsuario?: string | null;
  hoy?: string | null;
};

export async function runReclamosTool(name: string, a: Record<string, unknown>, ctx: ContextoHerramienta): Promise<unknown> {
  switch (name) {
    case "revisar_derechos_vuelo": {
      const e = evaluarVuelo(casoDesdeArgs(a, ctx.hoy));
      return {
        resumen: e.resumen, regimenes: e.regimenes, derechos: e.derechos, principal: e.principal, pruebas: e.pruebas, ahora: e.ahora,
        reclamar: e.reclamar, plazos: e.plazos, avisos: e.avisos, distancia_km: e.ruta.distancia_km,
        instrucciones: "Di primero lo que te corresponde con su certeza; luego qué hacer ahora y las pruebas; cita la ley. Ofrece preparar la reclamación.",
      };
    }
    case "revisar_derechos_servicio": {
      const ev = evaluarServicio({
        problema: (PROBLEMAS.includes(a.problema as ProblemaServicio) ? a.problema : "servicio_deficiente") as ProblemaServicio,
        proveedor: { nombre: s(a.proveedor) ?? "el proveedor", tipo: (s(a.tipo_proveedor) ?? "otro") as TipoServicio, pais: s(a.pais_proveedor, 2) },
        monto_pagado: n(a.monto_pagado), monto_cobrado_de_mas: n(a.monto_cobrado_de_mas), moneda: s(a.moneda, 3),
        pagado_con: (s(a.pagado_con) as never) ?? null, fecha_cargo: s(a.fecha_cargo, 10), hoy: ctx.hoy ?? null,
      });
      return ev;
    }
    case "preparar_reclamo": {
      if (!ctx.deps) return { error: "reclamos_no_disponible" };
      const pasajero = { nombre: s(a.nombre_pasajero, 120) ?? undefined, reserva: s(a.reserva, 20), boleto: s(a.boleto, 20) };
      const correo = s(a.correo_proveedor, 200);
      const fuente = s(a.fuente_correo) as "correo_del_proveedor" | "reserva" | "usuario_confirmado" | null;
      if (a.tipo === "servicio") {
        const r = await prepararReclamoServicio(ctx.deps, ctx.userId, {
          caso: {
            problema: (PROBLEMAS.includes(a.problema as ProblemaServicio) ? a.problema : "servicio_deficiente") as ProblemaServicio,
            proveedor: { nombre: s(a.proveedor) ?? "", tipo: (s(a.tipo_proveedor) ?? "otro") as TipoServicio, pais: s(a.pais_proveedor, 2), correo, correo_fuente: correo && fuente ? fuente : null },
            monto_pagado: n(a.monto_pagado), monto_cobrado_de_mas: n(a.monto_cobrado_de_mas), moneda: s(a.moneda, 3), pagado_con: (s(a.pagado_con) as never) ?? null,
            reserva: s(a.reserva, 40), relato: s(a.relato, 1500),
          },
          pasajero, trip_id: s(a.trip_id, 40), actor: "iato",
        });
        return r.body;
      }
      const r = await prepararReclamoVuelo(ctx.deps, ctx.userId, {
        caso: casoDesdeArgs(a, ctx.hoy), pasajero, relato: s(a.relato, 1500), eleccion: (s(a.eleccion) as never) ?? null, trip_id: s(a.trip_id, 40),
        correo_proveedor: correo && fuente ? { email: correo, fuente } : null, actor: "iato",
      });
      return r.body;
    }
    case "enviar_reclamo": {
      if (!ctx.deps) return { error: "reclamos_no_disponible" };
      const folio = s(a.folio, 10) ?? "";
      if (!autorizaEnvio(ctx.ultimoMensajeUsuario, folio)) {
        return { ok: false, code: "CONSENT_REQUIRED", message: `No envío nada sin tu autorización explícita. Si quieres que lo envíe, escribe: «Sí, envía ${folio || "el folio"}».` };
      }
      const r = await confirmarEnvio(ctx.deps, ctx.userId, { id: s(a.id, 40) ?? undefined, confirm: true, confirm_text: String(ctx.ultimoMensajeUsuario ?? "").slice(0, 300), cc_me: a.copia_al_usuario === true });
      return r.body;
    }
    case "seguimiento_reclamo": {
      if (!ctx.deps) return { error: "reclamos_no_disponible" };
      const id = s(a.id, 40) ?? undefined;
      const r = a.accion === "ya_lo_envie" ? await marcarEnviadoPorUsuario(ctx.deps, ctx.userId, { id, numero_caso: s(a.numero_caso, 60) })
        : a.accion === "escalar" ? await escalarReclamo(ctx.deps, ctx.userId, { id })
        : a.accion === "resuelto" ? await resolverReclamo(ctx.deps, ctx.userId, { id })
        : await estadoReclamos(ctx.deps, ctx.userId, { id: id ?? null });
      return r.body;
    }
    case "registrar_queja": {
      if (!ctx.deps) return { error: "reclamos_no_disponible" };
      const r = await registrarQueja(ctx.deps, ctx.userId, { texto: s(a.texto, 4000) ?? "", contra: (s(a.contra) as never) ?? null, proveedor: s(a.proveedor), trip_id: s(a.trip_id, 40) });
      return r.body;
    }
    case "ver_mi_viaje":
      return verTodo(ctx.lector, ctx.userId, { permiso: a.permiso === true, alcance: Array.isArray(a.alcance) ? a.alcance.map(String) : null, trip_id: s(a.trip_id, 40) });
    case "operador_listar_reclamos": {
      if (!ctx.lector.rpc) return { error: "no_disponible" };
      const r = await ctx.lector.rpc("admin_claims_list", { _status: s(a.estado, 30), _limit: 100 });
      return r.error ? { error: "solo_administradores" } : { reclamos: r.data };
    }
    case "operador_ver_reclamo": {
      if (!ctx.lector.rpc) return { error: "no_disponible" };
      const r = await ctx.lector.rpc("admin_claim_view", { _id: s(a.id, 40) });
      return r.error ? { error: "solo_administradores" } : r.data;
    }
    default:
      return { error: `herramienta desconocida: ${name}` };
  }
}
