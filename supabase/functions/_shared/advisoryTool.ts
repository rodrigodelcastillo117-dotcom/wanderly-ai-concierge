// Herramienta de Iato "get_travel_advisory": "Iato, ¿hay algo importante que deba saber antes de viajar a
// Tailandia?". Lógica pura (se prueba con Vitest en src/test/advisoryTool.test.ts); concierge-chat la
// conecta en toolDefs.ts (definición) y en makeExecTool (ejecutor). Usa el mismo núcleo y la misma caché
// que la tarjeta "Antes de viajar" (travelAdvisories.ts), así que dos personas que preguntan por el mismo
// país no vuelven a descargar nada durante 6 h.
//
// Por defecto NO traduce con otra IA: Iato ya responde en español y recibe el texto original con la
// instrucción de resumirlo fielmente. Si la tarjeta ya guardó la traducción, se le pasa también.
import { type AdvisoryDeps, type AdvisoryFail, type AdvisoryOk, type AvisoFuente, getTravelAdvisory } from "./travelAdvisories.ts";

/** Mismo formato neutral que concierge-chat/toolDefs.ts (ToolDef). */
export const ADVISORY_TOOL_DEF = {
  name: "get_travel_advisory",
  description:
    "Avisos de viaje OFICIALES de un país: nivel de riesgo y puntos clave de GOV.UK (Reino Unido, FCDO) y del " +
    "Departamento de Estado de EE. UU., con fecha de actualización y enlace, más el enlace a la Guía del Viajero de la " +
    "SRE para mexicanos. Úsala cuando pregunten qué deben saber antes de viajar a un país, si es seguro ir, si hay " +
    "alertas, zonas a evitar o requisitos de entrada. No la uses para clima, vuelos ni lugares. Son avisos para " +
    "británicos y estadounidenses: dilo así; para requisitos de un pasaporte mexicano remite a la SRE. Nunca inventes " +
    "requisitos ni niveles que no vengan en el resultado.",
  input_schema: {
    type: "object" as const,
    properties: {
      pais: { type: "string", description: "País o destino, ej. 'Tailandia', 'Japón', 'Bangkok' o el código ISO 'TH'" },
    },
    required: ["pais"] as const,
  },
};

const MAX = 380; // concierge-chat recorta cada texto a 400 (slimToolResult)
const short = (s: string | null | undefined, n = MAX) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const day = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

const compactFuente = (f: AvisoFuente) => ({
  fuente: f.fuente_nombre,
  para_quien: `Aviso para ${f.para_quien}`,
  nivel: f.nivel.etiqueta,
  nivel_original: f.nivel.original,
  actualizado: day(f.actualizado_at),
  url: f.url,
  // Original en inglés: Iato lo resume en español sin agregar nada.
  resumen_en: short(f.resumen),
  ...(f.secciones.seguridad ? { seguridad_en: short(f.secciones.seguridad, 300) } : {}),
  ...(f.secciones.salud ? { salud_en: short(f.secciones.salud, 240) } : {}),
  ...(f.secciones.entrada ? { entrada_en: short(f.secciones.entrada, 240) } : {}),
});

const INSTRUCCIONES = [
  "1) Empieza con la Guía del Viajero de la SRE (enlace en para_mexicanos): es lo que aplica a un pasaporte mexicano.",
  "2) Resume en español SOLO lo que dicen las fuentes, en 3 o 4 puntos cortos; di que son avisos del Reino Unido / EE. UU. para sus ciudadanos, con su nivel, fecha de actualización y enlace.",
  "3) No presentes requisitos de visa o entrada británicos/estadounidenses como requisitos para mexicanos. No agregues datos que no estén aquí.",
  "4) Si una fuente falló o no aplica, dilo en una frase. Cierra con: \"No sustituye asesoría migratoria, legal o consular.\"",
].join(" ");

/**
 * Ejecuta la herramienta. `deps` es el mismo de getTravelAdvisory (fetch, caché; sin `translate` por
 * defecto). Devuelve un objeto compacto (<6 000 caracteres) con fuentes, fechas e instrucciones.
 */
export async function runAdvisoryTool(input: Record<string, unknown> | null | undefined, deps: AdvisoryDeps) {
  const pais = String(input?.pais ?? input?.country ?? input?.destino ?? "").trim().slice(0, 120);
  if (!pais) return { ok: false, error: "falta_pais", instrucciones: "Pregunta a qué país viaja; no muestres avisos sin país." };
  const res = await getTravelAdvisory(pais, deps);
  if (!res.ok) {
    const f = res as AdvisoryFail;
    return {
      ok: false, code: f.code, mensaje: f.mensaje,
      para_mexicanos: { texto: f.para_mexicanos.texto, url: f.para_mexicanos.url },
      instrucciones: "Di que no reconociste el país y pide que lo escriba; ofrece el enlace de la SRE. No inventes avisos.",
    };
  }
  const r = res as AdvisoryOk;
  return {
    ok: true,
    pais: r.pais.nombre,
    iso2: r.pais.iso2,
    para_mexicanos: { texto: r.para_mexicanos.texto, url: r.para_mexicanos.url },
    fuentes: r.fuentes.map(compactFuente),
    ...(r.traduccion?.puntos?.length
      ? { puntos_es: r.traduccion.puntos.map((p) => ({ texto: short(p.texto, 220), fuente: p.fuente === "govuk" ? "GOV.UK" : "Departamento de Estado de EE. UU." })) }
      : {}),
    fallas: r.fallas.map((f) => f.mensaje),
    ...(r.guardado ? { nota: `Las fuentes no respondieron ahora; es lo último consultado el ${day(r.consultado_at)}.` } : {}),
    consultado: day(r.consultado_at),
    aviso_legal: r.aviso_legal,
    instrucciones: r.fuentes.length
      ? INSTRUCCIONES
      : "No hay avisos de GOV.UK ni del Departamento de Estado para este país ahora: dilo tal cual y da el enlace de la SRE. No inventes nada.",
  };
}
