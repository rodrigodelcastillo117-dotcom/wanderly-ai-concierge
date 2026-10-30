// Traslados (el caso "el chofer no llegó"): SOLO INTERFAZ, NO VERIFICADO.
//
// Se revisaron el 30-oct-2026 las dos opciones del estudio de negocio (NEGOCIO_AGENCIA.md §2.3):
//   · Mozio: su sitio (https://developer.mozio.com/llms.txt) dice que tiene "REST API" y webhooks para socios, pero la
//     documentación técnica no es pública (api.mozio.com/docs responde 403; no hay referencia de endpoints).
//   · Blacklane: https://www.blacklane.com/en/business-integrations/ dice que hay API para agencias y TMC y que
//     Sabre, Amadeus y Travelport están "fully live for bookings and cancellations", pero no publica la
//     documentación (se entrega al dar de alta).
// Sin documentación pública verificable no se inventan endpoints ni campos: cada método responde NO_VERIFICADO y
// no llama a nadie. Cuando el dueño firme con uno, el proveedor entrega su documentación y aquí se implementa con
// la misma interfaz (buscar, cotizar, reservar, consultar, cancelar, cambiar, webhook) y pruebas con sus respuestas.
import { type AdaptadorProveedor, falla } from "./tipos.ts";

export const TRASLADOS_CANDIDATOS = [
  { proveedor: "Mozio", fuente: "https://developer.mozio.com/llms.txt", estado: "API para socios anunciada; documentación técnica no pública" },
  { proveedor: "Blacklane", fuente: "https://www.blacklane.com/en/business-integrations/", estado: "API para agencias anunciada; documentación no pública" },
];

const NO = () => Promise.resolve(falla("NO_VERIFICADO",
  "Traslados por API: no hay documentación pública verificable de Mozio ni de Blacklane. Se activa al firmar con uno y recibir su documentación."));

export function crearTraslados(): AdaptadorProveedor {
  return {
    id: "traslados", producto: "traslado", verificado: false, documentacion: TRASLADOS_CANDIDATOS.map((c) => c.fuente), entorno: "sandbox",
    configurado: false,
    buscar: NO, cotizar: NO, reservar: NO, consultar: NO, cancelar: NO, cambiar: NO,
    webhook: () => Promise.resolve({ autentico: false, motivo: "no_verificado" }),
  };
}
