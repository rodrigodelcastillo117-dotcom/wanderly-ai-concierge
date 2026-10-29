// Auditoría 10/10 (herramientas, 28-oct-2026) · Documentos y tarjetas:
//  P1-2  la alerta del pasaporte que vence durante el viaje a Tokio no salía (se recortaban 6 viajes antes
//        de descartar los nacionales).
//  P1-3 (técnica) el enlace de la SRE apuntaba a un dominio que ya no existe.
//  P2-3  el resumen de Iato mostraba Markdown crudo («**Aeropuerto**», «* …»).
//  P2-4  "bóveda" en textos visibles.
//  P2-5  The Platinum Card sin nivel se veía como si tuviera beneficios.
//  P1-12 desbordes de listas en 390 px (FriendsPrivacySection, PartnerOffers, Cercanos).
import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boveda/api", () => ({
  summarizeWithIato: vi.fn(async () => "¡Listo!\n\n**Aeropuerto**\n* Acceso a salas SkyTeam.\n* Entrega prioritaria de equipaje.\n\nConfirma condiciones con cada programa antes de viajar."),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { buildAlerts, SRE_GUIDE, type TripLite } from "@/lib/boveda/alerts";
import { benefitsStatus } from "@/lib/boveda/catalog";
import type { VaultItem } from "@/lib/boveda/types";
import { SummarySheet } from "@/components/boveda/SummarySheet";
import { WalletCard } from "@/components/boveda/WalletCard";
import { ItemFormSheet } from "@/components/boveda/ItemFormSheet";
import { SRE_URL } from "../../supabase/functions/_shared/travelAdvisories";
import { SRE_GUIA_VIAJERO_URL } from "@/components/AiDataNotice";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const item = (over: Partial<VaultItem>): VaultItem => ({
  id: "i1", user_id: "u", section: "documento", kind: "pasaporte", program_id: null, tier_id: null, title: "Pasaporte",
  issuer: null, tier: null, number: null, holder_name: null, country_code: "MX", visa_type: null, entries: null,
  valid_from: null, expires_on: null, contact_phone: null, benefits: [], benefits_unverified: false, notes: null,
  created_at: "", updated_at: "", ...over,
});

describe("P1-2 alerta del pasaporte con viajes nacionales antes", () => {
  const mx = (i: number): TripLite => ({ id: `mx${i}`, destino: ["Valle de Bravo", "Oaxaca", "Mérida", "Tulum", "Puebla", "Los Cabos", "Guanajuato"][i], pais_destino: "México", fecha_salida: `2026-11-0${i + 1}`, fecha_regreso: `2026-11-0${i + 2}` });
  const trips: TripLite[] = [...Array.from({ length: 7 }, (_, i) => mx(i)), { id: "tyo", destino: "Tokio", pais_destino: "Japón", fecha_salida: "2027-02-10", fecha_regreso: "2027-02-20" }];

  it("avisa que el pasaporte vence durante el viaje a Tokio", () => {
    const alerts = buildAlerts([item({ id: "pp", expires_on: "2027-02-15" })], trips, "2026-10-28");
    const pp = alerts.find((a) => a.id.startsWith("pp-exp-"));
    expect(pp?.level).toBe("critica");
    expect(pp?.title).toBe("Tu pasaporte vence durante tu viaje a Tokio");
  });

  it("separa 'vence durante' (Tokio) de 'vence antes' (Lisboa)", () => {
    const withLisboa = [...trips, { id: "lis", destino: "Lisboa", pais_destino: "Portugal", fecha_salida: "2027-03-10", fecha_regreso: "2027-03-15" }];
    const titles = buildAlerts([item({ id: "pp", expires_on: "2027-02-15" })], withLisboa, "2026-10-28").map((a) => a.title);
    expect(titles).toContain("Tu pasaporte vence durante tu viaje a Tokio");
    expect(titles).toContain("Tu pasaporte vence antes de tu viaje a Lisboa");
  });

  it("sin pasaporte guardado pide agregarlo para Tokio", () => {
    const alerts = buildAlerts([], trips, "2026-10-28");
    expect(alerts.some((a) => a.title === "Agrega tu pasaporte para Tokio")).toBe(true);
  });
});

