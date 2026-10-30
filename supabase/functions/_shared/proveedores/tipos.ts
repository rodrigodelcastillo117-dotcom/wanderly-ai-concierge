// Proveedores con reserva "en la mano" (IATOS tiene el localizador y la API para consultarla, cancelarla o
// cambiarla). Interfaz común para todos los adaptadores (RateHawk, Viator, traslados). Puro (sin Deno): cada
// adaptador recibe su fetch y sus secretos por parámetro y se prueba con respuestas grabadas de la documentación
// oficial (src/test/fixtures/proveedores/).
//
// Reglas que comparten todos:
//   · nunca se reserva, cancela ni cambia en PRODUCCIÓN sin la bandera proveedores_reservas_enabled (seguridad.ts);
//   · sin secretos el adaptador queda apagado y lo dice (code SIN_CONFIGURAR), no falla en silencio;
//   · lo que no se pudo verificar en documentación pública queda NO_VERIFICADO y no llama a nadie;
//   · un precio, una política o un estado solo salen de la respuesta del proveedor, con su fuente.

export type ProductoGestionado = "hotel" | "vuelo" | "traslado" | "tour" | "seguro";
export type Entorno = "sandbox" | "produccion";
export type EstadoGestionado = "pendiente" | "confirmada" | "cancelada" | "fallida" | "rechazada" | "completada" | "no_show";

export type FallaProveedor = {
  ok: false;
  code:
    | "SIN_CONFIGURAR" // faltan secretos
    | "NO_VERIFICADO" // no hay documentación pública verificable: solo interfaz
    | "NO_SOPORTADO" // el proveedor no lo permite por API (se hace con una persona)
    | "NIVEL_INSUFICIENTE" // la llave no tiene el nivel de acceso (p. ej. Viator Basic)
    | "BLOQUEADO_PRODUCCION" // escribir en producción sin la bandera
    | "ENTRADA_INVALIDA"
    | "NO_ENCONTRADA"
    | "NO_CANCELABLE"
    | "PROVEEDOR_ERROR"
    | "TIEMPO_AGOTADO";
  motivo: string;
  http?: number;
  detalle?: string | null;
};
export type Resultado<T> = ({ ok: true } & T) | FallaProveedor;

/** Política normalizada (lo que dijo el proveedor, con su fuente). */
export type Politicas = {
  cancelable: boolean;
  /** Hasta cuándo se cancela sin cargo (ISO, UTC) según el proveedor; null = no hay periodo gratis o no se sabe. */
  gratis_hasta: string | null;
  /** Penalización si se cancela ahora (moneda del proveedor). null = no se sabe. */
  penalizacion_actual: number | null;
  /** Tramos de penalización tal cual los da el proveedor. */
  tramos: Array<{ desde: string | null; hasta: string | null; monto: number | null; moneda: string | null }>;
  cambiable: boolean;
  /** Cómo se hace un cambio: por API, o cancelar y reservar de nuevo (con una persona). */
  como_cambiar: "api" | "cancelar_y_reservar" | "con_el_proveedor";
  moneda: string | null;
  fuente: string;
};

export type Oferta = {
  proveedor: string;
  producto: ProductoGestionado;
  id_oferta: string; // book_hash, productCode+opción, etc.
  titulo: string;
  neto: number | null;
  venta_sugerida: number | null;
  comision: number | null;
  moneda: string | null;
  politicas: Politicas | null;
  fuente: string;
  consultado_at: string;
  extra?: Record<string, unknown>;
};

export type ReservaProveedor = {
  proveedor: string;
  entorno: Entorno;
  producto: ProductoGestionado;
  /** Id con el que se consulta/cancela por API. */
  id_proveedor: string;
  /** Localizador que ve el viajero (confirmación del hotel, BR-…). */
  localizador: string | null;
  partner_order_id: string | null;
  estado: EstadoGestionado;
  estado_proveedor: string;
  politicas: Politicas | null;
  neto: number | null;
  venta: number | null;
  comision: number | null;
  moneda: string | null;
  inicio: string | null;
  fin: string | null;
  titulo: string | null;
  fuente: string;
};

export type Huesped = { nombre: string; apellido: string; nino?: boolean; edad?: number };

export type SolicitudReserva = {
  id_oferta: string;
  /** Id propio de IATOS para la orden (idempotencia con el proveedor). */
  partner_order_id: string;
  huespedes: Huesped[];
  contacto: { email: string; telefono: string };
  /** Precio que paga el viajero (venta B2B2C) si aplica. */
  venta?: number | null;
  ip_usuario?: string | null;
  /** Viator con formulario de pago de Viator: token que devuelve su iFrame. Sin él no se reserva. */
  token_pago?: string | null;
};

export type ContextoEscritura = {
  /** Bandera app_flags.proveedores_reservas_enabled. */
  reservasRealesPermitidas: boolean;
};

export type WebhookProveedor = {
  /** El webhook es auténtico (firma verificada). */
  autentico: boolean;
  motivo?: string;
  /** Id de la orden (partner_order_id o booking ref). */
  id?: string;
  estado_proveedor?: string;
  /** Token de un solo uso (protección contra repetición). */
  token?: string;
};

export interface AdaptadorProveedor {
  id: "ratehawk" | "viator" | "traslados";
  producto: ProductoGestionado;
  /** true solo si cada llamada salió de documentación oficial pública revisada. */
  verificado: boolean;
  documentacion: string[];
  entorno: Entorno;
  configurado: boolean;
  buscar(q: Record<string, unknown>): Promise<Resultado<{ ofertas: Oferta[] }>>;
  cotizar(idOferta: string): Promise<Resultado<{ oferta: Oferta; cambio_precio: boolean }>>;
  reservar(s: SolicitudReserva, ctx: ContextoEscritura): Promise<Resultado<{ reserva: ReservaProveedor }>>;
  consultar(idProveedor: string): Promise<Resultado<{ reserva: ReservaProveedor }>>;
  cancelar(idProveedor: string, ctx: ContextoEscritura, opciones?: { motivo?: string }): Promise<Resultado<{ estado: EstadoGestionado; reembolso: number | null; moneda: string | null; detalle: Record<string, unknown> }>>;
  cambiar(idProveedor: string, cambio: Record<string, unknown>, ctx: ContextoEscritura): Promise<Resultado<{ estado: EstadoGestionado; detalle: Record<string, unknown> }>>;
  /** Webhook de estado (si el proveedor los manda). */
  webhook?(body: unknown): Promise<WebhookProveedor>;
}

export const falla = (code: FallaProveedor["code"], motivo: string, extra: Partial<FallaProveedor> = {}): FallaProveedor => ({ ok: false, code, motivo, ...extra });

export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Fecha del proveedor ("2025-12-25T05:00:00" sin zona = UTC según ETG) → ISO UTC. */
export function isoUtc(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : `${v}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
