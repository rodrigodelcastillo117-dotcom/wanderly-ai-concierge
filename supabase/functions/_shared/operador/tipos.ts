// Operador IATOS · tipos compartidos (sin Deno). El operador recibe TODO por parámetro (base, modelo, canales,
// búsquedas): así se prueba de punta a punta con dobles (src/test/operador*.test.ts) y se corre con IA real a mano.
import type { IncidentDb } from "../incidents.ts";
import type { ReclamosDeps } from "../derechos/servicio.ts";
import type { ChannelSendResult } from "../channels/types.ts";
import type { TipoProveedor } from "./politica.ts";

/** Llamada al modelo (Messages API). Devuelve la respuesta cruda; null en data = falló. */
export type ModeloOperador = (payload: Record<string, unknown>) => Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }>;

export type EventoCaso = {
  id: number; at: string; kind: string; actor: string; channel?: string | null; direction?: string | null; counterpart?: string | null;
  body?: string | null; visible?: boolean; data?: Record<string, unknown> | null;
};

export type IncidenteCaso = {
  id: string; user_id: string; trip_id: string | null; title: string; payload: Record<string, unknown>; category: string; severity: string;
  origin: string; escalation_level: number; received_at: string; next_step: string | null; next_step_due_at: string | null; reopen_count: number;
};

export type EstadoCaso = {
  state: string; last_event_id: number; runs: number; actions: number; spend_usd: number; flight_searches: number; provider_emails: number;
  consents: Record<string, { event_id: number; at: string }>; pending: Record<string, unknown> | null; summary: string | null;
  follow_up_at: string | null; last_run_at: string | null;
};

export type LimitesCaso = { max_actions: number; max_spend_usd: number; max_flight_searches: number; max_provider_emails: number; lock_seconds: number };

export type CasoTomado = { ok: true; case: EstadoCaso; limits: LimitesCaso; incident: IncidenteCaso; events: EventoCaso[] };

/** Contacto de un proveedor que el operador PUEDE usar: siempre con su fuente. */
export type ContactoProveedor = {
  id: string; proveedor: string; tipo: TipoProveedor; email: string | null; telefono: string | null; sitio: string | null; tz: string | null;
  idioma: string | null;
  fuente: { kind: "sitio_oficial" | "directorio" | "reserva" | "correo_del_proveedor" | "mensaje_usuario"; url?: string | null; event_id?: string | null; booking?: string | null; quote?: string | null };
};

export type LugarCercano = { nombre: string; direccion: string | null; telefono: string | null; mapa: string | null; distancia_m?: number | null; abierto?: boolean | null };

export interface OperadorDeps {
  /** Base con la llave de servicio (incident_* y operator_*). */
  db: IncidentDb;
  /** null = sin IA disponible: el operador pasa el caso a una persona (no se queda callado). */
  modelo: ModeloOperador | null;
  /** Nombre del modelo principal (para calcular el gasto si la respuesta no lo trae). */
  modeloNombre: string;
  ahora: () => Date;
  /** Identificador de esta corrida (candado). */
  owner: string;
  /** "Ver todo": lectura de los datos del viajero filtrada por su user_id (solo con su permiso). */
  verTodo?: (userId: string, tripId: string | null, alcance: string[] | null) => Promise<unknown>;
  /** Reclamos con el núcleo atado a ESTE caso (casoActual): preparar y enviar. */
  reclamos?: (incidentId: string) => ReclamosDeps | null;
  /** Avisar al viajero fuera de la app (push + su canal vinculado; correo de respaldo). */
  avisarViajero?: (userId: string, m: { titulo: string; texto: string; url: string; urgente: boolean }, incidentId: string) => Promise<ChannelSendResult[]>;
  /** Estado del vuelo desde la caché (sin búsqueda de pago). */
  estadoVuelo?: (vuelo: string, fecha: string | null, userId: string) => Promise<unknown>;
  /** Búsqueda de vuelos alternativos (caché compartida y cupo del usuario). Una por caso: la base lo hace cumplir. */
  buscarVuelos?: (q: { origen: string; destino: string; fecha: string; pasajeros: number }, userId: string) => Promise<unknown>;
  /** Lugares cercanos (hospital, policía, embajada, farmacia, hotel, cajero). */
  lugares?: (q: { lat: number; lng: number; tipo: string }, userId: string) => Promise<LugarCercano[] | { error: string }>;
  /** Contacto oficial de un proveedor (sitio oficial, Google Places, directorio): nunca adivina un correo. */
  buscarContacto?: (q: { nombre: string; ciudad: string | null; pais: string | null; tipo: TipoProveedor }) => Promise<Omit<ContactoProveedor, "id"> | null>;
  /** Contactos que ya vienen de las reservas del viajero (bookings con correo del proveedor). */
  contactosDeReservas?: (userId: string, tripId: string | null) => Promise<Array<Omit<ContactoProveedor, "id">>>;
  /** Nombre del viajero (para la firma al proveedor). */
  nombreViajero?: (userId: string) => Promise<string | null>;
  /** Despierta al operador para otro caso (se usa tras abrir incidentes por canal). */
  warn?: (...a: unknown[]) => void;
}

export type ResultadoCorrida = {
  ok: boolean;
  incidentId: string;
  /** Qué pasó: trabajó, no había nada, otro lo tiene, apagado, pasó a humano… */
  resultado: "trabajado" | "nada_nuevo" | "ocupado" | "apagado" | "no_es_mio" | "detenido" | "a_humano" | "error";
  acciones: string[];
  gastoUsd: number;
  escalado: boolean;
  mensajesAlViajero: number;
  error?: string;
};
