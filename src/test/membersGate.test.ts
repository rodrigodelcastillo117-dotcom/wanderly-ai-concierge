import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Members (F-16)", () => {
  it("la contraseña ya no está en el frontend: se valida con unlock_members_access", () => {
    const src = readFileSync("src/pages/Members.tsx", "utf8");
    expect(src).not.toMatch(/MEMBERS_PASSWORD|password_unlocked:\s*true/);
    expect(src).toContain('rpc("unlock_members_access"');
  });
});
