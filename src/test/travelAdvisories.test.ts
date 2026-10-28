// Avisos de viaje oficiales (Etapa 1.3): resolución de país, normalización de GOV.UK y del State Dept con
// respuestas REALES recortadas (descargadas el 28-oct-2026 en src/test/fixtures/avisos/), fallos
// parciales, caché compartida y traducción fiel. Sin red: fetch simulado.
import { beforeEach, describe, expect, it, vi } from "vitest";
import govukIndex from "./fixtures/avisos/govuk_index.json";
import govukThailand from "./fixtures/avisos/govuk_thailand.json";
import govukSpain from "./fixtures/avisos/govuk_spain.json";
import govukJapan from "./fixtures/avisos/govuk_japan.json";
import govukUsa from "./fixtures/avisos/govuk_usa.json";
import stateList from "./fixtures/avisos/state_travel_advisories.json";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import {
  ADVISORY_PARTIAL_TTL_SECONDS, ADVISORY_TTL_SECONDS, GOVUK_API, SRE_URL, STATE_API, type AvisoFuente, clip, getTravelAdvisory,
  govukIndexFrom, govukLevel, govukSlugFor, htmlToText, makeTranslator, normalizeGovuk, normalizeState, numbersFaithful,
  parseTranslation, probeTravelAdvisories, resetAdvisoryMemo, resolveCountry, stateEntryFor, stateLevel,
} from "../../supabase/functions/_shared/travelAdvisories";

const NOW = Date.parse("2026-10-28T18:00:00Z");
const AT = new Date(NOW).toISOString();
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Route = (url: string) => Response | Promise<Response>;
function fakeFetch(overrides: Record<string, Route> = {}) {
  const docs: Record<string, unknown> = { thailand: govukThailand, spain: govukSpain, japan: govukJapan, usa: govukUsa };
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [prefix, route] of Object.entries(overrides)) if (url === prefix) return route(url);
    if (url === GOVUK_API) return res(govukIndex);
    if (url.startsWith(`${GOVUK_API}/`)) {
      const slug = url.slice(GOVUK_API.length + 1);
      return docs[slug] ? res(docs[slug]) : res({ message: "not found" }, 404);
    }
    if (url === STATE_API) return res(stateList);
    throw new TypeError(`sin ruta simulada: ${url}`);
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

beforeEach(() => resetAdvisoryMemo());

describe("resolveCountry: nombre en español, código ISO o destino", () => {
  it.each([
    ["Tailandia", "TH", "Tailandia"],
    ["España", "ES", "España"],
    ["espana", "ES", "España"],
    ["Japón", "JP", "Japón"],
    ["Estados Unidos", "US", "Estados Unidos"],
    ["EE. UU.", "US", "Estados Unidos"],
    ["TH", "TH", "Tailandia"],
    ["th", "TH", "Tailandia"],
    ["Thailand", "TH", "Tailandia"],
    ["Bangkok", "TH", "Tailandia"],
    ["Roma, Italia", "IT", "Italia"],
    ["Tailandia (Bangkok y Phuket)", "TH", "Tailandia"],
    ["Birmania", "MM", "Myanmar (Birmania)"],
    ["Islas Canarias", "ES", "España"],
  ])("%s → %s", (input, iso, nombre) => {
    const p = resolveCountry(input);
    expect(p?.iso2).toBe(iso);
    expect(p?.nombre).toBe(nombre);
  });

  it("sin país reconocible → null (nunca adivina)", () => {
    expect(resolveCountry("")).toBeNull();
    expect(resolveCountry("Narnia")).toBeNull();
    expect(resolveCountry("QQ")).toBeNull();
    expect(resolveCountry("EU")).toBeNull();
  });
});

