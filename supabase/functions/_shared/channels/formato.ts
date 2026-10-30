// Respuesta de Iato (concierge-chat: texto en markdown, tarjetas y acciones propuestas) → mensajes de Telegram o
// WhatsApp. Puro (sin Deno). Reglas:
//   · Telegram: HTML de la Bot API (<b>, <i>, <code>, <a href>), todo lo demás escapado.
//   · WhatsApp: su propio formato (*negritas*, _cursivas_); los enlaces van completos (WhatsApp los vuelve tocables).
//   · Tarjetas: lista corta (máx. 5) con el dato y su enlace (Maps, sitio, reservar…). Nada se inventa: solo lo
//     que trae la tarjeta validada por el servidor.
//   · Acciones que cambian datos (gasto, itinerario, alerta…): un mensaje por acción con su resumen y dos botones,
//     «✅ <confirmar>» y «Cancelar». Nada se hace sin ese toque (igual que la tarjeta de la app).
//   · Acciones de la app (calendario, emergencia en pantalla): enlace a la app.
export type CanalConversacion = "telegram" | "whatsapp";

export type BotonCanal = { texto: string; data?: string; url?: string };
export type MensajeCanal = { texto: string; botones: BotonCanal[] };

export type TarjetaIato = {
  type?: string; title?: string; subtitle?: string; meta?: string; body?: string; status?: string;
  price?: number; currency?: string; price_basis?: string; rating?: number; address?: string;
  event_date?: string; event_time?: string; booking_note?: string; cta_label?: string; cta_action?: string;
  links?: Array<{ kind?: string; label?: string; url?: string }>;
};
export type AccionIato = { id?: string; type?: string; params?: Record<string, unknown>; summary?: string; confirm_label?: string; note?: string; runs?: "server" | "client" };
export type RespuestaIato = { text?: string; cards?: TarjetaIato[]; actions?: AccionIato[] };

/** Acción ya guardada (channel_pending_actions): su id corto va en el botón. */
export type AccionGuardada = { ref: string; accion: AccionIato };

export const TELEGRAM_TROZO = 3800;
export const WHATSAPP_TROZO = 3800;
export const MAX_TARJETAS = 5;
export const MAX_ACCIONES = 3;

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escHtml(s).replace(/"/g, "&quot;");
const httpsOk = (u: unknown): u is string => {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password;
  } catch {
    return false;
  }
};

