import { describe, expect, it } from "vitest";
import { buildFixerEmail, oneLine, parseFixerPayload } from "../../supabase/functions/enviar-email-fixer/template";
import { redactPii } from "../../supabase/functions/_shared/redact";

const base = {
  user_name: "Ana", urgencia: "alta", motivo: "Perdí mi vuelo",
  trip: { titulo: "Roma", destinos: "Roma", fecha_salida: "2026-11-01", fecha_regreso: "2026-11-05" },
  contexto_chat: [{ role: "user", content: "hola" }, { role: "assistant", content: "¿en qué te ayudo?" }],
};

describe("enviar-email-fixer (F-08)", () => {
  it("rechaza una urgencia fuera del enum (antes entraba al HTML y al estilo)", () => {
    expect(parseFixerPayload({ ...base, urgencia: 'alta"><script>x</script>' })).toEqual({ ok: false, error: "invalid_urgencia" });
    expect(parseFixerPayload({ ...base, motivo: "  " })).toEqual({ ok: false, error: "missing_motivo" });
  });

  it("escapa <, >, comillas y apóstrofos en todo lo que escribe el cliente", () => {
    const p = parseFixerPayload({
      ...base,
      user_name: '<img src=x onerror="alert(1)">',
      motivo: `<a href="https://phish.example">Clic</a> it's`,
      trip: { titulo: '"><b>x</b>', destinos: "<i>", fecha_salida: "<s>", fecha_regreso: "'" },
      contexto_chat: [{ role: "user", content: "<script>robar()</script>" }],
    });
    if (!p.ok) throw new Error("debió aceptar");
    const { html } = buildFixerEmail(p.value, { email: 'ana"@ej.com', userId: "u-1" });
    expect(html).not.toMatch(/<img|<script|<a href="https:\/\/phish|<b>x|<i>|<s>/);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("it&#39;s");
    // El mailto no se puede romper con comillas en el correo.
    expect(html).toContain('href="mailto:ana%22%40ej.com"');
  });

  it("la identidad sale de la sesión: ignora user_email del cuerpo", () => {
    const p = parseFixerPayload({ ...base, user_email: "ceo@empresa.com" });
    if (!p.ok) throw new Error("debió aceptar");
    const { html } = buildFixerEmail(p.value, { email: "ana@real.mx", userId: "u-1" });
    expect(html).toContain("ana@real.mx");
    expect(html).not.toContain("ceo@empresa.com");
  });

  it("el asunto es una sola línea (sin inyección de encabezados)", () => {
    const p = parseFixerPayload({ ...base, user_name: "Ana\r\nBcc: todos@x.com", motivo: "x\nSubject: falso" });
    if (!p.ok) throw new Error("debió aceptar");
    const { subject } = buildFixerEmail(p.value, { email: null, userId: "u-1" });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(oneLine("a\u0000b\nc", 10)).toBe("a b c");
  });

  it("limita tamaños y descarta teléfonos que no son teléfonos", () => {
    const p = parseFixerPayload({ ...base, motivo: "x".repeat(5000), user_phone: "<b>55</b>", contexto_chat: Array(10).fill({ role: "user", content: "y".repeat(900) }) });
    if (!p.ok) throw new Error("debió aceptar");
    expect(p.value.motivo.length).toBe(2000);
    expect(p.value.userPhone).toBeNull();
    expect(p.value.contexto).toHaveLength(3);
    expect(p.value.contexto[0].content.length).toBe(300);
  });
});

describe("redactPii (F-18)", () => {
  it("tapa correos y secretos en mensajes de proveedores", () => {
    expect(redactPii("You can only send testing emails to your own email address (dueno@gmail.com)."))
      .toBe("You can only send testing emails to your own email address ([correo]).");
    expect(redactPii({ message: "fallo", to: "a@b.mx", key: "sk_live_abcdefghij" })).not.toMatch(/a@b\.mx|sk_live_abcdefghij/);
  });
});