describe("qué ficha corresponde a cada país", () => {
  const index = govukIndexFrom(govukIndex);
  it("índice real de GOV.UK: nombre + slug", () => {
    expect(index.find((c) => c.slug === "thailand")).toEqual({ name: "Thailand", slug: "thailand" });
  });
  it("GOV.UK: Tailandia → thailand, Estados Unidos → usa, Turquía → turkey; Reino Unido no aplica", () => {
    expect(govukSlugFor(resolveCountry("Tailandia")!, index)).toBe("thailand");
    expect(govukSlugFor(resolveCountry("Estados Unidos")!, index)).toBe("usa");
    expect(govukSlugFor(resolveCountry("Turquía")!, index)).toBe("turkey");
    expect(govukSlugFor(resolveCountry("Reino Unido")!, index)).toBeNull();
    // Sin índice (falló), se arma con el nombre en inglés.
    expect(govukSlugFor(resolveCountry("Japón")!, null)).toBe("japan");
  });
  it("State Dept: México ('Mexico Travel Advisory - …'), Birmania ('Burma'), Turquía ('Turkey'); EE. UU. no aplica", () => {
    const list = stateList as Parameters<typeof stateEntryFor>[1];
    expect(stateEntryFor(resolveCountry("México")!, list)?.Title).toMatch(/^Mexico Travel Advisory - Level 2/);
    expect(stateEntryFor(resolveCountry("Birmania")!, list)?.Title).toMatch(/^Burma - Level 4/);
    expect(stateEntryFor(resolveCountry("Turquía")!, list)?.Title).toMatch(/^Turkey - Level 2/);
    expect(stateEntryFor(resolveCountry("Estados Unidos")!, list)).toBeNull();
  });
});

describe("normalización con respuestas reales recortadas", () => {
  it("GOV.UK Tailandia: nivel FCDO, fecha, partes en texto plano recortadas, enlace y licencia", () => {
    const f = normalizeGovuk(govukThailand, "thailand", AT)!;
    expect(f).toMatchObject({
      fuente: "govuk", para_quien: "ciudadanos británicos", actualizado_at: "2026-10-12T10:20:34+01:00",
      url: "https://www.gov.uk/foreign-travel-advice/thailand", consultado_at: AT, idioma: "en", licencia: "Open Government Licence v3.0",
    });
    expect(f.nivel).toMatchObject({ valor: 1, escala: "fcdo", original: "avoid_all_but_essential_travel_to_parts" });
    expect(f.resumen).toMatch(/FCDO advises against all but essential travel/);
    expect(f.resumen).not.toMatch(/travel insurance could be invalidated/i); // línea genérica de todas las fichas
    expect(f.resumen).toMatch(/20km of the land border with Cambodia/);
    expect(f.resumen).not.toMatch(/<[a-z]/i);
    expect(f.secciones.entrada).toMatch(/passport must have an ‘expiry date’ at least 6 months/);
    for (const s of Object.values(f.secciones)) expect(s!.length).toBeLessThanOrEqual(701);
    expect(f.ultimo_cambio).toMatch(/visa requirements/);
  });
  it("GOV.UK España (sin zonas desaconsejadas) → nivel 0", () => {
    const f = normalizeGovuk(govukSpain, "spain", AT)!;
    expect(f.nivel).toMatchObject({ valor: 0, etiqueta: "No desaconseja viajar a ninguna zona" });
    expect(f.actualizado_at).toBe("2026-10-28T13:02:06+00:00");
  });
  it("State Dept Tailandia: nivel 1 de 4, resumen plano, fecha y enlace oficial", () => {
    const entry = (stateList as Array<{ Title: string }>).find((e) => e.Title.startsWith("Thailand"))!;
    const f = normalizeState(entry as never, AT)!;
    expect(f).toMatchObject({ fuente: "state_dept", para_quien: "ciudadanos estadounidenses", actualizado_at: "2026-07-06T20:00:00-04:00" });
    expect(f.nivel).toEqual({ valor: 1, escala: "1-4", etiqueta: "Nivel 1 de 4: precauciones normales", original: "Level 1: Exercise Normal Precautions" });
    expect(f.url).toMatch(/^https:\/\/travel\.state\.gov\/.*destination\.tha\.html$/);
    expect(f.resumen).toMatch(/Thai-Cambodian border/);
    expect(f.resumen).not.toMatch(/<[a-z]/i);
  });
  it("niveles: todos los del State Dept y los del FCDO, del más grave", () => {
    expect(stateLevel("Burma - Level 4: Do Not Travel").valor).toBe(4);
    expect(stateLevel("algo raro").valor).toBeNull();
    expect(govukLevel(["avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_whole_country"]).valor).toBe(3);
    expect(govukLevel(["nuevo_estado"]).valor).toBeNull();
  });
  it("htmlToText y clip: sin etiquetas ni entidades; recorta sin reescribir", () => {
    expect(htmlToText("<p>A &amp; B</p><ul><li>uno</li><li>dos</li></ul>")).toBe("A & B\n• uno\n• dos");
    const long = "Primera frase completa aquí. Segunda frase que no cabe en el límite indicado.";
    expect(clip(long, 40)).toBe("Primera frase completa aquí.…");
  });
});