describe("P1-3 enlace de la SRE vigente", () => {
  it("todas las pantallas y funciones usan www.gob.mx/guiadeviaje", () => {
    expect(SRE_GUIDE.url).toBe("https://www.gob.mx/guiadeviaje");
    expect(SRE_URL).toBe("https://www.gob.mx/guiadeviaje");
    expect(SRE_GUIA_VIAJERO_URL).toBe("https://www.gob.mx/guiadeviaje");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(join(root, dir))) {
        const p = `${dir}/${f}`;
        if (statSync(join(root, p)).isDirectory()) { if (f !== "node_modules") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || p.endsWith("_shared/sre.ts") || p.includes("/test/")) continue;
        if (read(p).includes("guiadelviajero.sre.gob.mx")) offenders.push(p);
      }
    };
    walk("src");
    walk("supabase/functions");
    expect(offenders).toEqual([]);
  });
});

describe("P2-3 el resumen de Iato se ve con formato", () => {
  it("no muestra asteriscos crudos", async () => {
    const items = [item({ id: "m", section: "membresia", kind: "aerolinea", title: "Aeroméxico Rewards", program_id: "aeromexico-rewards", tier_id: "skyteam-elite-plus" })];
    render(<SummarySheet open onOpenChange={() => {}} items={items} trips={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Resumir/ }));
    const box = await screen.findByTestId("vault-summary");
    expect(box.textContent).not.toMatch(/\*/);
    expect(box.querySelector("strong")?.textContent).toBe("Aeropuerto");
    expect(box.querySelectorAll("li").length).toBe(2);
  });
});

describe("P2-4 sin 'bóveda' en lo que se ve", () => {
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const VISIBLE = /(["'`>])[^"'`<>{}]*\bbóveda\b[^"'`<>{}]*(["'`<])/gi;
  it.each([
    "src/pages/Benefits.tsx", "src/components/boveda/ItemDetailSheet.tsx", "src/components/boveda/ItemFormSheet.tsx",
    "src/components/boveda/AlertsPanel.tsx", "src/components/boveda/BenefitsBlock.tsx", "src/components/BenefitsVault.tsx",
    "src/lib/boveda/alerts.ts",
  ])("%s", (f) => {
    expect([...code(read(f)).matchAll(VISIBLE)].map((m) => m[0])).toEqual([]);
  });
});

describe("P2-5 tarjeta sin beneficios verificados", () => {
  const amex = item({ id: "a", section: "tarjeta", kind: "tarjeta", program_id: "amex-platinum-mx", tier_id: null, title: "The Platinum Card® American Express (México)", number: "0000", country_code: null });

  it("sin nivel no se presenta como si tuviera beneficios", () => {
    expect(benefitsStatus(amex)).toBe("ninguno");
    expect(benefitsStatus({ ...amex, tier_id: "titular" })).toBe("verificados");
    render(<WalletCard item={amex} revealed={false} filesCount={0} hasPdf={false} onOpen={() => {}} onToggleReveal={() => {}} onCopy={() => {}} />);
    expect(screen.getByTestId("wallet-sin-beneficios")).toHaveTextContent("Sin beneficios verificados");
  });

  it("al elegir un programa con un solo nivel, el nivel se elige solo", async () => {
    render(<ItemFormSheet open editing={null} initialKind="tarjeta" defaultSection="tarjeta" onOpenChange={() => {}} onSave={async () => {}} />);
    const program = await screen.findByLabelText("Tarjeta o banco");
    fireEvent.change(program, { target: { value: "amex-platinum-mx" } });
    await waitFor(() => expect((document.getElementById("vf-tierid") as HTMLSelectElement | null)?.value).toBe("titular"));
  });
});

describe("P1-12 listas que no se salen a 390 px", () => {
  it.each([
    ["src/components/social/FriendsPrivacySection.tsx", '<ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">'],
    ["src/components/boveda/PartnerOffers.tsx", 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'],
    ["src/pages/Cercanos.tsx", '<ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Lugares cercanos">'],
  ])("%s define la columna de celular (minmax(0,1fr))", (f, cls) => {
    expect(read(f)).toContain(cls);
  });
});
