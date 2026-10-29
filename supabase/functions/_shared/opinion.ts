// Opiniones de los usuarios ("¿Algo no se entiende? Cuéntanos"). Puro, sin Deno ni React: lo usan la
// función enviar-opinion (validación y correo al equipo), la Mesa de operaciones y el diálogo de la app.
// Una opinión es una fila de concierge_requests con type 'opinion' (migración 20261029060000_opiniones):
// entra sola a la Mesa, a "Mis solicitudes" y al ciclo de respuesta del equipo.
import { callout, button, type Email, EK, eyebrow, gap, headline, joinText, kvTable, masthead, normalizeSite, para, SERIF, shell, textFooter } from "./email-kit.ts";
import { escapeHtml, formatDateTime, oneLine } from "./email-format.ts";
import { folioOf } from "./ops-labels.ts";

export const OPINION_TYPES = ["no_funciona", "confuso", "idea", "me_gusto"] as const;
export type OpinionType = typeof OPINION_TYPES[number];

/** Cómo lo ve el usuario en el diálogo. */
export const OPINION_TYPE_LABEL: Record<OpinionType, string> = {
  no_funciona: "Algo no funciona",
  confuso: "Algo es confuso",
  idea: "Idea o mejora",
  me_gusto: "Me gustó",
};
/** Corto, para el asunto del correo al equipo ("Opinión IATOS · Confuso · /dashboard/viajes"). */
export const OPINION_TYPE_SHORT: Record<OpinionType, string> = {
  no_funciona: "No funciona",
  confuso: "Confuso",
  idea: "Idea",
  me_gusto: "Me gustó",
};

export const OPINION_MIN = 3;
export const OPINION_MAX = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ruta segura para guardar: solo el camino (sin dominio, ?consulta ni #fragmento, donde viajan códigos de
 * acceso o de recuperación) y sin tramos con pinta de token (enlaces compartidos, invitaciones). Los uuid
 * se quedan: son el id del viaje y no dan acceso a nada sin sesión.
 */