describe("getTravelAdvisory: fuentes, fallos parciales y caché", () => {
  it("Tailandia: SRE primero, dos fuentes con fecha y para quién son", async () => {
    const { fetchImpl } = fakeFetch();
    const r = await getTravelAdvisory("Tailandia", { fetchImpl, store: memoryCacheStore(() => NOW), now: () => NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.para_mexicanos.url).toBe(SRE_URL);
    expect(r.fuentes.map((f) => [f.fuente, f.para_quien])).toEqual([["govuk", "ciudadanos británicos"], ["state_dept", "ciudadanos estadounidenses"]]);
    expect(r.fuentes.every((f) => f.actualizado_at && f.url && f.consultado_at === AT)).toBe(true);
    expect(r.fallas).toEqual([]);
    expect(r.traduccion_estado).toBe("no_solicitada");
    expect(r.aviso_legal).toBe("No sustituye asesoría migratoria, legal o consular.");
  });

  it("país no reconocido: lo dice y no consulta nada", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const r = await getTravelAdvisory("Narnia", { fetchImpl, store: memoryCacheStore(() => NOW), now: () => NOW });
    expect(r).toMatchObject({ ok: false, code: "pais_no_reconocido" });
    expect(calls).toEqual([]);
  });

  it("Estados Unidos: GOV.UK sí; el State Dept no aplica (y se dice)", async () => {
    const { fetchImpl } = fakeFetch();
    const r = await getTravelAdvisory("Estados Unidos", { fetchImpl, store: null, now: () => NOW });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.fuentes.map((f) => f.fuente)).toEqual(["govuk"]);
    expect(r.fallas).toEqual([expect.objectContaining({ fuente: "state_dept", motivo: "no_aplica" })]);
  });

  it("si GOV.UK falla, devuelve el State Dept y dice cuál falló (caché corta para reintentar)", async () => {
    const store = memoryCacheStore(() => NOW);
    const { fetchImpl } = fakeFetch({ [`${GOVUK_API}/japan`]: () => res({ error: "boom" }, 503) });
    const r = await getTravelAdvisory("Japón", { fetchImpl, store, now: () => NOW });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.fuentes.map((f) => f.fuente)).toEqual(["state_dept"]);
    expect(r.fallas).toEqual([{ fuente: "govuk", motivo: "error", mensaje: "No pudimos consultar GOV.UK ahora." }]);
    const row = [...store.rows.values()].find((x) => x.engine === "travel_advisory")!;
    expect(row.ttl_seconds).toBe(ADVISORY_PARTIAL_TTL_SECONDS);
  });

  it("si el State Dept se tarda, devuelve GOV.UK con motivo timeout", async () => {
    const timeout = () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
    const { fetchImpl } = fakeFetch({ [STATE_API]: timeout });
    const r = await getTravelAdvisory("España", { fetchImpl, store: null, now: () => NOW });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.fuentes.map((f) => f.fuente)).toEqual(["govuk"]);
    expect(r.fallas[0]).toMatchObject({ fuente: "state_dept", motivo: "timeout" });
  });

  it("caché compartida 6 h: la segunda consulta (otra persona) no sale a la red", async () => {
    const store = memoryCacheStore(() => NOW);
    const a = fakeFetch();
    await getTravelAdvisory("Tailandia", { fetchImpl: a.fetchImpl, store, now: () => NOW });
    expect(a.calls.length).toBe(3); // índice GOV.UK + ficha + lista State Dept
    const row = [...store.rows.values()].find((x) => x.engine === "travel_advisory")!;
    expect(row.ttl_seconds).toBe(ADVISORY_TTL_SECONDS);
    resetAdvisoryMemo();
    const b = fakeFetch();
    const r = await getTravelAdvisory("TH", { fetchImpl: b.fetchImpl, store, now: () => NOW + 3600_000 });
    expect(b.calls).toEqual([]);
    expect(r.ok && r.desde_cache).toBe(true);
    expect(r.ok && r.consultado_at).toBe(AT); // la fecha real de consulta, no la de ahora
  });

  it("vencida la caché y con las dos fuentes caídas: lo último guardado, marcado como guardado", async () => {
    const store = memoryCacheStore(() => NOW);
    await getTravelAdvisory("Tailandia", { fetchImpl: fakeFetch().fetchImpl, store, now: () => NOW });
    resetAdvisoryMemo();
    const down = () => res({}, 500);
    const { fetchImpl } = fakeFetch({ [GOVUK_API]: down, [`${GOVUK_API}/thailand`]: down, [STATE_API]: down });
    const later = NOW + 7 * 3600_000;
    const r = await getTravelAdvisory("Tailandia", { fetchImpl, store, now: () => later });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.guardado).toBe(true);
    expect(r.fuentes.length).toBe(2);
    expect(r.consultado_at).toBe(AT);
    expect(r.fallas.map((f) => f.fuente)).toEqual(["govuk", "state_dept"]);
  });

  it("sin caché y con las dos fuentes caídas: ok con cero fuentes y las dos fallas (sin inventar)", async () => {
    const down = () => res({}, 500);
    const { fetchImpl } = fakeFetch({ [GOVUK_API]: down, [`${GOVUK_API}/thailand`]: down, [STATE_API]: down });
    const r = await getTravelAdvisory("Tailandia", { fetchImpl, store: memoryCacheStore(() => NOW), now: () => NOW });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.fuentes).toEqual([]);
    expect(r.traduccion_estado).toBe("sin_fuentes");
    expect(r.fallas.length).toBe(2);
  });
});

