// Direcciones de correo de reclamos en el dominio de recepción (reply.traveliatos.life) y cómo se
// distingue cada correo entrante SIN romper Reservas IA:
//   reservas+<24 hex>@…  → Reservas IA (reservations-inbound), como hoy.
//   reclamos+<24 hex>@…  → respuesta del proveedor a un reclamo (Reply-To de cada carta).
//   casos+<24 hex>@…     → correo que el USUARIO reenvía (confirmaciones, respuestas de la aerolínea) a su
//                          dirección personal; el token identifica al usuario y el remitente debe ser su
//                          propio correo con autenticación (DMARC/DKIM).
//   casos@…              → sin token no se puede saber de quién es: se ignora (se le muestra al usuario su
//                          dirección personal casos+<token>@).
// Mismo dominio y mismo proveedor (Resend Receiving): se registra un SEGUNDO webhook (reclamos-inbound,
// con su propio secreto) y reservations-inbound ignora reclamos+/casos (cambio mínimo en service.ts).
export const DOMINIO_RESPUESTA = "reply.traveliatos.life";
export const REMITENTE_RECLAMOS = "reclamos@traveliatos.life";

const esc = (d: string) => d.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function direccionReclamo(token: string, dominio = DOMINIO_RESPUESTA): string {
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("token inválido");
  return `reclamos+${token}@${dominio}`;
}
export function direccionCasos(token: string, dominio = DOMINIO_RESPUESTA): string {
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("token inválido");
  return `casos+${token}@${dominio}`;
}

export type RutaEntrante = { tipo: "reserva" | "reclamo" | "caso" | "ninguna"; token: string | null };

/** Clasifica un correo entrante por las direcciones a las que llegó (to, cc, received_for). */
export function rutaEntrante(direcciones: unknown[], dominio = DOMINIO_RESPUESTA): RutaEntrante {
  const d = esc(dominio);
  const todas = direcciones.flat().map((a) => String(a ?? ""));
  const buscar = (local: string) => {
    const re = new RegExp(`${local}\\+([0-9a-f]{24})@${d}(?![a-z0-9.-])`, "i");
    for (const a of todas) {
      const m = re.exec(a);
      if (m) return m[1].toLowerCase();
    }
    return null;
  };
  const reserva = buscar("reservas");
  if (reserva) return { tipo: "reserva", token: reserva };
  const reclamo = buscar("reclamos");
  if (reclamo) return { tipo: "reclamo", token: reclamo };
  const caso = buscar("casos");
  if (caso) return { tipo: "caso", token: caso };
  return { tipo: "ninguna", token: null };
}

/** ¿Va dirigido a reclamos+/casos(+)? Lo usa reservations-inbound para no tocarlo. */
export function esCorreoDeReclamos(direcciones: unknown[], dominio = DOMINIO_RESPUESTA): boolean {
  const d = esc(dominio);
  const re = new RegExp(`(^|[^a-z0-9._%+-])(reclamos\\+[0-9a-f]{24}|casos(\\+[0-9a-f]{24})?)@${d}(?![a-z0-9.-])`, "i");
  return direcciones.flat().some((a) => re.test(String(a ?? "")));
}
