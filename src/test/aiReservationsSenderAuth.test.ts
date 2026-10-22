// AUD-02 · Verificación del remitente de la respuesta del restaurante (pruebas adversariales).
//
// Qué da Resend de verdad (GET /emails/receiving/{id}, consultado 2026-10-22,
// https://resend.com/docs/api-reference/emails/retrieve-received-email):
//   authentication: { spf, dkim, dmarc } con valores 'pass' | 'fail' | 'gray' | 'processing_failed' | 'unknown'
//   (null en correos anteriores al campo). Los calcula el servidor que recibe, no vienen de los encabezados.
//   - dkim 'gray' = sin firma o el dominio firmante NO coincide con el del From.
//   - dmarc 'gray' = SPF o DKIM pasaron pero el dominio no tiene política DMARC (o p=none).
//   - SPF autentica el sobre (Return-Path), nunca el From: solo no prueba nada.
//   No hay dominio d= ni selector: la alineación DKIM solo se puede leer de que dkim = 'pass'.
// Regla: cuenta como verificado SOLO (a) el From es exactamente la dirección a la que escribimos, con
// DMARC 'pass' o con DKIM 'pass' (firma alineada) y DMARC 'gray'; o (b) A2-RES-01: otra dirección del
// dominio del restaurante (o un subdominio suyo) con DMARC 'pass', SOLO si ese dominio es propio del
// restaurante (= el de su sitio web oficial y no un buzón compartido). DMARC distinto de pass/gray
// (o ausente) descarta. Todo lo demás → la respuesta se muestra, pero no confirma nada.
import { describe, expect, it } from "vitest";
import { bareAddress, domainOf, senderVerified } from "../../supabase/functions/_shared/ai-reservations/core";

const VENUE = "reservas@casaoaxaca.com.mx";
const ALL = { spf: "pass", dkim: "pass", dmarc: "pass" };
const SITE = "https://www.casaoaxaca.com.mx/";
const verified = (from: string, auth: unknown, venue = VENUE, site: string | null = null) => senderVerified(bareAddress(from), venue, auth as never, site);

describe("AUD-02 · correo legítimo", () => {
  it("dirección exacta con DMARC pass", () => {
    expect(verified("Reservaciones Casa Oaxaca <reservas@casaoaxaca.com.mx>", ALL)).toBe(true);
  });
  it("otra dirección del mismo dominio con DMARC pass (alineado al dominio del restaurante, que es el de su sitio oficial)", () => {
    expect(verified("María <maria@casaoaxaca.com.mx>", { spf: "gray", dkim: "pass", dmarc: "pass" }, VENUE, SITE)).toBe(true);
    // A2-RES-01: sin sitio oficial en ese dominio, el dominio no se da por propio → dirección exacta.
    expect(verified("María <maria@casaoaxaca.com.mx>", { spf: "gray", dkim: "pass", dmarc: "pass" })).toBe(false);
  });
  it("subdominio del restaurante con DMARC pass", () => {
    expect(verified("x@mail.casaoaxaca.com.mx", { spf: "pass", dkim: "pass", dmarc: "pass" }, VENUE, SITE)).toBe(true);
    expect(verified("x@mail.casaoaxaca.com.mx", { spf: "pass", dkim: "pass", dmarc: "pass" })).toBe(false);
  });
  it("dirección exacta con DKIM alineado aunque el dominio no publique DMARC (gray)", () => {
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "gray", dkim: "pass", dmarc: "gray" })).toBe(true);
  });
  it("mayúsculas no importan", () => {
    expect(verified("RESERVAS@CasaOaxaca.COM.MX", ALL)).toBe(true);
  });
});

describe("AUD-02 · SPF o DKIM sin alineación no bastan", () => {
  it("SPF pass no alineado (DKIM y DMARC gray) → no verificado", () => {
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "gray", dmarc: "gray" })).toBe(false);
  });
  it("SPF pass + DKIM pass de otro dominio (d= ajeno) con DMARC fail → no verificado", () => {
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "pass", dmarc: "fail" })).toBe(false);
  });
  it("otra dirección del mismo dominio con SPF y DKIM pass pero sin DMARC pass → no verificado", () => {
    expect(verified("x@mail.casaoaxaca.com.mx", { spf: "pass", dkim: "pass" })).toBe(false);
    expect(verified("maria@casaoaxaca.com.mx", { spf: "pass", dkim: "pass", dmarc: "gray" })).toBe(false);
  });
  it("DMARC fail (aunque SPF/DKIM digan pass) → no verificado", () => {
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "fail", dkim: "fail", dmarc: "fail" })).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "gray", dmarc: "fail" })).toBe(false);
  });
  it("correo gratuito: misma dirección con DKIM pass → sí; con DMARC fail o solo SPF → no", () => {
    expect(verified("casaoaxaca@gmail.com", { spf: "pass", dkim: "pass", dmarc: "gray" }, "casaoaxaca@gmail.com")).toBe(true);
    expect(verified("casaoaxaca@gmail.com", { spf: "pass", dkim: "pass", dmarc: "fail" }, "casaoaxaca@gmail.com")).toBe(false);
    expect(verified("casaoaxaca@gmail.com", { spf: "pass", dkim: "gray", dmarc: "gray" }, "casaoaxaca@gmail.com")).toBe(false);
    expect(verified("atacante@gmail.com", ALL, "casaoaxaca@gmail.com")).toBe(false);
  });
});

