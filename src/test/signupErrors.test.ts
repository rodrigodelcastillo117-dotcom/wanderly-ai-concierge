import { describe, expect, it } from "vitest";
import { signupErrorMessage } from "@/lib/signupErrors";

describe("mensajes al crear cuenta", () => {
  it("contraseña filtrada (respuesta real de Supabase)", () => {
    expect(signupErrorMessage("Password is known to be weak and easy to guess, please choose a different one.")).toMatch(/filtraciones conocidas/);
  });
  it("correo ya registrado", () => {
    expect(signupErrorMessage("User already registered")).toMatch(/Ya existe una cuenta/);
  });
  it("demasiados intentos", () => {
    expect(signupErrorMessage("For security purposes, you can only request this after 30 seconds.")).toMatch(/Demasiados intentos/);
    expect(signupErrorMessage("email rate limit exceeded")).toMatch(/Demasiados intentos/);
  });
  it("correo inválido y desconocido", () => {
    expect(signupErrorMessage("Unable to validate email address: invalid format")).toMatch(/no parece válido/);
    expect(signupErrorMessage("algo raro")).toMatch(/No pudimos crear tu cuenta/);
    expect(signupErrorMessage(undefined)).toMatch(/No pudimos crear tu cuenta/);
  });
});
