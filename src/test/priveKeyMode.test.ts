// Modo Privé de Iato (concierge-chat, mode "prive_key"): sesión Privé, viaje correcto, cupo diario, caché y
// costo. Nada llama a un modelo de IA: no hay ninguna llave ni fetch en estas pruebas.
import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/priveKeyCatalog.json";
import { KEY_DAILY_LIMIT, memoryCache, parseAnswers, runPriveKey, type PriveKeyDeps } from "../../supabase/functions/concierge-chat/priveKeyMode";
import { runSearchPrive } from "../../supabase/functions/concierge-chat/prive";

const TODAY = "2026-10-22";
const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CDMX_TRIP = { id: "11111111-1111-4111-8111-111111111111", destino: "Ciudad de México", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-24", num_viajeros: 2 };
const PARIS_TRIP = { id: "22222222-2222-4222-8222-222222222222", destino: "París", fecha_salida: "2026-12-10", fecha_regreso: "2026-12-14", num_viajeros: 2 };

function searchRpc(slug: "cdmx" | "mc" | "paris" | null) {
  return vi.fn(async (fn: string, params: Record<string, unknown>) => {
    expect(fn).toBe("prive_search");
    expect(params._ps).toBe("ps-token");
    if (!slug) return { data: { available: true, cities: [{ query: String((params._cities as string[])[0]), resolved: false, coverage: "SIN_COBERTURA_VERIFICADA", items: [] }] }, error: null };
    const c = (fixture as any).cities[slug];
    return { data: { available: true, adult_confirmed: true, cities: [{ query: slug, resolved: true, city: c.city, coverage: "COBERTURA_PARCIAL", items: c.items }] }, error: null };
  });
}

function deps(over: Partial<PriveKeyDeps> = {}): PriveKeyDeps {
  return {
    userId: UID, priveSession: "ps-token", rpc: searchRpc("cdmx"), trips: [], pinnedId: null, todayISO: TODAY,
    hitDaily: vi.fn(async () => true), cache: memoryCache(), now: () => 1_000, ...over,
  };
}

describe("sesión Privé", () => {
  it("sin sesión Privé no consulta nada y no nombra lugares", async () => {
    const d = deps({ priveSession: null });
    const out = await runPriveKey({ wish: "Aniversario en CDMX el sábado" }, d);
    expect(out.body).toMatchObject({ ok: false, code: "PRIVE_NO_SESSION", available: false });
    expect(d.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(out.body)).not.toMatch(/Quintonil|Contramar/);
  });
  it("sesión vencida en la base: se devuelve el código para volver al candado", async () => {
    const d = deps({ rpc: vi.fn(async () => ({ data: null, error: { message: "PRIVE_SESSION_EXPIRED" } })) });
    const out = await runPriveKey({ wish: "Aniversario en CDMX el sábado para 2, sin tope" }, d);
    expect(out.body).toMatchObject({ ok: false, code: "PRIVE_SESSION_EXPIRED" });
  });
  it("deseo vacío: petición inválida", async () => {
    expect((await runPriveKey({ wish: " " }, deps())).status).toBe(400);
  });
});

describe("preguntas: gratis e inmediatas", () => {
  it("si falta información, pregunta sin tocar la base ni el cupo y con costo cero", async () => {
    const d = deps();
    const out = await runPriveKey({ wish: "Quiero una noche inolvidable con mi pareja" }, d);
    expect(out.body.status).toBe("questions");
    expect((out.body.questions as { id: string }[]).map((q) => q.id)).toEqual(["destination", "date", "budget"]);
    expect(d.rpc).not.toHaveBeenCalled();
    expect(d.hitDaily).not.toHaveBeenCalled();
    expect(out.body.cost).toMatchObject({ ai_calls: 0, ai_tokens: 0, db_rpc_calls: 0 });
  });
  it("con las respuestas (botones), arma las propuestas", async () => {
    const out = await runPriveKey({ wish: "Quiero una noche inolvidable con mi pareja", answers: { destination: "cdmx", date: "tomorrow", budget: "open" } }, deps());
    expect(out.body.status).toBe("proposals");
    expect((out.body.proposals as unknown[]).length).toBe(3);
  });
  it("las respuestas se validan: nada de texto libre largo ni montos absurdos", () => {
    expect(parseAnswers({ destination: "x".repeat(500), date: "ayer", party: 99, budget: { amount: -5, currency: "pesos" } })).toEqual({ destination: "x".repeat(80) });
    expect(parseAnswers({ date: "2026-11-01", party: 4, budget: { amount: 9000, currency: "mxn" } })).toEqual({ date: "2026-11-01", party: 4, budget: { amount: 9000, currency: "MXN" } });
  });
});

describe("el viaje correcto (nunca otro por error)", () => {
  it("dos viajes y el deseo nombra CDMX: usa el de CDMX con sus fechas", async () => {
    const out = await runPriveKey({ wish: "Organiza una noche de aniversario en CDMX, sin tope" }, deps({ trips: [PARIS_TRIP, CDMX_TRIP] }));
    expect(out.body.trip).toMatchObject({ id: CDMX_TRIP.id, reason: "mentioned" });
    expect((out.body.wish as any).date).toBe("2026-11-20");
  });
  it("dos viajes y el deseo no nombra lugar: no adivina; pregunta el lugar con los dos destinos", async () => {
    const d = deps({ trips: [PARIS_TRIP, CDMX_TRIP] });
    const out = await runPriveKey({ wish: "Organiza una noche especial con mi pareja" }, d);
    expect(out.body.trip).toBeNull();
    expect(out.body.status).toBe("questions");
    const q = (out.body.questions as { id: string; options: { value: string }[] }[]).find((x) => x.id === "destination")!;
    expect(q.options.slice(0, 2).map((o) => o.value)).toEqual(["cdmx", "paris"]); // por fecha de salida
    expect(out.body.trip_choice).toHaveLength(2);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it("viaje fijado a París pero el deseo es en CDMX: no se mezcla con París", async () => {
    const out = await runPriveKey({ wish: "Cena en CDMX mañana para 2, sin tope" }, deps({ trips: [PARIS_TRIP], pinnedId: PARIS_TRIP.id }));
    expect(out.body.trip).toBeNull();
    expect(out.body.trip_note).toMatch(/París/);
  });
  it("un solo viaje y sin lugar en el texto: usa ese viaje", async () => {
    const out = await runPriveKey({ wish: "Sorpréndeme" }, deps({ trips: [CDMX_TRIP] }));
    expect(out.body.trip).toMatchObject({ id: CDMX_TRIP.id, reason: "single_upcoming" });
    expect(out.body.status).toBe("proposals");
  });
});

describe("costo y límites", () => {
  const WISH = { wish: "Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado" };
  it("un plan = 1 RPC, 0 IA, costo estimado de una invocación de Edge", async () => {
    const out = await runPriveKey(WISH, deps());
    expect(out.body.cost).toMatchObject({ ai_calls: 0, ai_tokens: 0, paid_api_calls: 0, db_rpc_calls: 1, cache: "miss" });
    expect((out.body.cost as any).est_usd).toBeLessThan(0.00001);
  });
  it("repetir el mismo deseo sale de la caché: ni RPC ni cupo", async () => {
    const d = deps();
    const a = await runPriveKey(WISH, d);
    const b = await runPriveKey(WISH, d);
    expect(d.rpc).toHaveBeenCalledTimes(1);
    expect(d.hitDaily).toHaveBeenCalledTimes(1);
    expect((b.body.cost as any).cache).toBe("hit");
    expect(b.body.proposals).toEqual(a.body.proposals);
  });
  it("la caché es por usuario: otro usuario no recibe el plan de otro", async () => {
    const cache = memoryCache();
    await runPriveKey(WISH, deps({ cache }));
    const d2 = deps({ cache, userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    await runPriveKey(WISH, d2);
    expect(d2.rpc).toHaveBeenCalledTimes(1);
  });
  it("cupo diario agotado: 429 con mensaje claro y sin consultar", async () => {
    const d = deps({ hitDaily: vi.fn(async () => false) });
    const out = await runPriveKey(WISH, d);
    expect(out.status).toBe(429);
    expect(out.body).toMatchObject({ ok: false, code: "KEY_DAILY_LIMIT" });
    expect(d.rpc).not.toHaveBeenCalled();
    expect(d.hitDaily).toHaveBeenCalledWith("prive-key-day", KEY_DAILY_LIMIT);
  });
  it("las sorpresas tienen su propio cupo", async () => {
    const d = deps();
    await runPriveKey({ wish: "Sorpréndeme en CDMX esta noche" }, d);
    expect((d.hitDaily as any).mock.calls[0][0]).toBe("prive-key-surprise-day");
  });
  it("si el cupo no se puede verificar, sigue (no hay API de pago detrás)", async () => {
    const out = await runPriveKey(WISH, deps({ hitDaily: vi.fn(async () => null) }));
    expect(out.body.status).toBe("proposals");
  });
});

describe("respaldo honesto", () => {
  it("destino sin cobertura verificada: lo dice y no inventa", async () => {
    const out = await runPriveKey({ wish: "Sorpréndeme en Tokio esta noche" }, deps({ rpc: searchRpc(null) }));
    expect(out.body.status).toBe("no_coverage");
    expect(out.body.proposals).toEqual([]);
    expect(String(out.body.note)).toMatch(/No te propongo lugares que no hayamos podido comprobar/);
  });
  it("Otra sorpresa: excluye la anterior", async () => {
    const d = deps();
    const a = await runPriveKey({ wish: "Sorpréndeme en CDMX esta noche" }, d);
    const first = (a.body.proposals as any[])[0].steps[0].experience.id;
    const b = await runPriveKey({ wish: "Sorpréndeme en CDMX esta noche", exclude: [first] }, d);
    expect((b.body.proposals as any[])[0].steps[0].experience.id).not.toBe(first);
  });
});

describe("Iato en el chat usa las mismas propuestas (search_prive con key)", () => {
  it("devuelve los tres niveles compactos y la nota de propuesta, no reserva", async () => {
    const rpc = searchRpc("cdmx");
    const out = await runSearchPrive({ cities: ["CDMX"], key: { request: "aniversario con mi pareja" }, date_from: "2026-10-24", party_size: 2 },
      { rpc, priveSession: "ps-token", todayISO: TODAY }) as any;
    expect(out.key.propuestas.map((p: any) => p.nivel)).toEqual(["THE SIGNATURE", "THE INSIDER", "THE UNEXPECTED"]);
    expect(out.key.nota).toMatch(/Propuestas, no reservas/);
  });
});
