import { describe, expect, it } from "vitest";
import {
  GMAIL_CLIP_BYTES,
  PRIVE_FROM,
  priveEntityRefId,
  priveInvitationEmail,
  priveNoticeEmail,
  priveReplyTo,
  priveResetEmail,
  resolvePriveLocale,
} from "../../supabase/functions/_shared/prive-email";
import { sendDueInvitations, type ClaimedInvitation, type InviteMessage } from "../../supabase/functions/_shared/prive-invite-sender";
import { safeHeaders } from "../../supabase/functions/_shared/email";

const TOKEN = "Tk3n_abcdefghijklmnopqrstuvwxyzABCDEFG-0123";
const LINK = `https://traveliatos.life/prive/invitacion#t=${TOKEN}`;
const hrefs = (html: string) => [...html.matchAll(/<(?:a|v:rect)\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
/** Texto visible aproximado: sin comentarios condicionales, etiquetas ni entidades. */
const visible = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// Palabras que los filtros asocian con promociones o fraude (es/en). Ninguna puede aparecer.
const SPAM_WORDS = [
  "exclusiv", "vip", "gratis", "oferta", "urgente", "promoción", "descuento", "gana ", "ganador", "premio",
  "haz clic", "da clic", "click aquí", "solo hoy", "última oportunidad", "100%", "garantizado", "dinero",
  "free", "offer", "urgent", "act now", "limited time", "winner", "click here", "guarantee", "risk-free", "$$$",
];

const variants = [
  ["es · 90 días", priveInvitationEmail({ firstName: "Rodrigo del Castillo", token: TOKEN })],
  ["es · concesión sin nombre", priveInvitationEmail({ token: TOKEN, basis: "grant" })],
  ["en · 90 días", priveInvitationEmail({ firstName: "Valentina", token: TOKEN, locale: "en" })],
  ["es · código y reply-to", priveInvitationEmail({ firstName: "Ana", token: TOKEN, memberCode: "IP-7KQM-X4TD", replyTo: "concierge@traveliatos.life" })],
] as const;

describe("invitación Privé · entregabilidad", () => {
  it.each(variants)("%s: cabe bajo el recorte de Gmail (102 KB) con mucho margen", (_n, m) => {
    const bytes = new TextEncoder().encode(m.html).length;
    expect(bytes).toBeLessThan(GMAIL_CLIP_BYTES);
    expect(bytes).toBeLessThan(30 * 1024);
  });

  it.each(variants)("%s: sin palabras de promoción, sin signos de admiración ni mayúsculas en el código del asunto", (_n, m) => {
    const all = `${m.subject}\n${m.preheader}\n${visible(m.html)}\n${m.text}`.toLowerCase();
    for (const w of SPAM_WORDS) expect(all, w).not.toContain(w);
    expect(all).not.toMatch(/[!¡]/);
    expect(m.subject).not.toMatch(/[?¿!¡$%*]|\.\s*$/);
    expect(m.subject.length).toBeLessThanOrEqual(45);
    expect(m.subject.replace(/IATOS/g, "")).not.toMatch(/[A-ZÁÉÍÓÚ]{3,}/); // nada GRITADO salvo la marca
  });

  it.each(variants)("%s: cero imágenes, cero recursos remotos y sin texto oculto de relleno", (_n, m) => {
    expect(m.html).not.toMatch(/<img|background-image|url\(|<link\b|@import|fonts\.googleapis/i);
    expect(m.html).not.toMatch(/&#8199;|&#65279;|&#847;|&zwnj;/);
    // El único bloque oculto es el preencabezado, y solo contiene el preencabezado.
    const hidden = [...m.html.matchAll(/<div style="display:none;[^"]*">([^<]*)<\/div>/g)].map((x) => x[1]);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toBe(m.preheader.replace(/'/g, "&#39;"));
  });

  it.each(variants)("%s: todos los enlaces en traveliatos.life, sin acortadores y con texto que no simula otra dirección", (_n, m) => {
    for (const h of hrefs(m.html)) {
      if (h.startsWith("mailto:")) { expect(h).toMatch(/@traveliatos\.life$/); continue; }
      expect(new URL(h).hostname).toBe("traveliatos.life");
    }
    for (const a of m.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
      const text = a[2].replace(/&amp;/g, "&").trim();
      if (/^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(text)) {
        const shown = new URL(/^https?:/.test(text) ? text : `https://${text}`).hostname;
        expect(shown).toBe(new URL(a[1].replace(/&amp;/g, "&").replace(/^mailto:[^@]+@/, "https://")).hostname);
      }
    }
    expect(m.html).not.toMatch(/bit\.ly|tinyurl|t\.co\/|goo\.gl|ow\.ly|rebrand\.ly/i);
  });

  it.each(variants)("%s: accesible (lang, h1, monograma oculto al lector de pantalla, tablas de presentación)", (_n, m) => {
    expect(m.html).toMatch(/<html lang="(es|en)"/);
    expect(m.html).toMatch(/<h1\b/);
    expect(m.html).toMatch(/<table role="presentation" aria-hidden="true"/);
    expect([...m.html.matchAll(/<table\b(?![^>]*role="presentation")/g)]).toHaveLength(0);
  });

  it("parte de texto: enlace, nombre, por qué lo recibe y aviso de contraseña", () => {
    const m = variants[0][1];
    expect(m.text).toContain(LINK);
    expect(m.text).toContain("Para Rodrigo");
    expect(m.text).toContain("Abrir mi invitación:");
    expect(m.text).toContain("Recibes este correo porque");
    expect(m.text).toContain("Nunca te pediremos tu contraseña");
    expect(m.text).not.toMatch(/<[a-z]/i);
  });

  it("español por defecto; inglés solo si el perfil dice inglés", () => {
    expect(resolvePriveLocale(undefined)).toBe("es");
    expect(resolvePriveLocale("")).toBe("es");
    expect(resolvePriveLocale("es-MX")).toBe("es");
    expect(resolvePriveLocale("fr")).toBe("es");
    expect(resolvePriveLocale("english")).toBe("es");
    expect(resolvePriveLocale("en")).toBe("en");
    expect(resolvePriveLocale("en-US")).toBe("en");
    expect(resolvePriveLocale("EN_gb")).toBe("en");

    const es = variants[0][1];
    expect(es.subject).toBe("Rodrigo, tu invitación a IATOS Privé");
    expect(es.html).toContain('<html lang="es"');
    expect(es.html).not.toMatch(/There are places|Open my invitation/);

    const en = variants[2][1];
    expect(en.subject).toBe("Valentina, your invitation to IATOS Privé");
    expect(en.preheader).toBe("A personal invitation, in your name.");
    expect(en.html).toContain('<html lang="en"');
    for (const s of ["For Valentina", "There are places you visit.<br>And there are worlds you enter.", "Open my invitation", "The World, Beyond Ordinary.", "We will never ask for your password"]) {
      expect(en.html).toContain(s);
    }
    expect(en.text).toContain("For Valentina");
    expect(en.text).toContain(LINK);
    expect(visible(en.html)).not.toMatch(/Recibes|Abrir|contraseña|Hay lugares/);
  });

  it("asunto: sin nombre o con nombre que no cabe en 45 caracteres, va sin nombre", () => {
    expect(variants[1][1].subject).toBe("Tu invitación a IATOS Privé");
    expect(priveInvitationEmail({ firstName: "Bartolomeoalejandro", token: TOKEN }).subject).toBe("Tu invitación a IATOS Privé");
    expect(priveInvitationEmail({ firstName: "Bartolomeoalejandro", token: TOKEN }).html).toContain("Bartolomeoalejandro");
  });

  it("escapa el nombre en HTML y asunto sin romper el texto plano", () => {
    const evil = `<script>alert(1)</script>"Ana'`;
    const m = priveInvitationEmail({ firstName: `Zoé${evil}`, token: TOKEN, locale: "en" });
    expect(m.html).not.toMatch(/<script/i);
    expect(m.html).toContain("For Zoéscriptalert(1)/script&quot;Ana&#39;");
    expect(m.text).toContain(`For Zoéscriptalert(1)/script"Ana'`);
    expect(m.html).not.toMatch(/<title>[^<]*<script/i);
    const n = priveInvitationEmail({ firstName: `"><svg onload=x>`, token: TOKEN });
    expect(n.html).not.toMatch(/<svg|onload=x>/i);
  });

  it("código de miembro: solo con la forma IP-XXXX-XXXX; otra cosa no se pinta", () => {
    expect(variants[3][1].html).toContain("IP-7KQM-X4TD");
    expect(variants[3][1].text).toContain("Miembro: IP-7KQM-X4TD");
    const bad = priveInvitationEmail({ token: TOKEN, memberCode: "<b>IP-1</b>" });
    expect(bad.html).not.toContain("IP-1");
    expect(bad.html).not.toContain("Miembro");
  });

  it("pie: con Reply-To invita a responder (sin mailto); sin él muestra el buzón de soporte", () => {
    const withReply = variants[3][1];
    expect(withReply.html).toContain("Basta con responder a este correo");
    expect(withReply.html).not.toContain("mailto:");
    expect(variants[0][1].html).toContain("mailto:hola@traveliatos.life");
    expect(priveReplyTo(" concierge@traveliatos.life ")).toBe("concierge@traveliatos.life");
    expect(priveReplyTo("no es correo")).toBeUndefined();
    expect(priveReplyTo("a@b.co\r\nBcc: x@y.z")).toBeUndefined();
    expect(priveReplyTo(undefined)).toBeUndefined();
  });

  it("avisos y restablecimiento: con Reply-To piden responder (no un buzón sin MX); sin él, igual que antes", () => {
    const n = priveNoticeEmail({ kind: "password_reset", replyTo: "concierge@traveliatos.life" });
    expect(n.html).toContain("Basta con responder a este correo");
    expect(n.html).not.toContain("mailto:");
    expect(n.text).toContain("Basta con responder a este correo");
    const r = priveResetEmail({ token: TOKEN, replyTo: "concierge@traveliatos.life" });
    expect(r.text).toContain("Basta con responder a este correo");
    expect(priveNoticeEmail({ kind: "password_reset" }).text).toContain("¿Dudas? Escríbenos a hola@traveliatos.life");
    expect(priveResetEmail({ token: TOKEN, replyTo: "mal" }).html).toContain("mailto:hola@traveliatos.life");
  });

  it("los avisos de seguridad conservan el mismo sistema (sin fuentes remotas ni relleno oculto)", () => {
    for (const m of [priveNoticeEmail({ kind: "hard_lock" }), priveResetEmail({ token: TOKEN })]) {
      expect(m.html).not.toMatch(/fonts\.googleapis|&#847;/);
      expect(new TextEncoder().encode(m.html).length).toBeLessThan(GMAIL_CLIP_BYTES);
    }
  });
});

describe("envío de la invitación · encabezados", () => {
  const inv = (o: Partial<ClaimedInvitation> = {}): ClaimedInvitation => ({
    invitation_id: "4b2c7e0a-1111-4222-8333-944455556666", user_id: "u-1", email: "p1@example.test", first_name: "Rodrigo", token: TOKEN, attempt: 1, basis: "tenure", ...o,
  });

  async function run(claimed: ClaimedInvitation[], replyTo?: string) {
    const sent: InviteMessage[] = [];
    await sendDueInvitations({
      claim: async () => ({ data: claimed, error: null }),
      mark: async () => ({ data: null, error: null }),
      send: async (m) => { sent.push(m); return { ok: true, id: "re_1" }; },
      siteUrl: "https://traveliatos.life",
      replyTo,
    }, 10);
    return sent;
  }

  it("X-Entity-Ref-ID estable por invitación, remitente IATOS Privé, sin Reply-To si no hay buzón", async () => {
    const [a] = await run([inv()]);
    const [b] = await run([inv()]);
    const [c] = await run([inv({ invitation_id: "99999999-1111-4222-8333-944455556666" })]);
    expect(a.headers).toEqual({ "X-Entity-Ref-ID": "prive-invitacion-4b2c7e0a-1111-4222-8333-944455556666" });
    expect(b.headers).toEqual(a.headers);
    expect(c.headers?.["X-Entity-Ref-ID"]).not.toBe(a.headers?.["X-Entity-Ref-ID"]);
    expect(a.from).toBe(PRIVE_FROM);
    expect(a.from).toMatch(/@traveliatos\.life>$/);
    expect(a).not.toHaveProperty("replyTo");
    expect(JSON.stringify(a.headers)).not.toContain(TOKEN);
    expect(Object.keys(a.headers ?? {})).not.toContain("List-Unsubscribe");
  });

  it("Reply-To configurado (válido) se manda y cambia el pie; uno inválido se ignora", async () => {
    const [ok] = await run([inv()], "concierge@traveliatos.life");
    expect(ok.replyTo).toBe("concierge@traveliatos.life");
    expect(ok.html).toContain("Basta con responder a este correo");
    const [bad] = await run([inv()], "x\r\nBcc: y@z.test");
    expect(bad).not.toHaveProperty("replyTo");
  });

  it("idioma del perfil si la base lo devuelve; si no, español", async () => {
    const [en] = await run([inv({ locale: "en-US" })]);
    const [es] = await run([inv({ locale: null })]);
    expect(en.subject).toBe("Rodrigo, your invitation to IATOS Privé");
    expect(es.subject).toBe("Rodrigo, tu invitación a IATOS Privé");
  });

  it("entity ref id sin caracteres raros", () => {
    expect(priveEntityRefId("ab\r\nX-Evil: 1")).toBe("prive-invitacion-abX-Evil1");
  });

  it("sendEmail solo deja pasar encabezados de una línea con nombre válido", () => {
    expect(safeHeaders(undefined)).toBeUndefined();
    expect(safeHeaders({ "X-Entity-Ref-ID": "prive-invitacion-1", "Bad Name": "x", "X-Inj": "a\r\nBcc: z@z.z", "X-Empty": "" }))
      .toEqual({ "X-Entity-Ref-ID": "prive-invitacion-1" });
  });
});
