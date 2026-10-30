// Libro de comisiones: sincronización con la API de finanzas de Travelpayouts, contra las respuestas de ejemplo de su
// documentación oficial (src/test/fixtures/proveedores/travelpayouts). Sin red: fetch y base simulados.
import { describe, expect, it, vi } from "vitest";
import { estadoTravelpayouts, filaDeAccion, sincronizarTravelpayouts, TP_FINANCE } from "../../supabase/functions/_shared/comisiones/travelpayouts";
import balance from "./fixtures/proveedores/travelpayouts/actions_affecting_balance.json";
import pagos from "./fixtures/proveedores/travelpayouts/user_payments.json";
import accionesPago from "./fixtures/proveedores/travelpayouts/actions_affecting_payment.json";

const AHORA = new Date("2021-06-01T12:00:00Z");
const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function dobles(rutas: Record<string, () => Response>) {
  const llamadas: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    llamadas.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    const k = Object.keys(rutas).find((r) => u.startsWith(`${TP_FINANCE}${r}`));
    return k ? rutas[k]() : resp({ error: "no simulado" }, 404);
  }) as unknown as typeof fetch;
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    if (fn === "commissions_upsert") return { data: { ok: true, nuevas: (args._rows as unknown[]).length, actualizadas: 0, ignoradas: 0, invalidas: 0 }, error: null };
    if (fn === "commissions_mark_paid") return { data: { ok: true, pagadas: (args._external_ids as unknown[]).length }, error: null };
    return { data: 1, error: null };
  });
  return { fetchImpl, rpc, llamadas, rpcs };
}

describe("Travelpayouts · mapeo de acciones (documentación oficial)", () => {
  it("estados: processing → pendiente, paid → confirmada, cancelled/canceled → rechazada; otro → null", () => {
    expect(estadoTravelpayouts("processing")).toBe("pendiente");
    expect(estadoTravelpayouts("paid")).toBe("confirmada");
    expect(estadoTravelpayouts("cancelled")).toBe("rechazada");
    expect(estadoTravelpayouts("canceled")).toBe("rechazada");
    expect(estadoTravelpayouts("refunded")).toBeNull();
  });

  it("la acción del ejemplo oficial queda como venta confirmada de Aviasales con su comisión, precio y fecha", () => {
    const f = filaDeAccion(balance.value.actions[0], "USD");
    expect(f).toMatchObject({
      external_id: "100:14358982146", campaign_id: 100, proveedor: "Aviasales", producto: "vuelo", status: "confirmada", provider_state: "paid",
      sale_amount: 60.83, commission_amount: 1.52, currency: "USD", booked_at: "2021-05-12T06:26:54.000Z",
      description: "Cape Girardeau (US), 2022-01-20 – 2022-01-21, Agoda",
    });
  });

  it("programa sin id documentado: 'Programa N'; sin action_id, sin profit o estado desconocido no entra", () => {
    expect(filaDeAccion({ action_id: "157:1", action_state: "processing", profit: "3" }, "USD")).toMatchObject({ proveedor: "Programa 157", campaign_id: 157 });
    expect(filaDeAccion({ action_state: "paid", profit: "1" }, "USD")).toBeNull();
    expect(filaDeAccion({ action_id: "100:1", action_state: "paid" }, "USD")).toBeNull();
    expect(filaDeAccion({ action_id: "100:1", action_state: "raro", profit: "1" }, "USD")).toBeNull();
  });
});

