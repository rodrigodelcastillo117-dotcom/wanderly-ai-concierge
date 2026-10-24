// placeResolve: qué es cada destino (Google Geocoding) y por qué ciudades se recorre (Wikidata), sin red:
// Geocoding con la forma documentada de su respuesta y Wikidata con respuestas reales guardadas
// (src/test/fixtures/placeResolve, consultadas el 24-oct-2026).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { createGoogleTransport } from "../../supabase/functions/_shared/google-maps";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import {
  classifyTypes, needsResolve, resolveDestination, resolveDestinations, WIKIDATA_UA, type PlaceDeps, type PlaceResolution,
} from "../../supabase/functions/_shared/placeResolve";
import { expandRegions, placeLookup } from "../../supabase/functions/_shared/regions";
import { applyRegionsToBody } from "../../supabase/functions/logistics-plan/regionsBody";
import { RegionBases } from "@/components/route/RegionBases";
import geocode from "./fixtures/placeResolve/geocode.json";
import wbsearch from "./fixtures/placeResolve/wbsearch.json";
import sparqlFR from "./fixtures/placeResolve/sparql_country_FR.json";
import sparqlBaviera from "./fixtures/placeResolve/sparql_region_baviera.json";
import sparqlRuta66 from "./fixtures/placeResolve/sparql_route_66.json";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function setup(opts: { wikidataDown?: boolean } = {}) {
  const calls = { geocode: [] as string[], wikidata: [] as string[], ua: [] as string[] };
  const googleFetch = vi.fn(async (url: string) => {
    const address = new URL(url).searchParams.get("address") ?? "";
    calls.geocode.push(address);
    const fx = (geocode as Record<string, unknown>)[strip(address)];
    return json(fx ?? { status: "ZERO_RESULTS", results: [] });
  });
  const wdFetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.wikidata.push(url);
    calls.ua.push(String((init?.headers as Record<string, string>)?.["User-Agent"] ?? ""));
    if (opts.wikidataDown) return new Response("Service Unavailable", { status: 503 });
    const u = new URL(url);
    if (u.hostname === "www.wikidata.org") {
      return json((wbsearch as Record<string, unknown>)[u.searchParams.get("search") ?? ""] ?? { search: [] });
    }
    const q = u.searchParams.get("query") ?? "";
    if (q.includes('wdt:P297 "FR"') && q.includes("wdt:P36")) return json(sparqlFR);
    if (q.includes("wdt:P150+") && q.includes("wd:Q980")) return json(sparqlBaviera);
    if (q.includes("wdt:P609") && q.includes("wd:Q79934")) return json(sparqlRuta66);
    return json({ results: { bindings: [] } });
  });
  const store = memoryCacheStore();
  const deps: PlaceDeps = {
    google: createGoogleTransport({ mapsKey: "llave-de-prueba", lovableKey: null, fetch: googleFetch as unknown as typeof fetch }),
    store,
    fetch: wdFetch as unknown as typeof fetch,
    log: () => {},
  };
  return { deps, calls, store, googleFetch, wdFetch };
}

describe("placeResolve: clasificación (tipos de Google Geocoding)", () => {
  it("país, región, ciudad, pueblo, lugar y carretera", () => {
    expect(classifyTypes(["country", "political"])).toBe("country");
    expect(classifyTypes(["administrative_area_level_1", "political"])).toBe("region");
    expect(classifyTypes(["colloquial_area", "political"])).toBe("region");
    expect(classifyTypes(["locality", "political"])).toBe("city");
    expect(classifyTypes(["administrative_area_level_3", "political"])).toBe("town");
    expect(classifyTypes(["natural_feature", "establishment"])).toBe("poi");
    expect(classifyTypes(["route"])).toBe("route");
  });
  it("lo que ya conocen la tabla curada o el catálogo de ciudades no se consulta", () => {
    expect(needsResolve("Toscana")).toBe(false);
    expect(needsResolve("Roma")).toBe(false);
    expect(needsResolve("Baviera")).toBe(true);
  });
});

