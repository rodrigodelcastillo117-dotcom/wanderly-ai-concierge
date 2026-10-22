import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatError, modelHttpErrorCode, toolErrorCode } from "../../supabase/functions/concierge-chat/errors";

describe("concierge-chat: errores con códigos estables", () => {
  it("cada código trae status, error y mensaje fijos (sin detalle técnico)", () => {
    const e = chatError("AI_UNAVAILABLE");
    expect(e).toEqual({ status: 502, body: { code: "AI_UNAVAILABLE", error: "ai_unavailable", message: "Iato no pudo responder. Intenta de nuevo en un momento." } });
    expect(Object.keys(chatError("INTERNAL_ERROR").body).sort()).toEqual(["code", "error", "message"]);
    expect(chatError("UNAUTHENTICATED").status).toBe(401);
    expect(chatError("SERVICE_UNAVAILABLE").status).toBe(503);
  });

  it("errores del gateway de IA → códigos, nunca 'AI gateway 500' ni el cuerpo del proveedor", () => {
    expect(modelHttpErrorCode(429)).toBe("RATE_LIMITED");
    expect(modelHttpErrorCode(402)).toBe("SERVICE_UNAVAILABLE");
    expect(modelHttpErrorCode(500)).toBe("AI_UNAVAILABLE");
  });

  it("el error de una tool no lleva el mensaje crudo (URLs con llaves)", () => {
    expect(toolErrorCode(new Error("error sending request for url (https://serpapi.com/search?api_key=SECRETO)"))).toBe("tool_fetch_error");
    expect(toolErrorCode({ name: "TimeoutError" })).toBe("timeout");
  });

  it("index.ts ya no devuelve detail ni e.message al cliente", () => {
    const src = readFileSync("supabase/functions/concierge-chat/index.ts", "utf8");
    expect(src).not.toMatch(/detail:\s*e\.detail/);
    expect(src).not.toMatch(/json\(\{\s*error:\s*e\??\.message/);
    expect(src).not.toMatch(/AI gateway \$\{/);
  });
});
