// Texto del análisis de viaje: reglas para el modelo y limpieza determinista (sin Deno, se prueba con
// Vitest). Caso Valle de Bravo (E2E 28-oct-2026), viaje en coche del 20 al 23 de noviembre:
//  * "Las opciones terrestres son estimaciones por persona…": la tarjeta del coche dice "costo del coche
//    (no por persona)". En coche, los costos del coche nunca son "por persona".
//  * "Aunque marcaste 3 días en fechas (20 al 23…), lo armé como una escapada de 4 días": del 20 al 23 son
//    3 noches y 4 días, igual que cuenta la app; el modelo leía "(3 días)" en el prompt. Ahora el prompt
//    dice noches y días, y una frase que "reinterpreta" la duración se quita.
//  * "Como Madrid es tu favorito, te sugiero hoteles con carácter de pueblo": un destino favorito ajeno al
//    viaje no es razón de nada en Valle de Bravo (también salió "Como Madrid está en tus favoritos" en un
//    viaje a Cancún). Se quita la frase que cita otro destino del perfil de gustos.
// Solo se QUITAN frases; nunca se escribe una nueva.
import type { TasteProfile } from "../_shared/tasteProfile.ts";

export const NARRATIVE_RULES = `REGLAS DEL TEXTO (analisis_narrativo, tips_personalizados y cada "por_que"):
- Duración: usa las noches y días del CALENDARIO DEL VIAJE tal cual. No comentes que cambiaste, ajustaste o reinterpretaste los días del viaje.
- Personalización: cita solo gustos que apliquen a ESTE destino. No menciones otros destinos (favoritos, viajes pasados, lugares que quiere conocer) como razón de una sugerencia.
- Trayecto en coche: casetas y gasolina son el costo del coche, nunca "por persona".
- Fuentes: nombra solo lo que la persona reconoce ("Google Flights", "Google Hotels", "Google Maps", "Aviasales", "datos en vivo"); nunca proveedores técnicos (SerpApi, Perplexity, Travelpayouts, API). La bóveda de beneficios se llama "tus documentos y tarjetas".`;

// scrubProviders vive en _shared/providerNames.ts (también lo usa Iato, concierge-chat).
export { scrubProviders } from "../_shared/providerNames.ts";
import { scrubProviders } from "../_shared/providerNames.ts";

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

/** Destinos del perfil de gustos (favoritos, viajes pasados, visitados, próximos y deseos). */
export function tasteLabels(p: TasteProfile | null | undefined): string[] {
  if (!p) return [];
  const all = [
    ...(p.encanta ?? []).map((x) => x?.label),
    ...(p.viajes_pasados ?? []).map((t) => t?.destino),
    ...(p.ya_visitados ?? []), ...(p.proximos ?? []), ...(p.deseos ?? []),
  ];
  return [...new Set(all.map((x) => String(x ?? "").trim()).filter((x) => norm(x).length >= 3))];
}

/** Frases (corta en ". ", "! ", "? " seguidas de mayúscula o signo de apertura). */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“(])/u).filter((x) => x.trim());
}

const DURATION_REWRITE = /\b(aunque (marcaste|elegiste|pusiste|indicaste|seleccionaste)|lo arm[eé] como|lo (convert[ií]|ajust[eé]|plante[eé]) (a|como|en) (una escapada de )?\d+ d[ií]as|en lugar de \d+ d[ií]as)\b/iu;
const CAR_WORDS = /\b(coche|auto|carro|terrestres?|casetas?|gasolina|manejo|manejar|carretera)\b/;
const CITES_TASTE = /\b(favorit\w*|te encant\w*|tu viaje a|como en tu|guardaste|ya conoces|viajes? pasados?|quieres conocer|tus gustos)\b/;

export type NarrativeCtx = { destino: string; pais?: string | null; enCoche: boolean; otherPlaces: string[] };

/** ¿Hay que quitar esta frase? Devuelve el motivo o null. */
export function sentenceProblem(s: string, c: NarrativeCtx): string | null {
  const n = norm(s);
  if (DURATION_REWRITE.test(s)) return "duracion";
  if (c.enCoche && /\bpor persona\b/.test(n) && CAR_WORDS.test(n)) return "coche_por_persona";
  if (CITES_TASTE.test(n)) {
    const here = `${norm(c.destino)} ${norm(c.pais)}`;
    const foreign = c.otherPlaces.find((p) => {
      const k = norm(p);
      return k && ` ${n} `.includes(` ${k} `) && !` ${here} `.includes(` ${k} `) && !` ${k} `.includes(` ${norm(c.destino)} `);
    });
    if (foreign) return `destino_ajeno:${foreign}`;
  }
  return null;
}

function cleanText(text: unknown, c: NarrativeCtx, quitadas: string[]): unknown {
  if (typeof text !== "string" || !text.trim()) return text;
  const keep: string[] = [];
  for (const s of sentences(scrubProviders(text))) {
    if (sentenceProblem(s, c)) quitadas.push(s);
    else keep.push(s);
  }
  return keep.join(" ").trim();
}

/** Quita del análisis (en sitio) las frases con esos tres defectos. */
export function cleanNarrative(a: any, c: NarrativeCtx): { quitadas: string[] } {
  const quitadas: string[] = [];
  if (!a || typeof a !== "object") return { quitadas };
  a.analisis_narrativo = cleanText(a.analisis_narrativo, c, quitadas);
  if (Array.isArray(a.tips_personalizados)) {
    a.tips_personalizados = a.tips_personalizados.map((t: unknown) => cleanText(t, c, quitadas)).filter((t: unknown) => typeof t !== "string" || t.trim());
  }
  for (const k of ["hospedaje", "restaurantes", "tours"]) {
    for (const x of Array.isArray(a[k]) ? a[k] : []) if (x && typeof x === "object" && typeof x.por_que === "string") x.por_que = cleanText(x.por_que, c, quitadas);
  }
  return { quitadas };
}
