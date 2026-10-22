// R10 Privé (ensayo en producción, 22-oct-2026): Iato devolvió para "Blue Bay Marcel Ravin" un botón
// "Solicitar" que abría https://iatos.ai/ — un dominio inventado por el modelo que ni existe
// (NXDOMAIN) y que cualquiera podría registrar. Un enlace del modelo solo se muestra si su dominio
// salió de una herramienta de este turno o es de IATOS.
import { describe, expect, it } from "vitest";
import { collectEvidence, hostBacked, validateCards } from "../../supabase/functions/concierge-chat/cards";

// Resultado de search_prive tal como lo ve el modelo (recortado).
const PRIVE_RUN = {
  name: "search_prive",
  result: {
    disponible: true,
    results: [
      { name: "Blue Bay Marcel Ravin", state: "CURADO", booking_url: "https://www.montecarlosbm.com/en/restaurant-monaco/blue-bay-marcel-ravin",
        sources: ["https://guide.michelin.com/mc/es/x"] },
    ],
  },
};

describe("enlaces de las cards de Iato", () => {
  it("quita el enlace a un dominio que ninguna herramienta trajo (caso iatos.ai) pero deja la card", () => {
    const ev = collectEvidence([PRIVE_RUN]);
    const out = validateCards([
      { type: "restaurant", title: "Blue Bay Marcel Ravin", meta: "Precio y horario por confirmar", cta_label: "Solicitar", cta_action: "https://iatos.ai/" },
    ], ev);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].cta_action).toBeUndefined();
    expect(out.cards[0].cta_label).toBe("Solicitar"); // queda como solicitud dentro de la app
  });

  it("conserva el enlace oficial que trajo la herramienta (con o sin www)", () => {
    const ev = collectEvidence([PRIVE_RUN]);
    expect(ev.hosts).toEqual(expect.arrayContaining(["montecarlosbm.com", "guide.michelin.com"]));
    const out = validateCards([
      { type: "restaurant", title: "Blue Bay", cta_action: "https://montecarlosbm.com/en/restaurant-monaco/blue-bay-marcel-ravin" },
    ], ev);
    expect(out.cards[0].cta_action).toBe("https://montecarlosbm.com/en/restaurant-monaco/blue-bay-marcel-ravin");
  });

  it("acepta los dominios de IATOS y rechaza imitaciones por sufijo", () => {
    const ev = collectEvidence([PRIVE_RUN]);
    expect(hostBacked("https://traveliatos.life/prive/solicitudes", ev)).toBe(true);
    expect(hostBacked("https://montecarlosbm.com.evil.io/x", ev)).toBe(false);
    expect(hostBacked("https://evilmontecarlosbm.com/x", ev)).toBe(false);
    expect(hostBacked("https://iatos.ai/", ev)).toBe(false);
  });

  it("sin herramientas disponibles en el turno no sale ningún enlace externo", () => {
    const ev = collectEvidence([{ name: "search_attractions", result: { disponible: false, motivo: "no disponible" } }]);
    const out = validateCards([{ type: "attraction", title: "Casino de Monte-Carlo", cta_action: "https://www.montecarlosbm.com/" }], ev);
    expect(out.cards[0].cta_action).toBeUndefined();
  });
});