describe("placeResolve: destinos del mundo con fuentes reales", () => {
  it("país → la capital primero y luego la ciudad más poblada (Francia, 4 noches → París y Lyon)", async () => {
    const { deps, calls } = setup();
    const r = await resolveDestination("Francia", deps);
    expect(r).toMatchObject({ status: "ok", kind: "country", name: "Francia", country: "FR", place_id: "prueba-francia" });
    expect(r.bases?.slice(0, 3)).toEqual(["París", "Lyon", "Toulouse"]);
    expect(r.wikidata).toEqual({ qid: "Q142", url: "https://www.wikidata.org/wiki/Q142" });
    expect(r.viewport).toEqual({ ne: { lat: 51.1, lng: 9.6 }, sw: { lat: 41.3, lng: -5.1 } });
    const body = { destinations: ["Francia"], nights_per_city: [4] };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["París", "Lyon"]);
    expect(body.nights_per_city).toEqual([2, 2]);
    expect(out.expansions).toEqual([{ region: "Francia", ciudades: ["París", "Lyon"], fuente: "wikidata" }]);
    expect(calls.ua.every((u) => u === WIKIDATA_UA)).toBe(true);
    expect(WIKIDATA_UA).toBe("IATOS/1.0 (https://traveliatos.life)");
  });

  it("región fuera de la tabla: Baviera → Múnich, Núremberg… (por población), sin repetir lo que ya está", async () => {
    const { deps } = setup();
    const body = { destinations: ["Viena", "Baviera"], nights_per_city: [2, 5] };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["Viena", "Múnich", "Núremberg", "Augsburgo"]);
    expect(body.nights_per_city).toEqual([2, 2, 2, 1]);
    expect(out.expansions[0]).toMatchObject({ region: "Baviera", fuente: "wikidata" });
    const again = { destinations: ["Múnich", "Baviera"], nights_per_city: [2, 3] };
    await applyRegionsToBody(again, (l) => resolveDestinations(l, deps));
    expect(again.destinations).toEqual(["Múnich", "Núremberg", "Augsburgo"]);
  });

  it("pueblo → se queda como ciudad intacta (sin Wikidata)", async () => {
    const { deps, calls } = setup();
    const body = { destinations: ["Viena", "Hallstatt"], nights_per_city: [3, 2] };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["Viena", "Hallstatt"]);
    expect(out).toEqual({ expansions: [], roadtrip: false, clarifications: [] });
    expect(calls.geocode).toEqual(["Hallstatt"]); // Viena es del catálogo: no se consulta
    expect(calls.wikidata).toEqual([]);
  });

  it("carretera con términos en Wikidata → paradas reales y road trip (Ruta 66 → Chicago · Santa Mónica)", async () => {
    const { deps } = setup();
    const body: any = { destinations: ["Ruta 66"], prefs: { transport_mode: "mixto", leg_modes: [] } };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["Chicago", "Santa Mónica"]);
    expect(out.roadtrip).toBe(true);
    expect(out.expansions).toEqual([{ region: "Ruta 66", ciudades: ["Chicago", "Santa Mónica"], fuente: "wikidata", tipo: "carretera" }]);
  });

  it("carretera sin paradas en Wikidata → queda como etiqueta y el viaje es road trip (sin inventar paradas)", async () => {
    const { deps } = setup();
    const body = { destinations: ["Puerto Montt", "Carretera Austral"] };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["Puerto Montt", "Carretera Austral"]);
    expect(out.roadtrip).toBe(true);
    expect(out.expansions).toEqual([]);
  });

  it("ambiguo → needs_clarification con candidatos reales; el destino no se adivina", async () => {
    const { deps } = setup();
    const r = await resolveDestination("Cordoba", deps);
    expect(r.status).toBe("needs_clarification");
    expect(r.candidates?.map((c) => c.label)).toEqual(["Córdoba, España", "Córdoba, Argentina"]);
    expect(r.candidates?.map((c) => c.country)).toEqual(["ES", "AR"]);
    expect(r.message).toBe("¿Te refieres a Córdoba, España o Córdoba, Argentina?");
    const body = { destinations: ["Madrid", "Cordoba"] };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["Madrid", "Cordoba"]);
    expect(out.clarifications[0].candidates).toHaveLength(2);
    const none = await resolveDestination("Xyzzy", deps);
    expect(none).toMatchObject({ status: "needs_clarification", candidates: [] });
    expect(none.message).toContain("No encontramos «Xyzzy»");
  });

  it("Wikidata caído → el destino queda intacto (y no se guarda nada de Wikidata)", async () => {
    const { deps, store } = setup({ wikidataDown: true });
    const body = { destinations: ["Francia", "Roma"], nights_per_city: [4, 3] };
    const out = await applyRegionsToBody(body, (l) => resolveDestinations(l, deps));
    expect(body.destinations).toEqual(["Francia", "Roma"]);
    expect(body.nights_per_city).toEqual([4, 3]);
    expect(out.expansions).toEqual([]);
    expect([...store.rows.values()].map((r) => r.engine)).toEqual(["gmaps_geocode"]);
    // Sin Google tampoco se inventa: "no disponible" y el destino sigue igual.
    const sinGoogle = await resolveDestination("Baviera", { ...deps, google: null, store: null });
    expect(sinGoogle.status).toBe("unavailable");
  });

  it("la tabla curada gana: Toscana no llega al resolvedor; un resolvedor que falla no rompe nada", async () => {
    const { deps, calls } = setup();
    const resolver = vi.fn((l: string[]) => resolveDestinations(l, deps));
    const body = { destinations: ["Roma", "Toscana"], nights_per_city: [3, 4] };
    const out = await applyRegionsToBody(body, resolver);
    expect(resolver).not.toHaveBeenCalled();
    expect(calls.geocode).toEqual([]);
    expect(body.destinations).toEqual(["Roma", "Florencia", "Siena"]);
    expect(out.expansions).toEqual([{ region: "Toscana", ciudades: ["Florencia", "Siena"] }]);
    const roto = { destinations: ["Baviera"] };
    expect((await applyRegionsToBody(roto, async () => { throw new Error("caído"); })).expansions).toEqual([]);
    expect(roto.destinations).toEqual(["Baviera"]);
  });

  it("la caché (30 días) evita repetir Geocoding y Wikidata para el mismo destino", async () => {
    const { deps, calls, store } = setup();
    await resolveDestination("Baviera", deps);
    expect(calls.geocode).toHaveLength(1);
    const wd = calls.wikidata.length;
    expect(wd).toBe(2); // wbsearchentities + 1 SPARQL
    const r2 = await resolveDestination("baviera", deps);
    expect(r2.bases?.[0]).toBe("Múnich");
    expect(calls.geocode).toHaveLength(1);
    expect(calls.wikidata).toHaveLength(wd);
    const ttl = [...store.rows.values()].map((r) => [r.engine, r.ttl_seconds]);
    expect(ttl).toEqual([["gmaps_geocode", 30 * 86400], ["wikidata_bases", 30 * 86400]]);
    // Dos destinos iguales en la misma petición: una sola consulta.
    const fresh = setup();
    await resolveDestinations(["Hallstatt", "hallstatt"], fresh.deps);
    expect(fresh.calls.geocode).toHaveLength(1);
  });
});

