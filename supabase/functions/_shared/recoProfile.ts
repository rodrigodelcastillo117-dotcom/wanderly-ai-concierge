// ¿Hay algo del viajero con qué personalizar las recomendaciones? (Mejora 9.5, primer uso.)
// Una cuenta nueva sin gustos, favoritos ni viajes recibía "91 % afín a ti": un porcentaje que la IA
// inventa sin datos. Con el perfil vacío, la app las presenta como "Para empezar" y sin porcentaje.
import { hasTasteSignals, type TasteProfile } from "./tasteProfile.ts";

const filled = (v: unknown): boolean =>
  Array.isArray(v) ? v.some((x) => String(x ?? "").trim() !== "") : v != null && String(v).trim() !== "";

type Row = Record<string, unknown> | null | undefined;

export function recoProfileIsEmpty(input: { taste?: TasteProfile | null; travelProfile?: Row; aiPrefs?: Row }): boolean {
  const { taste, travelProfile: tp, aiPrefs: ai } = input;
  if (taste) {
    if (hasTasteSignals(taste)) return false;
    const d = taste.declarado;
    if (d && [d.ritmo, d.presupuesto, d.estilo, d.intereses, d.comida, d.dna].some(filled)) return false;
    if ((taste.conteos?.favoritos ?? 0) > 0 || filled(taste.proximos) || filled(taste.deseos) || filled(taste.ya_visitados)) return false;
  }
  const tpKeys = ["estilo_viaje", "intereses", "ritmo_viaje", "presupuesto_rango", "preferencias_comida", "descripcion_personal", "destinos_pendientes", "destinos_visitados"];
  if (tp && tpKeys.some((k) => filled(tp[k]))) return false;
  const aiKeys = ["ritmo_viaje", "nivel_presupuesto", "estilo_comida", "mejor_viaje_descripcion", "proposito_viaje", "perfil_ia"];
  if (ai && aiKeys.some((k) => filled(ai[k]))) return false;
  return true;
}
