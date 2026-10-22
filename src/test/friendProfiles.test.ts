import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchFriendProfiles } from "@/lib/friendProfiles";

describe("perfiles de amigos (F-10)", () => {
  it("usa la RPC friend_profiles y solo conserva id, nombre, usuario y avatar", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ id: "f1", full_name: "Ana", username: "ana", avatar_url: null, email: "ana@x.mx", fecha_nacimiento: "1990-01-01" }],
      error: null,
    }));
    const out = await fetchFriendProfiles({ rpc });
    expect(rpc).toHaveBeenCalledWith("friend_profiles", {});
    expect(out).toEqual([{ id: "f1", full_name: "Ana", username: "ana", avatar_url: null }]);
  });

  it("filtra por ids y ante error devuelve []", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "x" } }));
    expect(await fetchFriendProfiles({ rpc }, ["f1"])).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("friend_profiles", { p_ids: ["f1"] });
    expect(await fetchFriendProfiles({ rpc }, [])).toEqual([]);
  });

  it("ninguna pantalla lee perfiles ajenos directo de la tabla", () => {
    for (const f of ["src/pages/Social.tsx", "src/components/lux/CompatibilityPanel.tsx", "src/components/TripBuildPreview.tsx", "src/components/InviteFriendDialog.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\("profiles"\)[^;]*\.in\("id"/s);
      expect(src, f).toContain("fetchFriendProfiles");
    }
  });
});
