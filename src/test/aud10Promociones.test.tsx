// Auditoría 10/10 (P0, 28-oct-2026): «Buscar promos» en el perfil respondía 500 "Claves de IA no
// configuradas" (exigía PERPLEXITY_API_KEY, que no existe) y leía la tabla vieja user_vault_benefits;
// la pantalla mostraba "Edge Function returned a non-2xx status code".
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import PromocionesActivas from "@/components/PromocionesActivas";
import {
  finalPromos, PROMO_TOOL, promoLines, promoRequest, searchResultUrls,
} from "../../supabase/functions/buscar-promociones/logic";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("buscar-promociones (servidor)", () => {
  it("usa Documentos y tarjetas y la IA configurada (Claude), no Perplexity ni la tabla vieja", () => {
    const src = read("supabase/functions/buscar-promociones/index.ts");
    expect(src).not.toMatch(/PERPLEXITY|perplexity/);
    expect(src).not.toMatch(/user_vault_benefits/);
    expect(src).toMatch(/from\("vault_items"\)\.select\("section, kind, title, tier, benefits"\)/);
    expect(src).toMatch(/ANTHROPIC_API_KEY/);
    expect(src).toMatch(/callClaudeWithFallback/);
    expect(src).not.toMatch(/Claves de IA no configuradas/);
  });

  it("solo manda nombre, nivel y beneficios de membresías, tarjetas y seguros (nunca documentos ni números)", () => {
    const lines = promoLines([
      { section: "documento", kind: "pasaporte", title: "Pasaporte G12345678" },
      { section: "tarjeta", kind: "tarjeta", title: "The Platinum Card® American Express (México)", tier: "Titular", benefits: [] },
      { section: "membresia", kind: "aerolinea", title: "Aeroméxico Rewards", tier: "Platino", benefits: ["Socio 123456789: salas VIP"] },
    ]);
    expect(lines.map((l) => l.programa)).toEqual(["The Platinum Card® American Express (México)", "Aeroméxico Rewards"]);
    expect(JSON.stringify(lines)).not.toMatch(/123456789|G12345678/);
  });

  it("pide la búsqueda web del servidor y la herramienta de entrega, sin forzarla", () => {
    const req = promoRequest(promoLines([{ section: "tarjeta", kind: "tarjeta", title: "BBVA Platinum" }]), {}, "2026-10-28");
    expect(req.tools[0]).toMatchObject({ type: "web_search_20260209", name: "web_search" });
    expect(req.tools[1]).toBe(PROMO_TOOL);
    expect(req.tool_choice).toEqual({ type: "auto" });
  });

  it("descarta promociones cuya fuente no salió de la búsqueda (nada inventado)", () => {
    const replies = [{
      stop_reason: "tool_use",
      content: [
        { type: "server_tool_use", name: "web_search" },
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.americanexpress.com/es-mx/beneficios/promociones/" }] },
        { type: "tool_use", name: "entregar_promociones", input: { resumen: "Una promoción vigente.", promociones: [
          { titulo: "Meses sin intereses en vuelos", proveedor: "American Express", categoria: "tarjeta", beneficio: "Hasta 12 MSI", como_activar: "Paga con tu tarjeta", url: "https://americanexpress.com/es-mx/beneficios/promociones" },
          { titulo: "2x1 inventado", proveedor: "Hotel X", categoria: "hotel", beneficio: "2x1", como_activar: "-", url: "https://hotel-x.example/promo" },
        ] } },
      ],
    }];
    expect(searchResultUrls(replies)).toHaveLength(1);
    const out = finalPromos(replies)!;
    expect(out.promociones.map((p) => p.titulo)).toEqual(["Meses sin intereses en vuelos"]);
    expect(out.promociones[0].vigencia).toBe("Revisa la vigencia en la fuente");
    expect(out.descartadas).toBe(1);
  });

  it("si el modelo declina o no entrega la herramienta, no hay resultado", () => {
    expect(finalPromos([{ stop_reason: "refusal", content: [] }])).toBeNull();
    expect(finalPromos([{ stop_reason: "end_turn", content: [{ type: "text" }] }])).toBeNull();
  });
});

describe("PromocionesActivas (pantalla)", () => {
  beforeEach(() => invoke.mockReset());

  it("si la función falla muestra el motivo en español, nunca el texto técnico", async () => {
    const body = JSON.stringify({ error: "ai_unavailable", code: "SERVICE_UNAVAILABLE", message: "La búsqueda de promociones no está disponible en este momento. Intenta de nuevo más tarde." });
    invoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(body, { status: 503 }) } });
    render(<PromocionesActivas />);
    fireEvent.click(screen.getByRole("button", { name: /Buscar promos/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("La búsqueda de promociones no está disponible en este momento.");
    expect(document.body.textContent).not.toMatch(/Edge Function|non-2xx/);
  });

  it("muestra cada promoción con su fuente y explica qué se manda a la IA", async () => {
    invoke.mockResolvedValue({ data: { resumen: "Una promoción vigente.", promociones: [
      { titulo: "MSI en vuelos", proveedor: "American Express", categoria: "tarjeta", beneficio: "Hasta 12 MSI", vigencia: "31 dic 2026", como_activar: "Paga con tu tarjeta", url: "https://www.americanexpress.com/es-mx/" },
    ], fuentes: [] }, error: null });
    render(<PromocionesActivas />);
    expect(screen.getByText(/nunca tus documentos ni tus números/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Buscar promos/ }));
    expect(await screen.findByText("MSI en vuelos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver fuente/ })).toHaveAttribute("href", "https://www.americanexpress.com/es-mx/");
  });
});
