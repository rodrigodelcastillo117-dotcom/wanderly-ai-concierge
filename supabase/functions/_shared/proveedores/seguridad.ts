// Candado de escritura de los adaptadores: reservar, cancelar y cambiar. Puro.
//   · Sandbox: se permite (el proveedor promete que no hay cargos ni reservas reales).
//   · Producción: solo con app_flags.proveedores_reservas_enabled = true (decisión del dueño, tras firmar).
// Las lecturas (buscar, cotizar, consultar) no pasan por aquí.
import { type ContextoEscritura, type Entorno, falla, type FallaProveedor } from "./tipos.ts";

export function puedeEscribir(entorno: Entorno, ctx: ContextoEscritura | null | undefined): FallaProveedor | null {
  if (entorno === "sandbox") return null;
  if (ctx?.reservasRealesPermitidas === true) return null;
  return falla("BLOQUEADO_PRODUCCION",
    "Reservar, cancelar o cambiar en producción está apagado (bandera proveedores_reservas_enabled). Una persona lo hace con el proveedor.");
}

/** Lee el entorno de un secreto: solo "produccion" explícito; cualquier otra cosa es sandbox. */
export function entornoDe(valor: string | undefined | null): Entorno {
  return String(valor ?? "").trim().toLowerCase() === "produccion" ? "produccion" : "sandbox";
}
