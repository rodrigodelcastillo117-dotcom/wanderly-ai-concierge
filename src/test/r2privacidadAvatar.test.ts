// T-P2-5 y N-L1: "Borrar mi avatar" existe (lo promete el Aviso de Privacidad) y profiles.avatar_url ya
// no se escribe desde el navegador. Regresión de a2trans_adversarial.test.ts ("Avatar: la promesa del
// Aviso de Privacidad"), que afirmaba el defecto.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deleteAvatar, ownsAvatarPath, type AvatarDeleteDeps } from "../../supabase/functions/_shared/avatar-delete";

const UID = "aaaaaaaa-0000-4000-8000-00000000000a";

function fakeStorage(tree: Record<string, Record<string, string[]>>) {
  const removed: Array<[string, string[]]> = [];
  let cleared = 0;
  const deps: AvatarDeleteDeps = {
    knownPaths: async () => ({ public: [`avatars/${UID}/actual.png`], private: [`${UID}/variantes/v1.png`, "otro/ajeno.png"] }),
    list: async (bucket, prefix) => {
      const entries = tree[bucket]?.[prefix] ?? [];
      return { files: entries.filter((e) => e.includes(".")), folders: entries.filter((e) => !e.includes(".")) };
    },
    remove: async (bucket, paths) => { removed.push([bucket, [...paths].sort()]); return { error: null }; },
    clearRows: async () => { cleared++; },
  };
  return { deps, removed, cleared: () => cleared };
}

describe("Borrar mi avatar (generate-avatar, acción eliminar)", () => {
  it("borra la copia pública y todo lo privado de la persona (base y variantes) y luego las filas", async () => {
    const s = fakeStorage({
      "travel-moments": { [`avatars/${UID}`]: ["actual.png", "anterior.png"] },
      "avatar-private": { [UID]: ["variantes", "base.png"], [`${UID}/variantes`]: ["v1.png", "v2.png"] },
    });
    const r = await deleteAvatar(s.deps, UID);
    expect(r).toEqual({ ok: true, removed: 5 });
    expect(s.removed).toEqual([
      ["travel-moments", [`avatars/${UID}/actual.png`, `avatars/${UID}/anterior.png`]],
      ["avatar-private", [`${UID}/base.png`, `${UID}/variantes/v1.png`, `${UID}/variantes/v2.png`]],
    ]);
    expect(s.cleared()).toBe(1);
  });

  it("nunca borra fuera de las carpetas de la persona", () => {
    expect(ownsAvatarPath("avatar-private", "otro/ajeno.png", UID)).toBe(false);
    expect(ownsAvatarPath("travel-moments", `${UID}/momento.jpg`, UID)).toBe(false); // momentos, no avatar
    expect(ownsAvatarPath("travel-moments", `avatars/${UID}/../x.png`, UID)).toBe(false);
    expect(ownsAvatarPath("travel-vault", `${UID}/a.jpg`, UID)).toBe(false);
  });

  it("si storage falla no limpia las filas (se puede reintentar sin quedar a medias)", async () => {
    const s = fakeStorage({ "travel-moments": { [`avatars/${UID}`]: ["actual.png"] } });
    s.deps.remove = async () => ({ error: "503" });
    expect(await deleteAvatar(s.deps, UID)).toMatchObject({ ok: false, error: "storage" });
    expect(s.cleared()).toBe(0);
  });

  it("generate-avatar tiene la acción 'eliminar' y no depende del servicio de imágenes para borrar", () => {
    const fn = readFileSync("supabase/functions/generate-avatar/index.ts", "utf8");
    const actions = [...fn.matchAll(/action === "([a-z_]+)"/g)].map((m) => m[1]);
    expect(actions).toContain("eliminar");
    expect(fn.indexOf('body?.action === "eliminar"')).toBeLessThan(fn.indexOf('Deno.env.get("LOVABLE_API_KEY")'));
    const legal = readFileSync("src/pages/Legal.tsx", "utf8");
    expect(legal).toContain("Puedes eliminar tu avatar y tu foto desde tu perfil");
    const profile = readFileSync("src/pages/Profile.tsx", "utf8");
    expect(profile).toMatch(/Borrar mi avatar/);
    expect(profile).toMatch(/invoke\("generate-avatar", \{ body: \{ action: "eliminar" \} \}\)/);
  });
});

describe("N-L1: profiles.avatar_url solo la escribe el servidor", () => {
  it("Profile y OnboardingDeep ya no la escriben desde el navegador", () => {
    for (const f of ["src/pages/Profile.tsx", "src/pages/OnboardingDeep.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/update\(\{\s*avatar_url/);
    }
  });

  it("ninguna pantalla escribe avatar_url en profiles", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("grep -rln 'avatar_url' src --include=*.ts --include=*.tsx || true", { encoding: "utf8" });
    for (const file of out.split("\n").filter((f) => f && !f.includes("/test/") && !f.endsWith("types.ts"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\.update\(\{[^}]*avatar_url/);
    }
  });

  it("generate-avatar (elegir) y avatar-evolve guardan con la llave de servicio (publishAvatar con admin())", () => {
    const runtime = readFileSync("supabase/functions/_shared/avatar-runtime.ts", "utf8");
    expect(runtime).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(runtime).toMatch(/await db\.from\("profiles"\)\.update\(\{ avatar_url: url \}\)/);
    const gen = readFileSync("supabase/functions/generate-avatar/index.ts", "utf8");
    expect(gen).toMatch(/const db = admin\(\);/);
    expect(gen).toMatch(/publishAvatar\(db, uid/);
    const evo = readFileSync("supabase/functions/avatar-evolve/index.ts", "utf8");
    expect(evo).toMatch(/const db = admin\(\);/);
  });
});
