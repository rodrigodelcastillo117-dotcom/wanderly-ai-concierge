// Un viaje grande puede pasar el tope de tiempo del servidor la primera vez (503): se reintenta UNA vez con la misma
// llave, sin que la persona tenga que volver a tocar el botón. Otros errores no se reintentan.
import { describe, expect, it } from "vitest";
import { generateMultiDestTrip } from "@/lib/multiDestGenerate";

const err = (status: number) => Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response("{}", { status }) });

function cliente(respuestas: Array<{ data: unknown; error: unknown }>) {
  const llamadas: unknown[] = [];
  return {
    llamadas,
    functions: { invoke: async (_fn: string, opts: { body: unknown }) => { llamadas.push(opts.body); return respuestas.shift()!; } },
    from: () => { throw new Error("no debe guardar sin usuario"); },
  };
}
const args = { userId: null, origin: "Ciudad de México", stops: ["Tokio", "Kioto", "Osaka"], viajeros: 2, prefs: {} };

describe("generateMultiDestTrip: reintento ante 503", () => {
  it("503 la primera vez y bien la segunda: devuelve el plan, con la misma llave", async () => {
    const c = cliente([{ data: null, error: err(503) }, { data: { logistics: { resumen: "ok" } }, error: null }]);
    const r = await generateMultiDestTrip(c, args);
    expect(r.logistics.resumen).toBe("ok");
    expect(c.llamadas).toHaveLength(2);
    expect((c.llamadas[0] as { request_key: string }).request_key).toBe((c.llamadas[1] as { request_key: string }).request_key);
  });
  it("503 dos veces: lanza el error (no reintenta sin fin)", async () => {
    const c = cliente([{ data: null, error: err(503) }, { data: null, error: err(503) }, { data: { logistics: {} }, error: null }]);
    await expect(generateMultiDestTrip(c, args)).rejects.toThrow();
    expect(c.llamadas).toHaveLength(2);
  });
  it("otro error (límite del plan, 429): no se reintenta", async () => {
    const c = cliente([{ data: null, error: err(429) }, { data: { logistics: {} }, error: null }]);
    await expect(generateMultiDestTrip(c, args)).rejects.toThrow();
    expect(c.llamadas).toHaveLength(1);
  });
});
