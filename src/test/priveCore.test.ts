import { describe, expect, it, vi } from "vitest";
import {
  generatePassphrase,
  hibpCheck,
  ipHash,
  isToken,
  jwtSessionId,
  PASSPHRASE_WORDS,
  passwordShapeProblem,
  sha1HexUpper,
  sha256Hex,
} from "../../supabase/functions/_shared/prive-core";

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("hashes y tokens", () => {
  it("sha256 hex igual que la SQL (prive_sha256_hex)", async () => {
    // sha256('abc') conocido
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("forma del token: 43 caracteres base64url", () => {
    expect(isToken("A".repeat(43))).toBe(true);
    expect(isToken("A".repeat(42))).toBe(false);
    expect(isToken("A".repeat(42) + "=")).toBe(false);
    expect(isToken(null)).toBe(false);
  });
});

describe("ip_hash (D8)", () => {
  it("16 hex, cambia cada día y depende de la sal", async () => {
    const d1 = new Date("2026-10-22T10:00:00Z");
    const d2 = new Date("2026-10-23T10:00:00Z");
    const a = await ipHash("203.0.113.9", "sal-secreta", d1);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await ipHash("203.0.113.9", "sal-secreta", d1)).toBe(a);
    expect(await ipHash("203.0.113.9", "sal-secreta", d2)).not.toBe(a);
    expect(await ipHash("203.0.113.9", "otra-sal", d1)).not.toBe(a);
    expect(a).toBe((await sha256Hex("203.0.113.9sal-secreta2026-10-22")).slice(0, 16));
  });
  it("sin sal no se inventa una: null (se omite el límite por IP)", async () => {
    expect(await ipHash("203.0.113.9", "")).toBeNull();
    expect(await ipHash("203.0.113.9", undefined)).toBeNull();
    expect(await ipHash("unknown", "sal")).toBeNull();
  });
});

describe("session_id del JWT", () => {
  it("lee el claim session_id del payload", () => {
    const sid = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    expect(jwtSessionId(`Bearer eyJhbGciOiJIUzI1NiJ9.${b64url({ sub: "u", session_id: sid })}.firma`)).toBe(sid);
  });
  it("sin claim o con basura: null", () => {
    expect(jwtSessionId(`Bearer x.${b64url({ sub: "u" })}.y`)).toBeNull();
    expect(jwtSessionId(`Bearer x.${b64url({ session_id: "no-es-uuid" })}.y`)).toBeNull();
    expect(jwtSessionId("Bearer basura")).toBeNull();
    expect(jwtSessionId(null)).toBeNull();
  });
});

describe("HaveIBeenPwned (anonimato k)", () => {
  it("solo manda los 5 primeros caracteres del SHA-1 y detecta la filtrada", async () => {
    const pw = "Password123456";
    const sha = await sha1HexUpper(pw);
    const fetchFn = vi.fn(async (url: string) => new Response(`0000000000000000000000000000000000A:0\r\n${sha.slice(5)}:4521\r\n`, { status: 200 }));
    expect(await hibpCheck(pw, fetchFn)).toBe("breached");
    const url = fetchFn.mock.calls[0][0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`);
    expect(url).not.toContain(pw);
    expect(url).not.toContain(sha.slice(5));
  });
  it("no filtrada → ok; renglones de relleno (conteo 0) no cuentan", async () => {
    const sha = await sha1HexUpper("Una-frase-muy-propia-77");
    expect(await hibpCheck("Una-frase-muy-propia-77", async () => new Response(`${sha.slice(5)}:0\nABCDEF:3\n`))).toBe("ok");
  });
  it("caído, 5xx o lento (> 2 s) → 'unavailable' (falla abierta registrada)", async () => {
    expect(await hibpCheck("x-y-z-1234567", async () => new Response("", { status: 503 }))).toBe("unavailable");
    expect(await hibpCheck("x-y-z-1234567", async () => { throw new Error("dns"); })).toBe("unavailable");
    const slow = (_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    });
    expect(await hibpCheck("x-y-z-1234567", slow, 50)).toBe("unavailable");
    // El tiempo límite por defecto es de 2 s.
    const spy = vi.spyOn(globalThis, "setTimeout");
    await hibpCheck("x-y-z-1234567", async () => new Response(""));
    expect(spy.mock.calls.some((c) => c[1] === 2000)).toBe(true);
    spy.mockRestore();
  });
});

describe("contraseña y frase generada", () => {
  it("12 a 72 bytes y al menos 5 caracteres distintos (igual que la SQL)", () => {
    expect(passwordShapeProblem("corta-11ch")).toBe("PASSWORD_WEAK");
    expect(passwordShapeProblem("aaaabbbbaaaabbbb")).toBe("PASSWORD_WEAK");
    expect(passwordShapeProblem("ñ".repeat(37))).toBe("PASSWORD_WEAK"); // 74 bytes
    expect(passwordShapeProblem(12345678901234)).toBe("PASSWORD_WEAK");
    expect(passwordShapeProblem("Una-frase-muy-propia-77")).toBeNull();
  });
  it("lista de 256 palabras únicas, sin acentos", () => {
    expect(PASSPHRASE_WORDS).toHaveLength(256);
    expect(new Set(PASSPHRASE_WORDS).size).toBe(256);
    expect(PASSPHRASE_WORDS.every((w) => /^[a-z]{3,9}$/.test(w))).toBe(true);
  });
  it("6 palabras + 2 dígitos, siempre dentro de 12–72 bytes, y distinta cada vez", () => {
    const a = generatePassphrase();
    expect(a).toMatch(/^([a-z]+-){6}\d{2}$/);
    expect(passwordShapeProblem(a)).toBeNull();
    expect(generatePassphrase()).not.toBe(a);
    let i = 0;
    const seq = [new Uint8Array([0, 1, 2, 3, 4, 255]), new Uint8Array([250]), new Uint8Array([7])];
    expect(generatePassphrase(() => seq[i++])).toBe(`${PASSPHRASE_WORDS[0]}-${PASSPHRASE_WORDS[1]}-${PASSPHRASE_WORDS[2]}-${PASSPHRASE_WORDS[3]}-${PASSPHRASE_WORDS[4]}-${PASSPHRASE_WORDS[255]}-07`);
  });
});
