// Defecto 17 (E2E 28-oct-2026): palabras técnicas visibles para una persona normal ("SerpApi",
// "Perplexity", "Bóveda"/"Vault", "Travel DNA", "Fixer"). Solo cambian los textos visibles: rutas, tablas y
// Privé se quedan igual.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plainProviderText } from "@/lib/provenance";
import { FIXER_LINE, FREE_FEATURES, PRO_FEATURES } from "@/lib/planCopy";
import { incompleteReplyText } from "@/lib/conciergeStream";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
// Quita comentarios para revisar solo lo que se muestra.
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
// Texto dentro de comillas o entre etiquetas JSX.
const VISIBLE = /(["'`>])[^"'`<>{}]*\b(Travel ?DNA|Bóveda|Vault|Fixer|SerpApi|Perplexity)\b[^"'`<>{}]*(["'`<])/g;
// Lo que solo lee el equipo (asunto del correo / WhatsApp interno) y el ícono `Vault` de lucide: no se ven como texto.
const STAFF_ONLY = /Solicitud Fixer IATOS|IATOS Fixer|icon: Vault/;

const FILES = [
  "src/components/DashboardLayout.tsx", "src/pages/DashboardHome.tsx", "src/components/FixerButton.tsx", "src/components/ActionButton.tsx",
  "src/components/concierge/ConciergeCards.tsx", "src/lib/conciergeStream.ts", "src/lib/conciergeChips.ts", "src/lib/planCopy.ts",
  "src/components/plan/TripSpecReview.tsx", "src/components/PromocionesActivas.tsx", "src/components/BenefitsVault.tsx", "src/pages/Benefits.tsx",
  "src/pages/Profile.tsx", "src/pages/Onboarding.tsx", "src/pages/FriendProfile.tsx", "src/pages/Social.tsx", "src/pages/TripPacking.tsx",
  "src/components/lux/TravelDNAStats.tsx", "src/components/booking/RealPriceButtons.tsx",
];

describe("sin palabras técnicas en lo que se ve", () => {
  it.each(FILES)("%s", (f) => {
    const hits = [...code(read(f)).matchAll(VISIBLE)].map((m) => m[0]).filter((t) => !STAFF_ONLY.test(t));
    expect(hits).toEqual([]);
  });

  it("textos clave con nombres comprensibles", () => {
    expect(FIXER_LINE).toBe("Nuestro equipo humano pide tus mesas de Members Only, sujeto a disponibilidad");
    expect([...FREE_FEATURES, ...PRO_FEATURES].join(" ")).toMatch(/perfil de viajero/);
    expect(incompleteReplyText("", "Iato no pudo responder.")).toMatch(/Hablar con una persona/);
  });

  it("el análisis de la IA no muestra 'SerpApi' ni 'Perplexity'", () => {
    const t = "Los vuelos y hoteles salen de tarifas consultadas en Google Flights y Google Hotels vía SerpApi (28 de octubre de 2026).";
    expect(plainProviderText(t)).toBe("Los vuelos y hoteles salen de tarifas consultadas en Google Flights y Google Hotels (28 de octubre de 2026).");
    expect(plainProviderText("Fuente: SerpApi / Google Hotels")).toBe("Fuente: Google Hotels");
    expect(plainProviderText("Según Perplexity, el museo abre a las 10.")).toBe("Según una búsqueda web, el museo abre a las 10.");
  });

  it("Privé no se toca (sus textos siguen igual)", () => {
    expect(read("src/lib/priveValueI18n.ts")).toMatch(/Ir a mi Bóveda/);
  });
});