describe("AUD-02 · From falsificado o ambiguo", () => {
  it("nombre visible con la dirección del restaurante y otra dirección real → no", () => {
    expect(verified('"reservas@casaoaxaca.com.mx" <atacante@evil.test>', ALL)).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx <atacante@evil.test>", ALL)).toBe(false);
  });
  it("parte local entre comillas que contiene la dirección del restaurante → no (el dominio real es evil.test)", () => {
    expect(bareAddress('"reservas@casaoaxaca.com.mx"@evil.test')).not.toBe("reservas@casaoaxaca.com.mx");
    expect(verified('"reservas@casaoaxaca.com.mx"@evil.test', ALL)).toBe(false);
  });
  it("dos arrobas → no se adivina el dominio", () => {
    expect(domainOf(bareAddress("reservas@casaoaxaca.com.mx@evil.test"))).not.toBe("casaoaxaca.com.mx");
    expect(verified("reservas@casaoaxaca.com.mx@evil.test", ALL)).toBe(false);
  });
  it("varios buzones en el From → no", () => {
    expect(verified("reservas@casaoaxaca.com.mx, atacante@evil.test", ALL)).toBe(false);
    expect(verified("Casa <reservas@casaoaxaca.com.mx>, Otro <atacante@evil.test>", ALL)).toBe(false);
  });
  it("comentario con la dirección del restaurante → no", () => {
    expect(verified("atacante@evil.test (reservas@casaoaxaca.com.mx)", ALL)).toBe(false);
  });
  it("salto de línea inyectado → no", () => {
    expect(verified("reservas@casaoaxaca.com.mx\r\nFrom: x@evil.test", ALL)).toBe(false);
  });
});

describe("AUD-02 · dominios parecidos al del restaurante", () => {
  const lookalikes = [
    "reservas@casa-oaxaca.com.mx", // guion extra
    "reservas@casaoaxaca.com", // otro TLD
    "reservas@casaoaxaca.mx",
    "reservas@casaoaxaca.com.mx.evil.test", // sufijo
    "reservas@evilcasaoaxaca.com.mx", // prefijo pegado
    "reservas@casaoaxaca.co.mx",
    "reservas@саsaoaxaca.com.mx", // IDN: "с" y "а" cirílicas
    "reservas@xn--saoaxaca-2ng0b.com.mx", // punycode
  ];
  for (const from of lookalikes) {
    it(`${from} → no`, () => expect(verified(from, ALL)).toBe(false));
  }
  it("rn en vez de m", () => {
    expect(verified("reservas@larnorena.mx", ALL, "reservas@lamorena.mx")).toBe(false);
  });
  it("dominio padre o sufijo público del restaurante → no", () => {
    expect(verified("x@casaoaxaca.com", ALL, "reservas@mx.casaoaxaca.com")).toBe(false);
    expect(verified("x@com.mx", ALL)).toBe(false);
  });
});

describe("AUD-02 · reenvíos, otro remitente en nuestro hilo, datos incompletos", () => {
  it("reenviado por un tercero (otro buzón) → no, aunque el cuerpo cite al restaurante", () => {
    expect(verified("Agencia <agencia.viajes@gmail.com>", ALL)).toBe(false);
  });
  it("reenviado conservando el From del restaurante pero con DMARC roto por el reenvío → no", () => {
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "fail", dkim: "fail", dmarc: "fail" })).toBe(false);
  });
  it("sin bloque de autenticación (correo anterior al campo de Resend) o con valores desconocidos → no", () => {
    expect(verified("reservas@casaoaxaca.com.mx", null)).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx", undefined)).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx", {})).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "unknown", dkim: "unknown", dmarc: "unknown" })).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx", { spf: "pass", dkim: "processing_failed", dmarc: "processing_failed" })).toBe(false);
    expect(verified("reservas@casaoaxaca.com.mx", { dmarc: true })).toBe(false);
  });
  it("sin From o sin correo del restaurante → no", () => {
    expect(senderVerified(null, VENUE, ALL)).toBe(false);
    expect(senderVerified("reservas@casaoaxaca.com.mx", null, ALL)).toBe(false);
    expect(verified("", ALL)).toBe(false);
  });
});
