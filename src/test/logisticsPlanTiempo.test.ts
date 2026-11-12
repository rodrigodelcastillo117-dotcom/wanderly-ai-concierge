// logistics-plan no debe pasar el límite de 150 s (E2E 23-oct-2026: España y Japón dieron 504 sin viaje).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/logistics-plan/index.ts", "utf8");

describe("logistics-plan dentro del tiempo de la plataforma", () => {
  it("usa un modelo rápido (no 2.5 Pro con razonamiento largo)", () => {
    expect(src).toMatch(/const MODEL = "google\/gemini-flash-latest"/);
  });
  it("cada llamada de IA y de proveedor tiene tope, y el presupuesto total es < 150 s", () => {
    const budget = Number(/REQUEST_BUDGET_MS = ([\d_]+)/.exec(src)?.[1].replace(/_/g, ""));
    expect(budget).toBeGreaterThan(60_000);
    expect(budget).toBeLessThan(150_000);
    expect(src).toMatch(/signal: AbortSignal\.timeout\(Math\.max\(10_000, timeoutMs\)\)/);
    expect(src).toMatch(/signal: AbortSignal\.timeout\(40_000\)/);
    // Cada llamada al modelo: tope = mín(45 s, lo que le queda al plan) y un reintento solo si queda tiempo (aiRetry.ts, 11-nov-2026).
    expect(src.match(/callAIRetry\(\(ms\) => callAI\([^)]*, ms\), aiBudget/g)?.length).toBe(2);
  });
  it("si una ciudad o el global no alcanzan, se entrega parcial en vez de fallar todo", () => {
    expect(src).toMatch(/city \$\{city\} failed/);
    expect(src).toMatch(/global failed/);
  });
});

describe("plan de varias ciudades: Claude Haiku primero (12-nov-2026)", () => {
  it("callAI intenta Claude Haiku con la herramienta del esquema y, si no contesta, usa Gemini con el tiempo que queda", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/logistics-plan/index.ts", "utf8");
    expect(src).toMatch(/const PLAN_CLAUDE_MODEL = "claude-haiku-5-5"/);
    expect(src).toMatch(/const viaClaude = await callClaudeTool\(system, user, toolName, schema, timeoutMs\);\n\s+if \(viaClaude\) return viaClaude;/);
    expect(src).toMatch(/timeoutMs -= Date\.now\(\) - t0;/);
    expect(src).toMatch(/tools: \[\{ name: toolName, description: "Emite resultado", input_schema: schema \}\]/);
    expect(src).toMatch(/output_config: \{ effort: "low" \}/);
  });
});