describe("RegionBases con lugares de place-resolve", () => {
  const francia: PlaceResolution = { input: "Francia", status: "ok", kind: "country", name: "Francia", bases: ["París", "Lyon", "Toulouse", "Niza"] };
  const cordoba: PlaceResolution = {
    input: "Cordoba", status: "needs_clarification", message: "¿Te refieres a Córdoba, España o Córdoba, Argentina?",
    candidates: [
      { label: "Córdoba, España", name: "Córdoba", kind: "city", country: "ES", country_name: "España", lat: 1, lng: 1, viewport: null, place_id: "a" },
      { label: "Córdoba, Argentina", name: "Córdoba", kind: "city", country: "AR", country_name: "Argentina", lat: 1, lng: 1, viewport: null, place_id: "b" },
    ],
  };
  function Harness({ onPick }: { onPick: (i: string, l: string) => void }) {
    const [choices, setChoices] = useState<Record<string, string[]>>({});
    return <RegionBases stops={["Roma", "Francia", "Cordoba"]} nights={[3, 4, 2]} choices={choices} onChange={setChoices} places={[francia, cordoba]} onPick={onPick} />;
  }
  it("muestra Francia → París · Lyon con las mismas chips y los candidatos del destino ambiguo", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const box = screen.getByTestId("region-bases");
    expect(box.textContent).toContain("Francia →");
    expect(box.textContent).toContain("París");
    expect(box.textContent).toContain("ciudades de Wikidata");
    fireEvent.click(screen.getByLabelText("Quitar Lyon"));
    fireEvent.click(screen.getByLabelText("Agregar Niza"));
    expect(screen.getByLabelText("Quitar Niza")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Elegir Córdoba, Argentina"));
    expect(onPick).toHaveBeenCalledWith("Cordoba", "Córdoba, Argentina");
  });
  it("las bases elegidas en la UI solo valen si están en la lista de Wikidata", () => {
    const lookup = placeLookup([francia]);
    expect(expandRegions(["Francia"], [4], { Francia: ["Niza", "Atlantis"] }, lookup).destinations).toEqual(["Niza"]);
    expect(expandRegions(["Francia"], [4], { Francia: ["Atlantis"] }, lookup).destinations).toEqual(["París", "Lyon"]);
  });
});