describe("traducción fiel (Claude Haiku), cacheada con la versión de las fuentes", () => {
  const fuentes = (): AvisoFuente[] => [
    normalizeGovuk(govukThailand, "thailand", AT)!,
    normalizeState((stateList as Array<{ Title: string }>).find((e) => e.Title.startsWith("Thailand")) as never, AT)!,
  ];
  const good = JSON.stringify({
    puntos: [
      { texto: "El FCDO desaconseja viajar, salvo lo esencial, a zonas a menos de 20 km de la frontera con Camboya.", fuente: "govuk" },
      { texto: "EE. UU. pide mayor precaución cerca de la frontera con Camboya por riesgo de conflicto armado.", fuente: "state_dept" },
      { texto: "Hay inundaciones graves en varias provincias, incluida Bangkok.", fuente: "govuk" },
    ],
    secciones: { entrada: "Para pasaporte británico: el pasaporte debe vencer al menos 6 meses después de llegar." },
  });

  it("valida: puntos con fuente real; descarta cifras inventadas y fuentes inexistentes", () => {
    const raw = JSON.stringify({
      puntos: [
        { texto: "Debes pagar 300 dólares al entrar al país.", fuente: "govuk" }, // cifra que no está
        { texto: "Punto de una fuente que no existe aquí.", fuente: "sre" },
        { texto: "Hay inundaciones graves en varias provincias, incluida Bangkok.", fuente: "govuk" },
      ],
    });
    const t = parseTranslation(raw, fuentes(), "claude-haiku-5-5", NOW)!;
    expect(t.puntos).toEqual([{ texto: "Hay inundaciones graves en varias provincias, incluida Bangkok.", fuente: "govuk" }]);
    expect(parseTranslation("no es json", fuentes(), null)).toBeNull();
    expect(numbersFaithful("a 20 km", "within 20km of")).toBe(true);
    expect(numbersFaithful("a 25 km", "within 20km of")).toBe(false);
  });

  it("traduce una vez y la guarda; la siguiente consulta usa la traducción guardada sin llamar a la IA", async () => {
    const store = memoryCacheStore(() => NOW);
    const call = vi.fn(async () => ({ ok: true, text: good, model: "claude-haiku-5-5" }));
    const r1 = await getTravelAdvisory("Tailandia", { fetchImpl: fakeFetch().fetchImpl, store, now: () => NOW, translate: makeTranslator(call, undefined, () => NOW) });
    if (!r1.ok) throw new Error("esperaba ok");
    expect(r1.traduccion_estado).toBe("ok");
    expect(r1.traduccion?.puntos.length).toBe(3);
    expect(call).toHaveBeenCalledTimes(1);
    expect((call.mock.calls[0] as unknown[])[0]).toMatchObject({ model: "claude-haiku-5-5" });
    const r2 = await getTravelAdvisory("Tailandia", { fetchImpl: fakeFetch().fetchImpl, store, now: () => NOW + 60_000, translate: makeTranslator(call) });
    expect(call).toHaveBeenCalledTimes(1);
    expect(r2.ok && r2.traduccion?.puntos[0].fuente).toBe("govuk");
  });

  it("si la IA falla: traduccion null y estado 'fallo' (la UI muestra el original en inglés con aviso)", async () => {
    const call = vi.fn(async () => ({ ok: false, text: "", model: null }));
    const r = await getTravelAdvisory("Tailandia", { fetchImpl: fakeFetch().fetchImpl, store: memoryCacheStore(() => NOW), now: () => NOW, translate: makeTranslator(call) });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.traduccion).toBeNull();
    expect(r.traduccion_estado).toBe("fallo");
    expect(r.fuentes.length).toBe(2);
  });
});

