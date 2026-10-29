// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ADAPTADOR REAL: reclamos y quejas (derechos) → núcleo de incidentes (_shared/incidents.ts).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Una queja o un reclamo abre su caso (o se suma al que ya existe) y el caso registra cada paso del reclamo
// en su bitácora: preparado, enviado, respuesta del proveedor, plazo vencido, escalado, resuelto.
//
// Sin duplicados con Iato: Iato abre el caso con la clave `iato:<usuario>:<categoría>:<día>` (detección antes
// del modelo); aquí se usa LA MISMA clave, así que "mi vuelo se canceló" + "prepara el reclamo" en el mismo
// día quedan en un solo caso. Si quien llama ya sabe cuál es el caso (el operador IA trabajando un incidente),
// lo pasa en `casoActual` y no se crea nada: solo se anota.
// Puro (sin Deno): probado en src/test/operadorIntegracion.test.ts.
import {
  addIncidentEvent, createIncident, type IncidentCategory, type IncidentDb, type IncidentEventInput, isIncidentCategory, setIncidentStatus,
} from "../incidents.ts";
import type { EstadoIncidente, NucleoIncidentes, NuevoIncidente } from "./nucleo.ts";

export type OpcionesNucleo = {
  /** Caso que ya se está atendiendo (el operador): los reclamos se anotan ahí, no abren otro. */
  casoActual?: string | null;
  /** YYYY-MM-DD de hoy (clave por día, igual que Iato). */
  hoy?: () => string;
  /** Quién abrió: Iato (chat) o el usuario desde la app (función reclamos). */
  origen?: "iato" | "usuario";
  warn?: (...a: unknown[]) => void;
};

const EVENTO_A_CATEGORIA: Record<string, IncidentCategory> = {
  cancelacion: "vuelo_cancelado", retraso: "vuelo_retrasado", sobreventa: "overbooking", conexion_perdida: "conexion_perdida",
  clase_inferior: "reserva_problema", equipaje_perdido: "equipaje", equipaje_danado: "equipaje", equipaje_retrasado: "equipaje",
};

/** Categoría del incidente para un reclamo o queja (la da servicio.ts; si no, se deduce del tipo). */
export function categoriaDeReclamo(i: Pick<NuevoIncidente, "tipo" | "categoria" | "datos">): IncidentCategory {
  if (isIncidentCategory(i.categoria)) return i.categoria;
  const d = (i.datos ?? {}) as Record<string, unknown>;
  if (i.tipo === "queja_iatos" || i.tipo === "queja_proveedor") return "queja";
  if (i.tipo === "reclamo_vuelo") return EVENTO_A_CATEGORIA[String(d.evento ?? "")] ?? "vuelo_retrasado";
  if (i.tipo === "reclamo_servicio") {
    const problema = String(d.problema ?? "");
    const tipo = String(d.tipo_proveedor ?? "");
    if (problema === "cobro_doble") return "cobro_reembolso";
    if (tipo === "traslado" && problema === "servicio_no_prestado") return "traslado_no_llego";
    if (tipo === "hotel") return "hotel_problema";
    return "reserva_problema";
  }
  return "otro";
}

/** Misma clave que usa Iato al abrir el caso por detección (concierge-chat/incident.ts keyFor). */
export const claveCaso = (userId: string, categoria: string, hoy: string) => `iato:${userId}:${categoria}:${hoy}`;

type EventoReclamo = { kind: IncidentEventInput["kind"]; actor: IncidentEventInput["actor"]; channel?: IncidentEventInput["channel"]; direction?: IncidentEventInput["direction"] };
const EVENTO_RECLAMO: Record<string, EventoReclamo> = {
  reclamo_preparado: { kind: "accion", actor: "iato" },
  reclamo_enviado: { kind: "accion", actor: "sistema", channel: "email", direction: "saliente" },
  respuesta_proveedor: { kind: "mensaje", actor: "proveedor", channel: "email", direction: "entrante" },
  plazo_vencido: { kind: "accion", actor: "sistema" },
  reclamo_escalado: { kind: "accion", actor: "sistema", direction: "saliente" },
};

export function nucleoSobreIncidentes(db: IncidentDb, o: OpcionesNucleo = {}): NucleoIncidentes {
  const hoy = o.hoy ?? (() => new Date().toISOString().slice(0, 10));
  const warn = o.warn ?? (() => {});
  const anota = async (id: string, tipo: string, nota: string, datos?: Record<string, unknown>) => {
    const m = EVENTO_RECLAMO[tipo] ?? { kind: "accion" as const, actor: "sistema" as const };
    const r = await addIncidentEvent(db, id, {
      kind: m.kind, actor: m.actor, channel: m.channel ?? null, direction: m.direction ?? "interno", body: nota.slice(0, 4000),
      data: { reclamo_evento: tipo, ...(datos ?? {}) },
    });
    if (!r.ok) warn("derechos→incidentes: no se anotó en la bitácora", tipo, (r as { code: string }).code);
  };
  return {
    async crear(i) {
      const categoria = categoriaDeReclamo(i);
      const resumen = `${i.titulo}${i.datos?.ref ? ` · folio ${i.datos.ref}` : ""}`.slice(0, 400);
      if (o.casoActual) {
        await anota(o.casoActual, "reclamo_preparado", resumen, { ...i.datos, tipo: i.tipo });
        return { id: o.casoActual };
      }
      const esQueja = categoria === "queja";
      const r = await createIncident(db, {
        userId: i.user_id, categoria, descripcion: i.titulo, origen: o.origen ?? "iato", canal: o.origen === "usuario" ? "app" : "iato",
        severidad: i.gravedad, idempotencyKey: claveCaso(i.user_id, categoria, hoy()), tripId: i.trip_id ?? null,
        queja: esQueja ? { subtipo: i.tipo === "queja_iatos" ? "servicio_iatos" : "proveedor" } : null,
        accionesTomadas: [esQueja ? "Iato registró la queja" : "Iato preparó la reclamación formal"],
      });
      if (!r.ok) { warn("derechos→incidentes: no se abrió el caso", (r as { code: string }).code); return null; }
      await anota(r.id, esQueja ? "queja_registrada" : "reclamo_preparado", resumen, { ...i.datos, tipo: i.tipo });
      return { id: r.id };
    },
    async evento(id, e) {
      await anota(id, e.tipo, e.nota, e.datos);
    },
    async estado(id, s: EstadoIncidente, nota) {
      await anota(id, `estado_${s}`, nota ? `Reclamo: ${s.replace(/_/g, " ")} · ${nota}` : `Reclamo: ${s.replace(/_/g, " ")}`);
      if (s === "resuelto") {
        // El sistema no cierra un caso: queda "esperando confirmación" y se le pregunta al viajero.
        await setIncidentStatus(db, id, "resuelto", { actor: "sistema", note: nota ?? "El reclamo quedó resuelto" });
      } else if (s === "en_proceso" || s === "esperando_proveedor" || s === "esperando_usuario") {
        await setIncidentStatus(db, id, "en_proceso", { actor: "sistema" });
      }
    },
  };
}
