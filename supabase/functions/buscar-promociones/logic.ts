// buscar-promociones: lógica pura (Vitest, sin Deno).
//
// Auditoría 10/10 (P0, 28-oct-2026): la función respondía 500 "Claves de IA no configuradas" porque
// exigía PERPLEXITY_API_KEY (no existe en producción) y leía la tabla vieja user_vault_benefits, que ya no
// es la fuente: lo que la persona guarda vive en vault_items (Documentos y tarjetas).
// Ahora:
//   - Lee membresías, tarjetas y seguros de vault_items y solo manda a la IA el nombre del programa, su
//     nivel y los beneficios que la persona escribió (sin números, titulares, teléfonos ni notas: la misma
//     regla que "Iato, resúmeme", src/lib/boveda/aiSummary.ts). Nunca documentos de identidad.
//   - Busca con la IA ya configurada (Claude, ANTHROPIC_API_KEY) y su búsqueda web; cada promoción debe
//     traer como fuente una página que la búsqueda devolvió de verdad: sin fuente, no se muestra.
//   - Si algo falla, un mensaje honesto en español (nunca el texto técnico).

export type VaultRow = {
  section?: string | null;
  kind?: string | null;
  title?: string | null;
  tier?: string | null;
  issuer?: string | null;
  benefits?: unknown;
};

export type PromoLine = { tipo: string; programa: string; nivel: string | null; beneficios: string[] };

const SHARED = new Set(["membresia", "tarjeta", "seguro"]);
const KIND: Record<string, string> = {
  aerolinea: "Aerolínea", hotel: "Hotel", auto: "Renta de autos", crucero: "Crucero", sala: "Salas VIP",
  viajero_confiable: "Viajero confiable", otra_membresia: "Membresía", tarjeta: "Tarjeta",
  seguro_viaje: "Seguro de viaje", seguro_medico: "Seguro médico", asistencia: "Asistencia en viaje", otro_seguro: "Seguro",
};

/** Quita cualquier cosa con pinta de número de cuenta (6+ caracteres alfanuméricos con dígitos). */
export function redactIdentifiers(text: string): string {
  return String(text ?? "").replace(/\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{6,}\b/g, "[omitido]");
}
const cut = (s: unknown, n: number) => redactIdentifiers(String(s ?? "").replace(/\s+/g, " ").trim()).slice(0, n);

/** Membresías, tarjetas y seguros guardados → lo único que se manda a la IA. */
export function promoLines(rows: VaultRow[]): PromoLine[] {
  return (rows ?? []).filter((r) => SHARED.has(String(r?.section ?? ""))).map((r) => ({
    tipo: KIND[String(r.kind ?? "")] ?? "Programa",
    programa: cut(r.title, 120),
    nivel: r.tier ? cut(r.tier, 60) : null,
    beneficios: (Array.isArray(r.benefits) ? r.benefits : []).map((b) => cut(b, 160)).filter(Boolean).slice(0, 8),
  })).filter((l) => l.programa).slice(0, 25);
}

export function describeLines(lines: PromoLine[]): string {
  return lines.map((l) => `- ${l.tipo}: ${l.programa}${l.nivel ? ` (${l.nivel})` : ""}${l.beneficios.length ? `\n  · ${l.beneficios.join("\n  · ")}` : ""}`).join("\n");
}

export const PROMO_TOOL = {
  name: "entregar_promociones",
  description: "Entrega las promociones vigentes encontradas en la búsqueda web, cada una con la URL de la página que la anuncia.",
  input_schema: {
    type: "object",
    properties: {
      resumen: { type: "string", description: "Una o dos líneas en español de México: qué encontraste y para qué programas." },
      promociones: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            proveedor: { type: "string" },
            categoria: { type: "string", enum: ["vuelo", "hotel", "auto", "tarjeta", "experiencia"] },
            beneficio: { type: "string", description: "Lo que ofrece, tal como lo dice la página (sin calcular ahorros)." },
            vigencia: { type: "string", description: "Fecha de término si la página la dice; si no, \"Revisa la vigencia en la fuente\"." },
            como_activar: { type: "string" },
            requisito_vault: { type: "string", description: "Qué programa o tarjeta de la persona la habilita (de la lista dada)." },
            url: { type: "string", description: "URL exacta de un resultado de la búsqueda web que anuncia esta promoción." },
          },
          required: ["titulo", "proveedor", "categoria", "beneficio", "como_activar", "url"],
        },
      },
    },
    required: ["resumen", "promociones"],
  },
} as const;

export const PROMO_SYSTEM = `Eres Iato, de IATOS. Buscas promociones de viaje VIGENTES para los programas y tarjetas de una persona.
Reglas:
- Usa la búsqueda web. Solo incluye promociones que aparezcan en una página que encontraste, con su URL exacta.
- No inventes promociones, montos, códigos ni fechas. Si la página no dice la vigencia, escribe "Revisa la vigencia en la fuente".
- No calcules ahorros. Prioriza sitios oficiales (banco, aerolínea, cadena hotelera, rentadora).
- Si no encuentras nada vigente, entrega una lista vacía y dilo en el resumen.
- Español de México. Entrega el resultado SIEMPRE llamando a la herramienta "entregar_promociones", sin texto adicional.`;

