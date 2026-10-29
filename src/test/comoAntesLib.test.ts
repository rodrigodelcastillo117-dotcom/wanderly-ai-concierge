// "Como antes" (Carlo, 29-oct-2026): reglas puras de la foto del viaje y del paso que sigue en Planear.
import { beforeEach, describe, expect, it } from "vitest";
import { destinationQuery, firstPlaceOf } from "@/lib/categoryImagery";
import { savedCoverUrl, tripPhotoPlace, tripPhotoQuery, tripVideoQuery } from "@/lib/tripImagery";
import { monthBounds, nextPlanStep, returnFor, routeConsultaFor, stashRouteConsulta } from "@/lib/planDirect";
import { buildLocalSpec, finalizeSpec } from "@/lib/tripSpecLocal";
import { parseMultiCityText } from "@/lib/multiCityText";
import { cachedStockPhoto, __resetStockPhotos } from "@/lib/stockPhoto";
import { setTripBasics, updateStop } from "../../supabase/functions/_shared/tripSpec";

const ctx = { origen: "Ciudad de México", fecha_salida: null, fecha_regreso: null, viajeros: null };
const spec = (q: string) => finalizeSpec(buildLocalSpec(q, ctx), q, ctx);

describe("foto del viaje", () => {
  it("la primera ciudad de una ruta, sin marcas de duplicado", () => {
    expect(firstPlaceOf("Tokio → Kioto → Osaka")).toBe("Tokio");
    expect(firstPlaceOf("Madrid → Córdoba → Sevilla…")).toBe("Madrid");
    expect(firstPlaceOf("Los Cabos (2)")).toBe("Los Cabos");
    expect(destinationQuery("Lisboa → Sintra → Oporto", "Portugal")).toBe("Lisboa Portugal travel");
  });
  it("viajes de Carlo: primera parada (itinerario o texto), país → su ciudad principal, frase → lo que nombra", () => {
    expect(tripPhotoQuery({ destino: "Tokio → Kioto → Osaka", pais_destino: "Japón" })).toBe("Tokio Japón travel");
    expect(tripPhotoQuery({ destino: "Nueva York → París → Madrid", pais_destino: "Estados Unidos" })).toBe("Nueva York Estados Unidos travel");
    expect(tripPhotoPlace({ destino: "Roma → Florencia → Venecia", itinerario_json: { destinations: ["Roma", "Florencia", "Venecia"] } })).toBe("Roma");
    expect(tripPhotoPlace({ destino: "España", pais_destino: "España" })).toBe("Madrid");
    expect(tripPhotoPlace({ destino: "Quiero conocer España 15 días, no sé qué ciudades. Del 4 al 19 de mayo de 2027", pais_destino: "España" })).toBe("Madrid");
    expect(tripPhotoPlace({ destino: "Oaxaca", pais_destino: "México" })).toBe("Oaxaca");
    expect(tripVideoQuery({ destino: "Tokio → Kioto → Osaka", pais_destino: "Japón" })).toBe("Tokio Japón travel");
    expect(tripPhotoQuery({ destino: "" })).toBeNull();
  });
  it("la portada guardada se muestra como antes (también la de Google); nada que no sea https", () => {
    expect(savedCoverUrl("https://lh3.googleusercontent.com/places/abc=s1600")).toBe("https://lh3.googleusercontent.com/places/abc=s1600");
    expect(savedCoverUrl("http://x.com/a.jpg")).toBeNull();
    expect(savedCoverUrl(null)).toBeNull();
  });
});

describe("foto ilustrativa guardada en el dispositivo", () => {
  beforeEach(() => { __resetStockPhotos(); localStorage.clear(); sessionStorage.clear(); });
  it("una foto encontrada en otra sesión se pinta sin volver a pedirla (7 días); un 'sin foto' no se guarda", () => {
    localStorage.setItem("iatos_stock_photo_ls_v1:tokio japón travel", JSON.stringify({ image: "https://images.pexels.com/photos/1/t.jpeg", photographer: "X", page_url: null, at: Date.now() }));
    expect(cachedStockPhoto("Tokio Japón travel")?.image).toBe("https://images.pexels.com/photos/1/t.jpeg");
    localStorage.setItem("iatos_stock_photo_ls_v1:lima perú travel", JSON.stringify({ image: "https://images.pexels.com/photos/2/l.jpeg", at: Date.now() - 8 * 86_400_000 }));
    expect(cachedStockPhoto("lima perú travel")).toBeUndefined();
    localStorage.setItem("iatos_stock_photo_ls_v1:roma italia travel", JSON.stringify({ image: "https://evil.example.com/x.jpg", at: Date.now() }));
    expect(cachedStockPhoto("roma italia travel")).toBeUndefined();
  });
});

