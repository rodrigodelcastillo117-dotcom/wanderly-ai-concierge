// Iato tiene la herramienta de avisos oficiales conectada (28-oct-2026).
import { describe, expect, it } from "vitest";
import { TOOL_NAMES, toolDef } from "../../supabase/functions/concierge-chat/toolDefs";
import { FACT_TOOLS } from "../../supabase/functions/concierge-chat/guard";

describe("Iato · avisos oficiales de viaje", () => {
  it("get_travel_advisory está entre sus herramientas y cuenta como fuente de hechos", () => {
    expect(TOOL_NAMES).toContain("get_travel_advisory");
    expect(toolDef("get_travel_advisory")?.input_schema).toMatchObject({ required: ["pais"] });
    expect(FACT_TOOLS).toContain("get_travel_advisory");
  });
});
