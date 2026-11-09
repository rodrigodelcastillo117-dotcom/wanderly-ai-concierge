// Recorrido en producción (9-nov-2026, Madrid → París → Roma): tres tardes del itinerario mostraban como titular
// «Porque te encantó la comida del mercado en tus viajes» en vez de la actividad. El titular ahora es la actividad.
import { describe, expect, it } from "vitest";
import { daySlots, sinPorqueInicial } from "@/lib/itineraryDay";

describe("titular de una franja con porqué personal al inicio", () => {
  it.each([
    ["Porque te encantó la comida del mercado en tus viajes, recorrido gastronómico por el Mercado de San Miguel y el Mercado de San Antón.", "Recorrido gastronómico por el Mercado de San Miguel y el Mercado de San Antón."],
    ["Porque te fascina la cocina de mercado, visita al animado Mercato di Testaccio o Campo de' Fiori.", "Visita al animado Mercato di Testaccio o Campo de' Fiori."],
    ["Porque te encantó descubrir sabores auténticos, visita al Marché des Enfants Rouges en Le Marais.", "Visita al Marché des Enfants Rouges en Le Marais."],
    ["Como en tu viaje a Kioto, templos al amanecer en Montmartre.", "Templos al amanecer en Montmartre."],
  ])("«%s»", (txt, esperado) => {
    expect(sinPorqueInicial(txt)).toBe(esperado);
  });

  it("sin porqué al inicio, o sin actividad después, el texto queda igual", () => {
    expect(sinPorqueInicial("Paseo por el Retiro, porque te encantó el Central Park")).toBe("Paseo por el Retiro, porque te encantó el Central Park");
    expect(sinPorqueInicial("Porque te encantó, sí")).toBe("Porque te encantó, sí");
  });

  it("en el día del itinerario el titular es la actividad y el texto completo se conserva", () => {
    const tarde = "Porque te encantó la comida del mercado en tus viajes, recorrido gastronómico por el Mercado de San Miguel.";
    const [s] = daySlots({ dia: 2, ciudad: "Madrid", tarde });
    expect(s.headline).not.toMatch(/^Porque/);
    expect(s.headline).toMatch(/^Recorrido gastronómico/);
    expect(s.text).toBe(tarde);
  });
});
