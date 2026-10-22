import { describe, expect, it } from "vitest";
import {
  displayFirstName,
  fragmentLink,
  normalizeSiteUrl,
  priveInvitationEmail,
  priveNoticeEmail,
  priveResetEmail,
  type NoticeKind,
} from "../../supabase/functions/_shared/prive-email";

const TOKEN = "Tk3n_abcdefghijklmnopqrstuvwxyzABCDEFG-0123";
const hrefs = (html: string) => [...html.matchAll(/<(?:a|v:rect)\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("invitación Privé (tarjeta negra, español por defecto)", () => {
  const mail = priveInvitationEmail({ firstName: "valentina Ruiz", token: TOKEN, siteUrl: "https://traveliatos.life/" });

  // El dueño pidió (oct. 2026) todo en el idioma de la persona: el texto en inglés del §6 queda solo
  // para la variante en inglés (priveEmailDeliverability.test.ts).
  it("asunto, preencabezado y texto en español", () => {
    expect(mail.subject).toBe("Valentina, tu invitación a IATOS Privé");
    expect(mail.preheader).toBe("Una invitación personal, a tu nombre.");
    for (const line of [
      "IATOS PRIVÉ",
      "Hay lugares que se visitan.<br>Y hay mundos a los que se entra.",
      "Llevas noventa días recorriendo el mundo con IATOS.",
      "Esta puerta ahora es",
      "Abrir mi invitación",
      "El mundo, más allá de lo ordinario.",
    ]) expect(mail.html).toContain(line);
    expect(mail.text).toContain("Hay lugares que se visitan.\nY hay mundos a los que se entra.");
    expect(mail.text).toContain("El mundo, más allá de lo ordinario.");
  });

  it("personalizado con el primer nombre", () => {
    expect(mail.html).toContain("Para Valentina");
    expect(mail.text).toContain("Para Valentina");
    expect(priveInvitationEmail({ token: TOKEN }).html).not.toContain("Para ");
  });

  it("el nombre se escapa (no hay inyección de HTML)", () => {
    const m = priveInvitationEmail({ firstName: `O'Brien&"Co"<img src=x onerror=alert(1)>`, token: TOKEN });
    expect(m.html).toContain("Para O&#39;Brien&amp;&quot;Co&quot;");
    expect(m.html).not.toMatch(/<img/i);
    expect(m.html).not.toContain("onerror=alert");
  });

  it("enlace con el token SOLO en el fragmento; sin correo ni contraseña en ningún enlace", () => {
    const link = `https://traveliatos.life/prive/invitacion#t=${TOKEN}`;
    expect(hrefs(mail.html)).toContain(link);
    expect(mail.text).toContain(link);
    for (const h of hrefs(mail.html)) {
      const u = new URL(h.replace(/^mailto:/, "mailto://"));
      expect(u.search).toBe("");
      if (h.startsWith("mailto:")) continue;
      expect(h).not.toMatch(/@/);
      expect(h).not.toMatch(/password|contrase|pw=|email=/i);
    }
    expect(mail.html).not.toMatch(/\?t=|&t=/);
  });

  it("nunca contiene una contraseña", () => {
    expect(mail.html).not.toMatch(/tu contraseña es|password is|contraseña:/i);
    expect(mail.html).toContain("Nunca te pediremos tu contraseña");
  });

  it("maqueta de correo: 600 px, estilos en línea, oscuro declarado, sin imágenes", () => {
    expect(mail.html).toMatch(/<meta name="color-scheme" content="dark">/);
    expect(mail.html).toMatch(/<meta name="supported-color-schemes" content="dark">/);
    expect(mail.html).toContain('width="600"');
    expect(mail.html).toContain("max-width:600px");
    expect(mail.html).toContain("#0A0A0B");
    expect(mail.html).toContain("#C8B48A");
    expect(mail.html).toMatch(/Georgia/);
    expect(mail.html).not.toMatch(/<img|background-image|url\(/i);
    expect(mail.html).toMatch(/@media screen and \(max-width: 620px\)/);
    // Ningún ancho fijo mayor a 600 que rompa el móvil.
    const widths = [...mail.html.matchAll(/width="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeLessThanOrEqual(600);
  });

  it("monograma en texto vivo dentro de un anillo dorado (también para Outlook)", () => {
    expect(mail.html).toMatch(/border:1px solid #C8B48A;border-radius:50%[^>]*>P<\/td>/);
    expect(mail.html).toMatch(/<v:oval[^>]*strokecolor="#C8B48A"/);
  });

  it("botón a prueba de balas: tabla con fondo + VML para Outlook + enlace real", () => {
    expect(mail.html).toMatch(/<td align="center" bgcolor="#C8B48A"/);
    expect(mail.html).toMatch(/<v:rect[^>]*href="https:\/\/traveliatos\.life\/prive\/invitacion#t=/);
    expect(mail.html).toMatch(/<a href="https:\/\/traveliatos\.life\/prive\/invitacion#t=[^"]+"[^>]*class="pv-btn"/);
  });

  it("pie: identidad de IATOS AI, contacto de soporte y por qué lo recibe", () => {
    expect(mail.html).toContain("IATOS AI");
    expect(mail.html).toContain("mailto:hola@traveliatos.life");
    expect(mail.html).toContain("Recibes este correo porque tu membresía IATOS PRO cumplió 90 días pagados");
    const grant = priveInvitationEmail({ token: TOKEN, basis: "grant" });
    expect(grant.html).toContain("el equipo de IATOS te concedió acceso");
    expect(grant.html).not.toContain("noventa días");
  });

  it("token raro o sitio no https: no se arma un enlace peligroso", () => {
    expect(() => priveInvitationEmail({ token: "abc" })).toThrow();
    expect(() => fragmentLink("https://x.test", "/prive/invitacion", `${TOKEN.slice(0, 42)}"`)).toThrow();
    expect(normalizeSiteUrl("javascript:alert(1)")).toBe("https://traveliatos.life");
    expect(normalizeSiteUrl("http://evil.test")).toBe("https://traveliatos.life");
    expect(normalizeSiteUrl("http://localhost:8080/")).toBe("http://localhost:8080");
    expect(normalizeSiteUrl("https://preview.traveliatos.life/path?q=1")).toBe("https://preview.traveliatos.life");
  });

  it("nombre presentable", () => {
    expect(displayFirstName("  ana   maría ")).toBe("Ana");
    expect(displayFirstName("")).toBeNull();
    expect(displayFirstName(null)).toBeNull();
    expect(displayFirstName("x".repeat(80))).toHaveLength(40);
  });
});

describe("avisos de seguridad y restablecimiento", () => {
  const kinds: NoticeKind[] = ["password_set", "password_changed", "password_reset", "sessions_revoked", "new_access", "hard_lock"];

  it.each(kinds)("aviso %s: asunto en español, fecha, sin contraseña ni datos en los enlaces", (kind) => {
    const m = priveNoticeEmail({ kind, firstName: "Valentina", at: new Date("2026-10-22T18:30:00Z") });
    expect(m.subject).toMatch(/IATOS Privé/);
    expect(m.html).toContain("Valentina:");
    expect(m.html).toContain("hora del centro de México");
    expect(m.text).toContain("Nunca te pediremos tu contraseña");
    for (const h of hrefs(m.html)) if (!h.startsWith("mailto:")) { expect(h).not.toMatch(/@|\?/); }
  });

  it("'comprometida' lleva el enlace de restablecimiento en el fragmento (y lo exige)", () => {
    expect(() => priveNoticeEmail({ kind: "compromised" })).toThrow();
    const m = priveNoticeEmail({ kind: "compromised", resetToken: TOKEN });
    expect(hrefs(m.html)).toContain(`https://traveliatos.life/prive/restablecer#t=${TOKEN}`);
    expect(m.html).toContain("vence en 30 minutos");
  });

  it("restablecimiento: enlace #t=, 30 minutos, un solo uso", () => {
    const m = priveResetEmail({ firstName: "Valentina", token: TOKEN, siteUrl: "https://traveliatos.life" });
    expect(m.subject).toBe("Restablece tu contraseña de IATOS Privé");
    expect(m.text).toContain(`https://traveliatos.life/prive/restablecer#t=${TOKEN}`);
    expect(m.html).toContain("30 minutos y solo sirve una vez");
    expect(m.html).not.toMatch(/\?t=/);
  });
});
