// Análisis en dos llamadas simultáneas a Claude (28-oct-2026). Antes una sola llamada escribía todo
// (~5,400 tokens de salida, ~35 s de los ~42 s del análisis). Ahora, con el mismo prompt y las mismas
// fuentes en vivo, una llamada entrega vuelos, hotel y presupuesto y la otra el itinerario, los
// restaurantes y los tours; cada una escribe la mitad y corren a la vez. Si alguna falla, quien llama
// usa el camino de una sola llamada (y su respaldo), así que nunca se pierde un análisis.

type Tool = { name: string; description: string; input_schema: { type: string; properties: Record<string, unknown>; required: string[] } };

/** Lo que escribe la segunda llamada; todo lo demás (vuelos, hotel, presupuesto, tips…) va en la primera. */
export const EXPERIENCE_KEYS = ["itinerario", "restaurantes", "tours"] as const;

export const CORE_TOOL_NAME = "entregar_vuelos_hotel_presupuesto";
export const EXPERIENCE_TOOL_NAME = "entregar_itinerario_lugares";

const CORE_NOTE = `ESTA LLAMADA entrega SOLO: análisis narrativo, total, match_score, desglose del presupuesto, vuelos, hospedaje, tips, país y cruceros (si aplica). Otra llamada simultánea arma el itinerario, los restaurantes y los tours: NO los escribas. Estima igual los renglones de comida, tours y transporte local del desglose. Entrega llamando a "${CORE_TOOL_NAME}", sin texto adicional.`;

const EXPERIENCE_NOTE = `ESTA LLAMADA entrega SOLO el itinerario día por día, los restaurantes y los tours. Otra llamada simultánea elige vuelos, hotel y presupuesto: NO los escribas. En el itinerario di "tu hotel" sin nombrar uno concreto; el día 1 es de llegada y el último de salida. Entrega llamando a "${EXPERIENCE_TOOL_NAME}", sin texto adicional.`;

function pick(tool: Tool, name: string, description: string, keep: (k: string) => boolean): Tool {
  const properties = Object.fromEntries(Object.entries(tool.input_schema.properties).filter(([k]) => keep(k)));
  return { name, description, input_schema: { type: "object", properties, required: tool.input_schema.required.filter(keep) } };
}

const isExperience = (k: string) => (EXPERIENCE_KEYS as readonly string[]).includes(k);

/** Las dos herramientas: mismas propiedades que la original, repartidas sin huecos ni repetidos. */
export function splitTool(tool: Tool): { core: Tool; experience: Tool } {
  return {
    core: pick(tool, CORE_TOOL_NAME, "Entrega vuelos, hospedaje, presupuesto y análisis del viaje.", (k) => !isExperience(k)),
    experience: pick(tool, EXPERIENCE_TOOL_NAME, "Entrega el itinerario día por día, los restaurantes y los tours del viaje.", isExperience),
  };
}

export function splitPayloads(tool: Tool, system: string, userPrompt: string) {
  const { core, experience } = splitTool(tool);
  const base = { tool_choice: { type: "auto" }, messages: [{ role: "user", content: userPrompt }] };
  return {
    core: { ...base, max_tokens: 10000, system: `${system}\n\n${CORE_NOTE}`, tools: [core] },
    experience: { ...base, max_tokens: 10000, system: `${system}\n\n${EXPERIENCE_NOTE}`, tools: [experience] },
  };
}

type ClaudeData = { content?: Array<{ type?: string; name?: string; input?: unknown }> };

function toolInput(data: ClaudeData | null, name: string): Record<string, unknown> | null {
  const b = (data?.content ?? []).find((x) => x?.type === "tool_use" && x?.name === name);
  return b?.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input as Record<string, unknown> : null;
}

/** Une las dos partes. Sin vuelos, sin itinerario o sin alguna parte → null (se usa el camino de una llamada). */
export function mergeParts(core: Record<string, unknown> | null, experience: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!core || !experience) return null;
  if (!Array.isArray(core.vuelos) || !Array.isArray(experience.itinerario) || experience.itinerario.length === 0) return null;
  const out: Record<string, unknown> = { ...core };
  for (const k of EXPERIENCE_KEYS) out[k] = Array.isArray(experience[k]) ? experience[k] : [];
  return out;
}

export interface ParallelResult {
  analysis: Record<string, unknown> | null;
  /** Respuestas crudas de Claude que sí llegaron (para registrar su costo real). */
  responses: ClaudeData[];
  failure?: string;
}

/** Corre las dos llamadas a la vez. `call` es callClaudeWithFallback (inyectada para probar sin red). */
export async function runParallelAnalysis(
  call: (payload: Record<string, unknown>) => Promise<Response>,
  tool: Tool,
  system: string,
  userPrompt: string,
): Promise<ParallelResult> {
  const p = splitPayloads(tool, system, userPrompt);
  const one = async (payload: Record<string, unknown>): Promise<ClaudeData | string> => {
    try {
      const res = await call(payload);
      if (!res.ok) return `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
      return await res.json() as ClaudeData;
    } catch (e) {
      return String((e as Error)?.message ?? e).slice(0, 300);
    }
  };
  const [coreRes, expRes] = await Promise.all([one(p.core), one(p.experience)]);
  const responses = [coreRes, expRes].filter((r): r is ClaudeData => typeof r !== "string");
  const core = typeof coreRes === "string" ? null : toolInput(coreRes, CORE_TOOL_NAME);
  const experience = typeof expRes === "string" ? null : toolInput(expRes, EXPERIENCE_TOOL_NAME);
  const analysis = mergeParts(core, experience);
  if (analysis) return { analysis, responses };
  const why = [
    typeof coreRes === "string" ? `núcleo: ${coreRes}` : core ? null : "núcleo: sin herramienta",
    typeof expRes === "string" ? `experiencias: ${expRes}` : experience ? null : "experiencias: sin herramienta",
  ].filter(Boolean).join(" | ") || "partes incompletas";
  return { analysis: null, responses, failure: why };
}