describe("qué sigue después de entender el texto", () => {
  it("Sintra (pueblo del catálogo) ya es una parada: 'Lisboa → Sintra → Oporto' no pregunta nada", () => {
    expect(parseMultiCityText("Lisboa → Sintra → Oporto").items.map((i) => i.kind)).toEqual(["city", "city", "city"]);
    // "como" (palabra común) no se vuelve el lago de Como.
    expect(parseMultiCityText("Roma y Florencia, como base Florencia").cities).toEqual(["Roma", "Florencia"]);
  });
  it("varias ciudades sin pendientes → la ruta con el globo (con fechas, viajeros y origen)", () => {
    const s = spec("Lisboa → Sintra → Oporto del 3 al 12 de mayo de 2027 desde CDMX");
    const n = nextPlanStep(s, { presupuesto: 80000 });
    expect(n.kind).toBe("ruta");
    const qs = new URLSearchParams((n as { qs: string }).qs);
    expect(qs.get("destinos")).toBe("Lisboa|Sintra|Oporto");
    expect(qs.get("origin")).toBe("Ciudad de México");
    expect([qs.get("fecha_salida"), qs.get("fecha_regreso"), qs.get("presupuesto"), qs.get("auto")]).toEqual(["2027-05-03", "2027-05-12", "80000", "1"]);
  });
  it("sin fechas → paso corto (se preguntan, nunca se inventan)", () => {
    const n = nextPlanStep(spec("Tokio, Kioto y Osaka 10 días en abril desde CDMX"));
    expect(n.kind).toBe("preguntar");
    expect((n as { pendientes: { tipo: string }[] }).pendientes.map((q) => q.tipo)).toEqual(["fechas"]);
  });
  it("una ciudad completa → cotización directa; un tramo en tren elegido → cotización directa (la ruta no lo lleva)", () => {
    expect(nextPlanStep(spec("Oaxaca del 12 al 16 de diciembre, 2 personas")).kind).toBe("cotizar");
    let s = setTripBasics(spec("Roma y Florencia"), { fecha_salida: "2027-05-03", fecha_regreso: "2027-05-10" });
    expect(nextPlanStep(s).kind).toBe("ruta");
    s = updateStop(s, s.paradas[1].id, { llegada_por: "tren" });
    expect(nextPlanStep(s).kind).toBe("cotizar");
  });
  it("'10 días en abril': regreso con esas noches y salida dentro del mes", () => {
    expect(returnFor("2027-04-03", 9)).toBe("2027-04-12");
    expect(returnFor(null, 9)).toBeNull();
    expect(monthBounds({ month: 3, year: 2027 })).toEqual({ min: "2027-04-01", max: "2027-04-30" });
  });
  it("el texto y lo entendido viajan a la ruta y se guardan en el viaje que se genere ahí", () => {
    sessionStorage.clear();
    const s = spec("Tokio, Kioto y Osaka 10 días en abril desde CDMX");
    stashRouteConsulta(s, ["Tokio", "Kioto", "Osaka"], "hoteles boutique");
    const r = routeConsultaFor(["Tokio", "Osaka", "Hiroshima"]);
    expect(r?.consulta.consulta_original).toBe("Tokio, Kioto y Osaka 10 días en abril desde CDMX");
    expect(r?.consulta.interpretacion.paradas.map((p) => p.ciudad)).toEqual(["Tokio", "Osaka", "Hiroshima"]);
    expect(r?.notas).toBe("hoteles boutique");
    expect(routeConsultaFor(["París", "Roma"])).toBeNull(); // otra ruta: no se le pega un texto ajeno
  });
});