describe("sonda de health-check (?action=avisos): sin IA ni caché", () => {
  it("cuenta países de GOV.UK y avisos del State Dept", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const p = await probeTravelAdvisories({ fetchImpl });
    expect(p.ok).toBe(true);
    expect(p.govuk.paises).toBe(govukIndexFrom(govukIndex).length);
    expect(p.state_dept.avisos).toBe((stateList as unknown[]).length);
    expect(calls.sort()).toEqual([GOVUK_API, STATE_API].sort());
  });
  it("una fuente caída → ok false con su estado", async () => {
    const { fetchImpl } = fakeFetch({ [STATE_API]: () => res({}, 503) });
    const p = await probeTravelAdvisories({ fetchImpl });
    expect(p.ok).toBe(false);
    expect(p.state_dept).toMatchObject({ ok: false, http: 503 });
  });
});

describe("traducción con espacio suficiente (caso Tailandia 28-oct)", () => {
  it("pide al modelo al menos 2,000 tokens para que el JSON no llegue cortado", async () => {
    let pedido = 0;
    const tr = makeTranslator(async ({ maxTokens }) => { pedido = maxTokens; return { ok: true, text: '{"puntos":[', model: "m" }; });
    const r = await tr([{ fuente: "govuk", fuente_nombre: "GOV.UK", para_quien: "ciudadanos británicos", nivel: { valor: 1, escala: "fcdo", etiqueta: "x", original: "x" }, resumen: "Some text here", secciones: {}, actualizado_at: null, url: "https://www.gov.uk", consultado_at: "2026-10-28T00:00:00Z" } as never], { nombre: "Tailandia", nombre_en: "Thailand" } as never);
    expect(pedido).toBeGreaterThanOrEqual(2000);
    expect(r).toBeNull(); // JSON cortado → null → la tarjeta muestra el original en inglés con aviso
  });
});