export type PromoBody = { destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null };

export function promoUserPrompt(lines: PromoLine[], body: PromoBody, today: string): string {
  const viaje = body?.destino
    ? `Viaje: ${cut(body.destino, 80)}${body.fecha_salida ? `, del ${cut(body.fecha_salida, 10)}` : ""}${body.fecha_regreso ? ` al ${cut(body.fecha_regreso, 10)}` : ""}.`
    : "Sin viaje específico: promociones de viaje aplicables en los próximos meses.";
  return `Hoy es ${today}. ${viaje}\n\nProgramas y tarjetas de la persona (solo nombre, nivel y beneficios):\n${describeLines(lines)}\n\nBusca de 3 a 8 promociones vigentes que crucen con estos programas.`;
}

/** Petición a Claude: búsqueda web del servidor + la herramienta para entregar el resultado. */
export function promoRequest(lines: PromoLine[], body: PromoBody, today: string) {
  return {
    max_tokens: 6000,
    system: PROMO_SYSTEM,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "MX" } },
      PROMO_TOOL,
    ],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: promoUserPrompt(lines, body, today) }],
  };
}

type Block = { type?: string; name?: string; input?: unknown; content?: unknown };
type ClaudeMessage = { content?: Block[]; stop_reason?: string };

const normUrl = (u: string) => {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" && x.protocol !== "http:") return null;
    return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
};

/** URLs que la búsqueda web devolvió de verdad (bloques web_search_tool_result). */
export function searchResultUrls(messages: ClaudeMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    for (const b of m?.content ?? []) {
      if (b?.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue; // un error es un objeto, no lista
      for (const r of b.content as Array<{ type?: string; url?: unknown }>) {
        if (r?.type === "web_search_result" && typeof r.url === "string") out.push(r.url);
      }
    }
  }
  return out;
}

export type Promo = {
  titulo: string; proveedor: string; categoria: "vuelo" | "hotel" | "auto" | "tarjeta" | "experiencia";
  beneficio: string; vigencia: string; como_activar: string; requisito_vault: string | null; url: string;
};
const CATS = new Set(["vuelo", "hotel", "auto", "tarjeta", "experiencia"]);
const txt = (v: unknown, n: number) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Resultado final: solo promociones cuya URL está entre los resultados de la búsqueda (nada sin fuente).
 * null si el modelo no entregó la herramienta (o declinó).
 */
export function finalPromos(messages: ClaudeMessage[]): { resumen: string; promociones: Promo[]; fuentes: string[]; descartadas: number } | null {
  const last = messages[messages.length - 1];
  if (!last || last.stop_reason === "refusal") return null;
  const block = messages.flatMap((m) => m?.content ?? []).reverse().find((b) => b?.type === "tool_use" && b?.name === PROMO_TOOL.name);
  const input = block?.input as { resumen?: unknown; promociones?: unknown } | undefined;
  if (!input || typeof input !== "object") return null;
  const found = searchResultUrls(messages);
  const known = new Set(found.map(normUrl).filter(Boolean) as string[]);
  const raw = Array.isArray(input.promociones) ? input.promociones as Array<Record<string, unknown>> : [];
  const promociones: Promo[] = [];
  for (const p of raw) {
    const url = typeof p?.url === "string" ? p.url.trim() : "";
    const key = url ? normUrl(url) : null;
    if (!key || !known.has(key)) continue;
    const categoria = CATS.has(String(p.categoria)) ? (p.categoria as Promo["categoria"]) : "experiencia";
    const titulo = txt(p.titulo, 140), proveedor = txt(p.proveedor, 80), beneficio = txt(p.beneficio, 300);
    if (!titulo || !beneficio) continue;
    promociones.push({
      titulo, proveedor, categoria, beneficio,
      vigencia: txt(p.vigencia, 120) || "Revisa la vigencia en la fuente",
      como_activar: txt(p.como_activar, 300) || "Consulta los términos en la fuente",
      requisito_vault: txt(p.requisito_vault, 120) || null,
      url,
    });
    if (promociones.length >= 8) break;
  }
  const descartadas = raw.length - promociones.length;
  const resumen = promociones.length
    ? txt(input.resumen, 300)
    : "No encontramos promociones vigentes con fuente para tus programas. Vuelve a intentarlo más adelante.";
  return { resumen, promociones, fuentes: Array.from(new Set(promociones.map((p) => p.url))), descartadas };
}

export const PROMO_MESSAGES = {
  empty: "Agrega tus tarjetas, membresías o seguros en Documentos y tarjetas para buscar promociones que te apliquen.",
  unavailable: "La búsqueda de promociones no está disponible en este momento. Intenta de nuevo más tarde.",
  failed: "No pudimos buscar promociones ahora. Intenta de nuevo en unos minutos.",
} as const;
