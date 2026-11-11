// Mochilero CDMX → Bacalar «en autobús» (recorrido 11-nov-2026): solo había vuelos. El autobús va primero (sin precio
// inventado, con ADO), el vuelo más barato queda como otra opción; Bacalar y Tulum ya tienen ubicación (y aeropuerto cercano).
import { describe, expect, it } from "vitest";
import { wantsBus, withRequestedBus } from "../../supabase/functions/_shared/groundTransport";
import { nearestAirport, placeDistanceKm, placeIso2 } from "../../supabase/functions/_shared/airports";
import { parseMultiCityText } from "@/lib/multiCityText";

const vuelos = [
  { tier: "ahorro", aerolinea: "Viva", precio_por_persona: 2800, fuente_precio: "serpapi" },
  { tier: "equilibrio", aerolinea: "Aeroméxico", precio_por_persona: 3600, fuente_precio: "serpapi" },
  { tier: "premium", aerolinea: "Aeroméxico", precio_por_persona: 4800, fuente_precio: "serpapi" },
];
const links = { bus: "https://www.google.com/maps/dir/?api=1&travelmode=transit", ado: "https://www.ado.com.mx/x" };

describe("autobús pedido en un viaje largo dentro de México", () => {
  it("detecta que lo pidió en autobús", () => {
    expect(wantsBus("Lo que escribió el viajero: mochilero a Bacalar, lo más barato posible, hostales y transporte en autobús")).toBe(true);
    expect(wantsBus("viaje a Bacalar con mi pareja")).toBe(false);
  });
  it("el autobús va primero (ahorro, sin precio, ADO) y el vuelo barato pasa a otra opción; equilibrio y premium no cambian", () => {
    const out = withRequestedBus(vuelos, { origin: "Ciudad de México", destino: "Bacalar", links });
    expect(out[0]).toMatchObject({ tier: "ahorro", modo: "autobus", aerolinea: "Autobús ADO", precio_por_persona: 0, booking_link: links.ado, estado_dato: "ESTIMADO" });
    expect(out[0].duracion).toMatch(/h puerta a puerta/);
    expect(out.find((v) => v.aerolinea === "Viva")?.tier).toBe("alternativa");
    expect(out.filter((v) => v.tier === "equilibrio")).toHaveLength(1);
    expect(out).toHaveLength(4);
  });
  it("no se agrega si ya hay autobús, si es otro país o si no se conoce el lugar", () => {
    const conBus = [{ tier: "ahorro", modo: "autobus", aerolinea: "ADO" }, ...vuelos.slice(1)];
    expect(withRequestedBus(conBus, { origin: "Ciudad de México", destino: "Bacalar", links })).toEqual(conBus);
    expect(withRequestedBus(vuelos, { origin: "Ciudad de México", destino: "Madrid", links })).toEqual(vuelos);
    expect(withRequestedBus(vuelos, { origin: "Ciudad de México", destino: "Pueblo Inventado", links })).toEqual(vuelos);
  });
  it("Bacalar, Tulum, Huatulco… ya tienen ubicación: distancia, país y aeropuerto cercano", () => {
    expect(placeIso2("Bacalar")).toBe("MX");
    expect(placeDistanceKm("Ciudad de México", "Bacalar")).toBeGreaterThan(1000);
    expect(nearestAirport("Bacalar")?.airport).toBe("CTM");
    expect(placeIso2("Huatulco")).toBe("MX");
    expect(parseMultiCityText("Recorrido por la Riviera Maya: Tulum, Playa del Carmen y Bacalar").cities).toEqual(["Tulum", "Playa del Carmen", "Bacalar"]);
  });

  it("dijo «en autobús»: no se pregunta «¿coche o vuelo?» ni se pone «Vuelo» en la ruta", async () => {
    const { validateTripSpec } = await import("../../supabase/functions/_shared/tripSpec");
    const t = "Viaje de mochilero a Bacalar 4 noches del 15 al 19 de enero de 2027, voy solo, lo más barato posible, hostales y transporte en autobús";
    const r = validateTripSpec(JSON.stringify({
      origen: "Ciudad de México", paradas: [{ id: "p1", ciudad: "Bacalar", rol: "estancia", noches: 4, texto: "Bacalar" }],
      fecha_salida: "2027-01-15", fecha_regreso: "2027-01-19", viajeros: 1,
      preguntas: [{ id: "q1", tipo: "otro", texto: "regreso", pregunta: "¿Regresas a Ciudad de México desde Bacalar en coche o vuelo?", opciones: ["Coche", "Vuelo"] }],
    }), t);
    if (!r.ok) throw new Error("spec inválido");
    expect(r.spec.preguntas.filter((q) => !q.resuelta)).toEqual([]);
    expect(r.spec.paradas[0].llegada_por).not.toBe("vuelo");
  });
});
