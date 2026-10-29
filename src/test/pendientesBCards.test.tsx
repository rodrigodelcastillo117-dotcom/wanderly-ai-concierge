// Pendiente E2E 28-oct-2026: al recargar el chat de Iato se perdían las tarjetas (restaurantes,
// tours, eventos, vuelos) y sus botones; solo quedaba el texto. Ahora concierge-chat guarda las cards
// ya validadas junto al turno (concierge_conversations.messages, jsonb, sin migración) y el cliente
// las vuelve a pintar; un precio viejo sale como "precio guardado" con su hora, nunca "en vivo".
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), functions: { invoke: vi.fn() } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { RichCard } from "@/components/concierge/ConciergeCards";
import { restoreConversation } from "@/lib/conciergeHistory";
import {
  cardsForStorage, restoreStoredCards, MAX_STORED_CARDS, MAX_STORED_CARDS_BYTES,
} from "../../supabase/functions/concierge-chat/storedCards.ts";
import type { ConciergeCard } from "../../supabase/functions/concierge-chat/cards.ts";

const NOW = new Date("2026-10-28T18:00:00Z").getTime();
const hace = (min: number) => new Date(NOW - min * 60_000).toISOString();

// Lo que validó el servidor en el turno (validateCards + enrichCardLinks + tourCards + eventCards).
const VUELO: ConciergeCard = {
  type: "flight", title: "Aeroméxico", subtitle: "MEX → MAD · solo ida", price: 937, price_usd: 937, currency: "USD",
  fuente: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: hace(180), cta_label: "Comprar",
  cta_action: "https://www.google.com/travel/flights/booking?tfs=abc", price_basis: "por persona · solo ida",
};
const RESTAURANTE: ConciergeCard = {
  type: "restaurant", title: "Contramar", subtitle: "Roma Norte, CDMX", fuente: "google_maps",
  links: [
    { kind: "website", label: "Reservar en su sitio", url: "https://contramar.com.mx/" },
    { kind: "call", label: "Llamar", url: "tel:+525555143169" },
    { kind: "directions", label: "Cómo llegar", url: "https://www.google.com/maps/dir/?api=1&destination=19.41,-99.16" },
  ],
  lat: 19.41, lng: -99.16,
};
const TOUR: ConciergeCard = {
  type: "tour", title: "Coliseo con guía", subtitle: "3 h", fuente: "viator", provider: "Viator", consultado_at: hace(300),
  price: 1234, currency: "MXN", price_basis: "desde", cta_label: "Ver en Viator",
  cta_action: "https://www.viator.com/tours/Rome/Colosseum/d511-12345P1",
};
const EVENTO: ConciergeCard = {
  type: "event", title: "La Traviata", subtitle: "mié 9 dic · 19:30", fuente: "google_events", consultado_at: hace(60),
  links: [{ kind: "tickets", label: "Boletos en Teatro Real", url: "https://www.teatroreal.es/es/espectaculo/traviata" }],
};

describe("cards guardadas con el turno (concierge-chat → concierge_conversations.messages)", () => {
  it("concierge-chat guarda las cards validadas del turno junto al texto del asistente", () => {
    const src = readFileSync("supabase/functions/concierge-chat/index.ts", "utf8");
    expect(src).toMatch(/replyText: final\.text, replyCards: final\.cards/);
    expect(src).toMatch(/const cards = cardsForStorage\(p\.replyCards, now\)/);
    expect(src).toMatch(/\{ role: "assistant", content: p\.replyText, timestamp: now, \.\.\.\(cards \? \{ cards \} : \{\}\) \}/);
    // El modelo nunca las lee: la memoria solo toma role y content.
    const prompt = readFileSync("supabase/functions/concierge-chat/prompt.ts", "utf8");
    expect(prompt).toMatch(/\.map\(\(m: any\) => \(\{ role: m\.role as string, content:/);
  });

  it("se guardan las mismas cards (con botones) y nada más: sin enlaces inseguros ni llaves extra", () => {
    const sucia = { ...RESTAURANTE, inventado: "x", links: [...RESTAURANTE.links!, { kind: "website", label: "x", url: "javascript:alert(1)" }], cta_action: "http://inseguro.test" } as any;
    const out = cardsForStorage([VUELO, sucia, TOUR, EVENTO, { type: "desconocido", title: "x" }, { type: "flight" }], hace(0))!;
    expect(out.map((c) => c.type)).toEqual(["flight", "restaurant", "tour", "event"]);
    expect(out[0]).toEqual(VUELO);
    expect(out[1].links!.map((l) => l.url)).toEqual(RESTAURANTE.links!.map((l) => l.url));
    expect(out[1]).not.toHaveProperty("inventado");
    expect(out[1]).not.toHaveProperty("cta_action");
    expect(cardsForStorage([])).toBeUndefined();
    expect(cardsForStorage(null)).toBeUndefined();
  });

  it("tope por mensaje: cantidad y tamaño", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...RESTAURANTE, title: `Lugar ${i}` }));
    expect(cardsForStorage(many)!.length).toBe(MAX_STORED_CARDS);
    const big = Array.from({ length: 12 }, (_, i) => ({ type: "place", title: `Lugar ${i}`, subtitle: "x".repeat(160), meta: "y".repeat(200), body: "z".repeat(600), booking_note: "w".repeat(200), links: RESTAURANTE.links }));
    const kept = cardsForStorage(big)!;
    expect(new TextEncoder().encode(JSON.stringify(kept)).length).toBeLessThanOrEqual(MAX_STORED_CARDS_BYTES);
    expect(kept.length).toBeLessThan(12);
    expect(cardsForStorage(big, hace(0), 3000)!.length).toBeLessThan(kept.length);
    expect(kept[0].title).toBe("Lugar 0"); // se quitan las últimas
  });

  it("un precio sin fecha de consulta toma la hora del turno (nunca queda 'sin fecha' ni 'en vivo' para siempre)", () => {
    const [c] = cardsForStorage([{ ...TOUR, consultado_at: undefined }], hace(10))!;
    expect(c.consultado_at).toBe(hace(10));
  });
});

