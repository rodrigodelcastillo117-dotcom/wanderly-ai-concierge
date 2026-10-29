// Evaluación de incidentes con IA REAL (Claude). NO corre en Vitest (las pruebas no salen a la red): se corre a
// mano cuando se quiera medir la clasificación con IA sobre los mismos escenarios de src/test/fixtures.
//
//   npm i --no-save @anthropic-ai/sdk
//   ANTHROPIC_API_KEY=... npx tsx scripts/incidentes/evalReal.ts            # reglas + IA solo si dudan (lo de producción)
//   ANTHROPIC_API_KEY=... npx tsx scripts/incidentes/evalReal.ts --solo-ia  # la IA clasifica TODO (para compararla)
//
// Costo: ~72 llamadas cortas (una por escenario en --solo-ia; muchas menos en modo normal). Imprime aciertos por
// escenario y el total; sale con código 1 si algo falla.
import { INCIDENT_SCENARIOS } from "../../src/test/fixtures/incidentScenarios";
import { AI_CLASSIFIER_SYSTEM, classifyIncident, detectIncident } from "../../supabase/functions/_shared/incident-detect";

const soloIa = process.argv.includes("--solo-ia");
const MODEL = process.env.INCIDENT_EVAL_MODEL ?? "claude-opus-5-5";

async function main() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const ai = async (text: string): Promise<string> => {
    // deno-lint-ignore no-explicit-any -- tipos del SDK según la versión instalada
    const msg: any = await client.messages.create({
      model: MODEL, max_tokens: 1024, output_config: { effort: "low" }, system: AI_CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: text }],
    } as never);
    if (msg.stop_reason === "refusal") return "";
    return (msg.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  };
  let ok = 0;
  for (const s of INCIDENT_SCENARIOS) {
    const r = soloIa
      ? await (async () => { const raw = await ai(s.texto); const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); return { detected: j.detected === true, categoria: j.categoria ?? null }; })()
      : s.canal === "formulario" ? detectIncident(s.texto, { forceCategory: s.elegida ?? null }) : await classifyIncident(s.texto, { ai, timeoutMs: 20000 });
    const got = r.detected ? r.categoria : null;
    const pass = got === s.categoria;
    if (pass) ok++;
    console.log(`${pass ? "OK   " : "FALLA"} ${s.id} esperado=${s.categoria ?? "—"} obtenido=${got ?? "—"} · ${s.texto.slice(0, 70)}`);
  }
  console.log(`\nEVAL IA REAL (${soloIa ? "solo IA" : "reglas + IA si dudan"}, ${MODEL}): ${ok}/${INCIDENT_SCENARIOS.length}`);
  process.exit(ok === INCIDENT_SCENARIOS.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
