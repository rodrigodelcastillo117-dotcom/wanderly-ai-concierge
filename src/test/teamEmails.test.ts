import { describe, expect, it } from "vitest";
import { teamEmails } from "../../supabase/functions/_shared/teamEmails";

describe("correos del equipo (FIXER_EMAIL)", () => {
  it("acepta varios separados por coma, sin repetidos ni basura", () => {
    expect(teamEmails("rodrigoiatosai@gmail.com, carlo.cenicerosv.94@gmail.com")).toEqual(["rodrigoiatosai@gmail.com", "carlo.cenicerosv.94@gmail.com"]);
    expect(teamEmails("A@x.com,a@x.com, no-es-correo")).toEqual(["a@x.com"]);
  });
  it("sin variable usa el correo de siempre", () => {
    expect(teamEmails("")).toEqual(["hola@traveliatos.life"]);
    expect(teamEmails(null)).toEqual(["hola@traveliatos.life"]);
  });
});