describe("al recargar: se repintan y los precios viejos se marcan con su hora de consulta", () => {
  const stored = [
    { role: "user", content: "Vuelo a Madrid, dónde cenar y qué hacer en Roma", timestamp: hace(181) },
    { role: "assistant", content: "Esto es lo que encontré:", timestamp: hace(180), cards: cardsForStorage([VUELO, RESTAURANTE, TOUR, EVENTO], hace(180)) },
    { role: "user", content: "gracias", timestamp: hace(2) },
    { role: "assistant", content: "Con gusto.", timestamp: hace(1) },
  ];

  it("restoreConversation devuelve las cards del turno del asistente", () => {
    const msgs = restoreConversation(stored, 20, NOW);
    expect(msgs.map((m) => m.cards?.length ?? 0)).toEqual([0, 4, 0, 0]);
    expect(msgs[1].cards!.map((c) => c.title)).toEqual(["Aeroméxico", "Contramar", "Coliseo con guía", "La Traviata"]);
  });

  it("vuelo consultado hace 3 h: pasa a 'precio guardado' con su fecha y hora; uno de hace 5 min sigue en vivo", () => {
    const [v] = restoreStoredCards([VUELO], NOW);
    expect(v.estado_dato).toBe("OBSOLETO");
    expect(v.price_note).toBe("precio guardado");
    expect(v.consultado_at).toBe(VUELO.consultado_at);
    const [fresh] = restoreStoredCards([{ ...VUELO, consultado_at: hace(5) }], NOW);
    expect(fresh.estado_dato).toBe("CONSULTADO_EN_VIVO");
  });

  it("tour con precio viejo: la nota dice 'Precio guardado (consultado …) · verifícalo'", () => {
    const [t] = restoreStoredCards([TOUR], NOW);
    expect(t.price_note).toMatch(/^Precio guardado \(consultado .+\) · verifícalo$/);
  });

  it("se limpian otra vez al restaurar (el historial es editable por su dueño)", () => {
    const [r] = restoreStoredCards([{ ...RESTAURANTE, links: [{ kind: "website", label: "x", url: "javascript:alert(1)" }], image_url: "data:text/html,x" }], NOW);
    expect(r.links).toBeUndefined();
    expect(r.image_url).toBeUndefined();
  });

  it("RichCard repintada: el vuelo viejo NO dice 'en vivo' y muestra 'Precio guardado · <fecha y hora> · verifícalo'", () => {
    const [v] = restoreConversation(stored, 20, NOW)[1].cards!;
    render(<RichCard card={v} />);
    const badge = screen.getByText(/Precio guardado/);
    const hora = new Date(VUELO.consultado_at!).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    expect(badge.textContent).toContain(hora);
    expect(badge.textContent).toMatch(/verifícalo/);
    expect(document.body.textContent).not.toMatch(/en vivo/i);
    expect(document.body.textContent).toMatch(/precio guardado/);
  });

  it("RichCard repintada: el restaurante conserva sus botones (sitio, llamar, cómo llegar)", () => {
    const r = restoreConversation(stored, 20, NOW)[1].cards![1];
    const { container } = render(<RichCard card={r} />);
    // Ola 9.5: los botones secundarios están en "Más opciones" (no se quita ninguno).
    fireEvent.click(within(container).getByRole("button", { name: "Más opciones" }));
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["https://contramar.com.mx/", "tel:+525555143169"]));
    expect(within(container).getByText("Contramar")).toBeInTheDocument();
  });
});