describe("Travelpayouts · sincronización", () => {
  it("apagada: no llama a Travelpayouts ni a la base", async () => {
    const d = dobles({});
    const r = await sincronizarTravelpayouts({ fetchImpl: d.fetchImpl, token: "tok", rpc: d.rpc, prendido: async () => false, ahora: () => AHORA });
    expect(r.apagado).toBe(true);
    expect(d.llamadas).toHaveLength(0);
    expect(d.rpcs).toHaveLength(0);
  });

  it("sin TRAVELPAYOUTS_TOKEN: lo registra como falla clara y no llama a nadie", async () => {
    const d = dobles({});
    const r = await sincronizarTravelpayouts({ fetchImpl: d.fetchImpl, token: undefined, rpc: d.rpc, prendido: async () => true, ahora: () => AHORA });
    expect(r).toMatchObject({ ok: false, code: "SIN_TOKEN" });
    expect(d.llamadas).toHaveLength(0);
    expect(d.rpcs.map((x) => x.fn)).toEqual(["commission_sync_log"]);
  });

  it("lee acciones (token en X-Access-Token, nunca en la URL), las guarda y marca pagadas las de cada pago reciente", async () => {
    const d = dobles({
      "/get_user_actions_affecting_balance": () => resp(balance.value),
      "/get_user_payments": () => resp(pagos.value),
      "/get_user_actions_affecting_payment": () => resp(accionesPago.value),
    });
    const r = await sincronizarTravelpayouts({ fetchImpl: d.fetchImpl, token: "secreto-tp", rpc: d.rpc, prendido: async () => true, ahora: () => AHORA });
    expect(r).toMatchObject({ ok: true, acciones: 1, nuevas: 1, pagos: 1, pagadas: 1 });
    expect(d.llamadas[0].url).toBe(`${TP_FINANCE}/get_user_actions_affecting_balance?currency=usd&from=2020-12-03&until=2021-06-01&offset=0&limit=300`);
    expect(d.llamadas.every((l) => l.headers["X-Access-Token"] === "secreto-tp" && !l.url.includes("secreto-tp"))).toBe(true);
    const up = d.rpcs.find((x) => x.fn === "commissions_upsert")!;
    expect(up.args._source).toBe("travelpayouts");
    expect((up.args._rows as Array<{ external_id: string }>)[0].external_id).toBe("100:14358982146");
    const paid = d.rpcs.find((x) => x.fn === "commissions_mark_paid")!;
    expect(paid.args).toMatchObject({ _source: "travelpayouts", _payout_ref: "4af0c247-df4c-4873-a6b6-7bbf91afa3b9", _external_ids: ["100:10080977893"] });
    expect(d.rpcs.at(-1)).toMatchObject({ fn: "commission_sync_log", args: { _ok: true } });
  });

  it("pagina de 300 en 300 hasta el total (count) y no más de maxPaginas", async () => {
    const pagina = (n: number) => Array.from({ length: n }, (_, i) => ({ action_id: `100:${i}`, campaign_id: 100, action_state: "processing", price: "10", profit: "0.1" }));
    let llamada = 0;
    const d = dobles({
      "/get_user_actions_affecting_balance": () => resp({ actions: pagina(llamada++ < 2 ? 300 : 12), count: 612 }),
      "/get_user_payments": () => resp([]),
    });
    const r = await sincronizarTravelpayouts({ fetchImpl: d.fetchImpl, token: "t", rpc: d.rpc, prendido: async () => true, ahora: () => AHORA });
    expect(r.acciones).toBe(612);
    expect(d.llamadas.filter((l) => l.url.includes("affecting_balance")).map((l) => new URL(l.url).searchParams.get("offset"))).toEqual(["0", "300", "600"]);
    expect(d.rpcs.filter((x) => x.fn === "commissions_upsert")).toHaveLength(3);
  });

  it("token rechazado (401), límite (429) o formato inesperado: falla registrada, nada se guarda", async () => {
    for (const [respuesta, code] of [[resp({}, 401), "TOKEN_RECHAZADO"], [resp({}, 429), "LIMITE"], [resp({ data: [] }), "FORMATO_INESPERADO"]] as const) {
      const d = dobles({ "/get_user_actions_affecting_balance": () => respuesta.clone() });
      const r = await sincronizarTravelpayouts({ fetchImpl: d.fetchImpl, token: "t", rpc: d.rpc, prendido: async () => true, ahora: () => AHORA });
      expect(r).toMatchObject({ ok: false, code });
      expect(d.rpcs.map((x) => x.fn)).toEqual(["commission_sync_log"]);
    }
  });
});
