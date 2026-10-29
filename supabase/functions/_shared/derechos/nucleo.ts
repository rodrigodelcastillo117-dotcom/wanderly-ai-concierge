// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ADAPTADOR AL NÚCLEO DE INCIDENTES (lo conecta el coordinador)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// El núcleo (rama claude/incidentes-nucleo) expondrá en _shared/incidents.ts:
//   createIncident / addIncidentEvent / setIncidentStatus   (sobre concierge_requests type 'incidente')
// Este módulo NO importa ese archivo (puede no existir todavía): define la interfaz que necesita y un
// adaptador nulo. Para conectarlo, el coordinador crea el adaptador real en el runtime, p. ej.:
//
//   import { createIncident, addIncidentEvent, setIncidentStatus } from "../incidents.ts";
//   export const nucleoReal = (db): NucleoIncidentes => ({
//     crear: (i) => createIncident(db, { user_id: i.user_id, trip_id: i.trip_id, kind: i.tipo, title: i.titulo,
//                                        severity: i.gravedad, payload: i.datos }),
//     evento: (id, e) => addIncidentEvent(db, id, { kind: e.tipo, note: e.nota, data: e.datos }),
//     estado: (id, s, nota) => setIncidentStatus(db, id, s, nota),
//   });
//
// y lo pasa en ServiceDeps.nucleo (runtime.ts, función nucleoDesdeEntorno). Nada más cambia.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type GravedadIncidente = "baja" | "media" | "alta" | "critica";
export type EstadoIncidente = "abierto" | "en_proceso" | "esperando_proveedor" | "esperando_usuario" | "resuelto" | "cerrado";

export type NuevoIncidente = {
  user_id: string;
  trip_id?: string | null;
  /** 'reclamo_vuelo' | 'reclamo_servicio' | 'queja_iatos' | 'queja_proveedor' */
  tipo: string;
  titulo: string;
  gravedad: GravedadIncidente;
  datos: Record<string, unknown>;
};

export interface NucleoIncidentes {
  /** Devuelve el id del incidente, o null si no se pudo crear (el reclamo sigue igual). */
  crear(i: NuevoIncidente): Promise<{ id: string } | null>;
  evento(id: string, e: { tipo: string; nota: string; datos?: Record<string, unknown> }): Promise<void>;
  estado(id: string, s: EstadoIncidente, nota?: string): Promise<void>;
}

/** Sin núcleo conectado: no crea nada y lo dice (el reclamo queda en claims/claim_events). */
export const nucleoNulo: NucleoIncidentes = {
  crear: () => Promise.resolve(null),
  evento: () => Promise.resolve(),
  estado: () => Promise.resolve(),
};

/** Estado del incidente que corresponde a cada estado del reclamo. */
export function estadoIncidenteDe(estadoReclamo: string): EstadoIncidente {
  switch (estadoReclamo) {
    case "borrador": case "esperando_ok": return "abierto";
    case "enviado": case "recordado": return "esperando_proveedor";
    case "respondido": case "escalable": case "escalado": return "en_proceso";
    case "necesita_usuario": return "esperando_usuario";
    case "resuelto": return "resuelto";
    default: return "cerrado";
  }
}