/** Markdown sencillo de Iato → HTML de Telegram (seguro: todo se escapa primero). */
export function markdownATelegram(md: string): string {
  const lineas = String(md ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => {
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l);
    if (h) return `**${h[1].trim()}**`;
    return l.replace(/^\s*[-*]\s+/, "• ");
  });
  let s = escHtml(lineas.join("\n"));
  // Enlaces [texto](https://…) (ya escapados: los paréntesis y corchetes no cambian).
  s = s.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)/g, (_m, t: string, u: string) => {
    const url = u.replace(/&amp;/g, "&");
    return httpsOk(url) ? `<a href="${escAttr(url)}">${t}</a>` : t;
  });
  s = s.replace(/`([^`\n]{1,200})`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*\n]{1,300})\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_\n]{1,300})__/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]{1,300})\*(?=[\s.,;:!?)]|$)/gm, "$1<i>$2</i>");
  s = s.replace(/(^|[\s(])_([^_\n]{1,300})_(?=[\s.,;:!?)]|$)/gm, "$1<i>$2</i>");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Markdown sencillo de Iato → formato de WhatsApp. */
export function markdownAWhatsApp(md: string): string {
  let s = String(md ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => {
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l);
    if (h) return `*${h[1].trim()}*`;
    return l.replace(/^\s*[-*]\s+/, "• ");
  }).join("\n");
  s = s.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)/g, (_m, t: string, u: string) => (httpsOk(u) ? `${t}: ${u}` : t));
  s = s.replace(/\*\*([^*\n]{1,300})\*\*/g, "*$1*").replace(/__([^_\n]{1,300})__/g, "*$1*").replace(/`([^`\n]{1,200})`/g, "```$1```");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

const money = (n: number, c?: string) => {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: c && /^[A-Z]{3}$/.test(c) ? c : "MXN", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n} ${c ?? ""}`.trim();
  }
};

const PRIORIDAD_ENLACE = ["booking", "tickets", "directions", "maps", "website", "call", "ride", "whatsapp"];

/** Una tarjeta en 1-3 líneas: título, dato clave (precio con su base, estado, fecha), y su mejor enlace. */
export function tarjetaATexto(c: TarjetaIato, canal: CanalConversacion): string {
  const t = String(c.title ?? "").trim().slice(0, 140);
  if (!t) return "";
  const detalle = [c.subtitle, c.status, c.event_date ? `${c.event_date}${c.event_time ? ` ${c.event_time}` : ""}` : null,
    typeof c.price === "number" && c.price > 0 ? `${money(c.price, c.currency)}${c.price_basis ? ` (${c.price_basis})` : ""}` : null,
    typeof c.rating === "number" ? `★ ${c.rating.toFixed(1)}` : null, c.booking_note]
    .filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 3).join(" · ");
  const links = (c.links ?? []).filter((l) => httpsOk(l.url)).sort((a, b) => PRIORIDAD_ENLACE.indexOf(String(a.kind)) - PRIORIDAD_ENLACE.indexOf(String(b.kind)));
  const link = links[0] ?? (httpsOk(c.cta_action) ? { label: c.cta_label ?? "Ver", url: c.cta_action } : null);
  if (canal === "telegram") {
    const titulo = link ? `<b><a href="${escAttr(String(link.url))}">${escHtml(t)}</a></b>` : `<b>${escHtml(t)}</b>`;
    return [titulo, detalle ? escHtml(detalle) : null].filter(Boolean).join("\n");
  }
  return [`*${t}*`, detalle || null, link ? `${String(link.label ?? "Ver").slice(0, 40)}: ${link.url}` : null].filter(Boolean).join("\n");
}

/** Parte un texto largo en trozos por párrafo (sin cortar una etiqueta HTML a la mitad en lo posible). */
export function trocear(texto: string, max: number): string[] {
  const out: string[] = [];
  let actual = "";
  for (const p of texto.split(/\n\n/)) {
    const pieza = actual ? `${actual}\n\n${p}` : p;
    if (pieza.length <= max) { actual = pieza; continue; }
    if (actual) out.push(actual);
    if (p.length <= max) { actual = p; continue; }
    for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
    actual = "";
  }
  if (actual) out.push(actual);
  return out.length ? out : [""];
}

/** Botón de una acción guardada: "a:<ref>:s" (confirmar) / "a:<ref>:n" (cancelar). ≤ 64 bytes (Telegram). */
export const datoBoton = (ref: string, si: boolean) => `a:${ref}:${si ? "s" : "n"}`;
export function leerBoton(data: string | null | undefined): { ref: string; confirmar: boolean } | null {
  const m = /^a:([0-9a-f]{32}):([sn])$/.exec(String(data ?? ""));
  return m ? { ref: m[1], confirmar: m[2] === "s" } : null;
}

/**
 * Arma los mensajes para el canal: el texto de Iato con sus tarjetas y, aparte, una confirmación por acción.
 * `guardadas`: acciones de servidor ya guardadas con su ref (las demás se ignoran: nunca hay un botón sin respaldo).
 * `twilio`: WhatsApp por Twilio no tiene botones interactivos aquí; se pide responder "sí <código>".
 */
export function armarMensajes(r: RespuestaIato, canal: CanalConversacion, o: { guardadas: AccionGuardada[]; appUrl: string; pie?: string | null; twilio?: boolean }): MensajeCanal[] {
  const texto = canal === "telegram" ? markdownATelegram(r.text ?? "") : markdownAWhatsApp(r.text ?? "");
  const tarjetas = (r.cards ?? []).map((c) => tarjetaATexto(c, canal)).filter(Boolean).slice(0, MAX_TARJETAS);
  const pie = o.pie ? (canal === "telegram" ? `<i>${escHtml(o.pie)}</i>` : `_${o.pie}_`) : null;
  const cuerpo = [texto || null, tarjetas.length ? tarjetas.join("\n\n") : null, pie].filter(Boolean).join("\n\n") || (canal === "telegram" ? "…" : "…");
  const max = canal === "telegram" ? TELEGRAM_TROZO : WHATSAPP_TROZO;
  const out: MensajeCanal[] = trocear(cuerpo, max).map((t) => ({ texto: t, botones: [] }));

  // Acciones de la app (descargar calendario, pantalla de emergencia): un enlace.
  const deApp = (r.actions ?? []).filter((a) => a.runs === "client").slice(0, 1);
  if (deApp.length) {
    const url = `${o.appUrl.replace(/\/$/, "")}/concierge`;
    const t = String(deApp[0].summary ?? "Ábrelo en la app").slice(0, 300);
    out.push(canal === "telegram" ? { texto: escHtml(t), botones: [{ texto: "Abrir en la app", url }] } : { texto: `${t}\n${url}`, botones: [] });
  }
  for (const g of o.guardadas.slice(0, MAX_ACCIONES)) {
    const a = g.accion;
    const resumen = String(a.summary ?? "").trim().slice(0, 500);
    const nota = String(a.note ?? "").trim().slice(0, 300);
    const confirmar = String(a.confirm_label ?? "Confirmar").trim().slice(0, 40);
    if (canal === "telegram") {
      out.push({ texto: [`<b>${escHtml(resumen)}</b>`, nota ? `<i>${escHtml(nota)}</i>` : null, "¿Lo hago?"].filter(Boolean).join("\n"),
        botones: [{ texto: `✅ ${confirmar}`, data: datoBoton(g.ref, true) }, { texto: "Cancelar", data: datoBoton(g.ref, false) }] });
    } else if (o.twilio) {
      out.push({ texto: [`*${resumen}*`, nota ? `_${nota}_` : null, `Para confirmar responde: sí ${g.ref.slice(0, 8)}`].filter(Boolean).join("\n"), botones: [] });
    } else {
      out.push({ texto: [`*${resumen}*`, nota ? `_${nota}_` : null, "¿Lo hago?"].filter(Boolean).join("\n"),
        botones: [{ texto: confirmar, data: datoBoton(g.ref, true) }, { texto: "Cancelar", data: datoBoton(g.ref, false) }] });
    }
  }
  return out;
}

/** Texto sencillo (sin formato) para un canal: lo que mandan los avisos del Operador. */
export function textoSimple(t: string, canal: CanalConversacion): string {
  return canal === "telegram" ? escHtml(t) : t;
}