export function sanitizeRoute(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  s = s.split(/[?#]/)[0];
  const parts = s.split("/").filter(Boolean).slice(0, 8).map((seg) => {
    let d = seg;
    try { d = decodeURIComponent(seg); } catch { /* se queda como vino */ }
    if (UUID.test(d)) return d.toLowerCase();
    // Token: largo, mezcla letras y números (o trae caracteres raros). Palabras de la app pasan tal cual.
    if (!/^[a-z0-9-]{1,40}$/i.test(d) || (d.length >= 16 && /\d/.test(d) && /[a-z]/i.test(d))) return ":codigo";
    return d.toLowerCase();
  });
  return oneLine("/" + parts.join("/"), 200) || "/";
}

const DASHBOARD_SCREEN: Record<string, string> = {
  "": "Inicio", viajes: "Mis viajes", planear: "Planear viaje", concierge: "Concierge", perfil: "Mi perfil",
  cercanos: "Cercanos", favoritos: "Favoritos", recuerdos: "Recuerdos", social: "Social", gastos: "Gastos",
  reservas: "Mis reservas", beneficios: "Documentos y tarjetas", pro: "Plan IATOS PRO", vuelos: "Vuelos", hoteles: "Hoteles",
  restaurantes: "Restaurantes", actividades: "Actividades", autos: "Autos", trenes: "Trenes", ferries: "Ferris", cruceros: "Cruceros",
  seguros: "Seguros", esim: "eSIM", convertidor: "Convertidor de moneda", comparar: "Comparar", descubre: "Descubre", explorar: "Explorar",
  members: "Members Only", ruta: "Ruta", "smart-spend": "Smart Spend", admin: "Administración",
};
const TRIP_SCREEN: Record<string, string> = {
  "": "Detalle del viaje", mapa: "Mapa del viaje", clima: "Clima del viaje", diario: "Diario del viaje", editar: "Editar viaje",
  live: "Viaje en curso", packing: "Equipaje del viaje", split: "Gastos compartidos del viaje", traductor: "Traductor",
};

/** Nombre de la pantalla en español a partir de la ruta (lo que lee el equipo). */
export function screenName(route: string | null | undefined): string | null {
  const r = sanitizeRoute(route ?? "");
  if (!r) return null;
  const seg = r.split("/").filter(Boolean);
  if (seg[0] === "dashboard") {
    if (seg[1] === "viajes" && seg[2] === "importar") return "Importar viaje";
    if (seg[1] === "viajes" && seg[2]) return TRIP_SCREEN[seg[3] ?? ""] ?? "Detalle del viaje";
    if (seg[1] === "admin" && seg[2] === "operaciones") return "Mesa de operaciones";
    if (seg[1] === "social" && seg[2] === "amigo") return "Perfil de un amigo";
    return DASHBOARD_SCREEN[seg[1] ?? ""] ?? null;
  }
  if (seg[0] === "admin" && seg[1] === "operaciones") return "Mesa de operaciones";
  if (seg[0] === "wrapped") return "IATOS Wrapped";
  if (seg[0] === "ayuda" || seg[0] === "faq") return "Ayuda";
  if (seg[0] === "onboarding") return "Primeros pasos";
  return null;
}

/** Id del viaje si la ruta es de un viaje (/dashboard/viajes/<uuid>…). */
export function tripIdFromRoute(route: string | null | undefined): string | null {
  const m = /^\/dashboard\/viajes\/([0-9a-f-]{36})(?:\/|$)/i.exec(String(route ?? ""));
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

export type OpinionInput = {
  tipo: OpinionType;
  texto: string;
  calificacion: number | null;
  contactar: boolean;
  ruta: string | null;
  pantalla: string | null;
  dispositivo: "celular" | "escritorio" | null;
  version: string | null;
  trip_id: string | null;
};

export type OpinionValidation = { ok: true; value: OpinionInput } | { ok: false; code: string; message: string };

/** Validación del servidor (el cliente valida lo mismo para avisar antes, pero no se confía en él). */
export function validateOpinion(body: unknown): OpinionValidation {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const tipo = typeof b.tipo === "string" ? b.tipo : "";
  if (!(OPINION_TYPES as readonly string[]).includes(tipo)) return { ok: false, code: "INVALID_TYPE", message: "Elige qué nos quieres contar." };
  // Sin caracteres de control (deja saltos de línea y tabulador).
  const texto = typeof b.texto === "string" ? b.texto.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim() : "";
  if (texto.length < OPINION_MIN) return { ok: false, code: "TEXT_REQUIRED", message: "Escribe qué pasó o qué te gustaría (al menos unas palabras)." };
  if (texto.length > OPINION_MAX) return { ok: false, code: "TEXT_TOO_LONG", message: `Máximo ${OPINION_MAX} caracteres.` };
  let calificacion: number | null = null;
  if (b.calificacion !== undefined && b.calificacion !== null && b.calificacion !== "") {
    const n = Number(b.calificacion);
    if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, code: "INVALID_RATING", message: "La calificación va de 1 a 5." };
    calificacion = n;
  }
  const ruta = sanitizeRoute(b.ruta);
  const dispositivo = b.dispositivo === "celular" || b.dispositivo === "escritorio" ? b.dispositivo : null;
  const version = typeof b.version === "string" && /^[\w.+-]{1,40}$/.test(b.version) ? b.version : null;
  const tripRaw = typeof b.trip_id === "string" && UUID.test(b.trip_id) ? b.trip_id.toLowerCase() : null;
  return {
    ok: true,
    value: {
      tipo: tipo as OpinionType,
      texto,
      calificacion,
      // Marcada por defecto: solo un false explícito la desmarca.
      contactar: b.contactar !== false,
      ruta,
      // La pantalla la nombra el servidor a partir de la ruta (no se guarda lo que diga el cliente).
      pantalla: screenName(ruta),
      dispositivo,
      version,
      trip_id: tripRaw ?? tripIdFromRoute(ruta),
    },
  };
}

/** Título de la solicitud (Mesa y "Mis solicitudes"): "Algo es confuso: no entendí dónde ver mis vuelos". */
export function opinionTitle(v: Pick<OpinionInput, "tipo" | "texto">): string {
  const words = oneLine(v.texto, 2000);
  const clip = words.length > 90 ? words.slice(0, 90).replace(/\s+\S*$/, "") + "…" : words;
  return oneLine(`${OPINION_TYPE_LABEL[v.tipo]}: ${clip}`, 200);
}

/** Lo que se guarda en concierge_requests.payload (lo valida el CHECK concierge_requests_opinion_ok). */
export function opinionPayload(v: OpinionInput): Record<string, unknown> {
  return {
    tipo: v.tipo, texto: v.texto, calificacion: v.calificacion, contactar: v.contactar,
    ruta: v.ruta, pantalla: v.pantalla, dispositivo: v.dispositivo, version: v.version, origen: "app_opinion",
  };
}

const isOpinionType = (t: unknown): t is OpinionType => typeof t === "string" && (OPINION_TYPES as readonly string[]).includes(t);

/** Lo que trae el aviso (_ops_request_json) de una opinión. */
export type OpinionAlert = {
  id: string;
  title?: string | null;
  created_at?: string | null;
  payload?: Record<string, unknown> | null;
  trip?: { id?: string; destino?: string | null } | null;
  user?: { name?: string | null; email?: string | null } | null;
};

export function opinionFields(p: Record<string, unknown> | null | undefined) {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const tipo = isOpinionType(o.tipo) ? o.tipo : null;
  const rating = Number(o.calificacion);
  return {
    tipo,
    tipoLabel: tipo ? OPINION_TYPE_LABEL[tipo] : "Opinión",
    tipoShort: tipo ? OPINION_TYPE_SHORT[tipo] : "Opinión",
    texto: typeof o.texto === "string" ? o.texto : "",
    calificacion: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    contactar: o.contactar !== false,
    ruta: typeof o.ruta === "string" ? o.ruta : null,
    pantalla: typeof o.pantalla === "string" ? o.pantalla : null,
    dispositivo: o.dispositivo === "celular" ? "Celular" : o.dispositivo === "escritorio" ? "Escritorio" : null,
    version: typeof o.version === "string" ? o.version : null,
  };
}

export const stars = (n: number | null) => (n ? `${"★".repeat(n)}${"☆".repeat(5 - n)} (${n} de 5)` : null);

/** Correo al equipo (FIXER_EMAIL) por cada opinión. Todo lo que escribe el usuario va escapado. */
export function opinionTeamEmail(a: OpinionAlert, siteUrl?: string | null): Email {
  const site = normalizeSite(siteUrl);
  const f = opinionFields(a.payload);
  const folio = folioOf(a.id);
  const name = oneLine(a.user?.name, 120) || null;
  const email = oneLine(a.user?.email, 200) || null;
  const where = f.ruta ?? "sin pantalla";
  const subject = oneLine(`Opinión IATOS · ${f.tipoShort} · ${where}`, 180);
  const preheader = oneLine(`${name ?? email ?? "Un usuario"}: ${f.texto}`, 120);
  const deskUrl = `${site}/admin/operaciones?id=${encodeURIComponent(a.id)}`;
  const screen = [f.pantalla, f.ruta].filter(Boolean).join(" · ") || "No se sabe";
  const device = [f.dispositivo, f.version ? `versión ${f.version}` : null].filter(Boolean).join(" · ") || null;
  const trip = a.trip?.id ? `${oneLine(a.trip.destino, 120) || "Viaje"} · ${a.trip.id}` : null;
  const created = formatDateTime(a.created_at ?? new Date().toISOString());
  const contactText = f.contactar ? "Sí, se le puede escribir por correo" : "No quiere que le escriban por correo (responde desde la mesa: lo verá en la app)";
  const body = oneLine(f.texto.replace(/\s*\n\s*/g, " ¶ "), 2000).replace(/ ¶ /g, "\n");

  const html = shell({
    title: subject, preheader, siteUrl: site, compact: true,
    reason: "Correo interno de IATOS: llega al equipo cada vez que alguien manda su opinión desde la app.",
    body: [
      masthead(`Opinión · Folio ${folio}`),
      gap(32),
      eyebrow(f.tipoLabel),
      gap(12),
      headline(escapeHtml(name ?? email ?? "Un usuario de IATOS"), { size: 28 }),
      gap(18),
      `<tr><td class="ek-pad" style="padding:0 56px;font-family:${SERIF};font-size:19px;line-height:29px;color:${EK.ivory};white-space:pre-line;">${escapeHtml(body)}</td></tr>`,
      gap(24),
      kvTable([
        { k: "Tipo", v: escapeHtml(f.tipoLabel) },
        f.calificacion ? { k: "Calificación", v: escapeHtml(stars(f.calificacion)) } : null,
        { k: "Nombre", v: escapeHtml(name ?? "Sin nombre en el perfil") },
        email ? { k: "Correo", v: `<a href="mailto:${escapeHtml(encodeURIComponent(email))}" style="color:${EK.gold};text-decoration:none;">${escapeHtml(email)}</a>` } : null,
        { k: "Contactar", v: escapeHtml(contactText) },
        { k: "Pantalla", v: escapeHtml(screen) },
        device ? { k: "Dispositivo", v: escapeHtml(device) } : null,
        trip ? { k: "Viaje", v: escapeHtml(trip) } : null,
        { k: "Recibida", v: escapeHtml(`${created ?? ""} (hora CDMX)`) },
        { k: "Folio", v: escapeHtml(folio) },
      ]),
      gap(24),
      callout(escapeHtml(f.contactar && email
        ? "Responder a este correo le escribe directo a la persona. También puedes contestarle desde la mesa: lo ve en la app."
        : "Contéstale desde la mesa de operaciones: lo verá en la app, en Concierge › Mis solicitudes.")),
      gap(26),
      button(deskUrl, "Ver en la mesa"),
      gap(14),
      para("Marca la opinión como leída o resuelta en la mesa para que el equipo sepa que ya se atendió.", { align: "center", size: 12, color: EK.muted }),
    ],
  });
  const text = joinText([
    `OPINIÓN IATOS · ${f.tipoLabel} · Folio ${folio}`,
    "",
    body,
    "",
    f.calificacion ? `Calificación: ${f.calificacion} de 5` : null,
    `Nombre: ${name ?? "Sin nombre en el perfil"}`,
    email ? `Correo: ${email}` : null,
    `Contactar: ${contactText}`,
    `Pantalla: ${screen}`,
    device ? `Dispositivo: ${device}` : null,
    trip ? `Viaje: ${trip}` : null,
    `Recibida: ${created ?? ""} (hora CDMX)`,
    "",
    `Ver en la mesa de operaciones: ${deskUrl}`,
    "",
    ...textFooter({ reason: "Correo interno de IATOS: llega al equipo cada vez que alguien manda su opinión desde la app.", siteUrl: site, internal: true }),
  ]);
  return { subject, preheader, html, text };
}
