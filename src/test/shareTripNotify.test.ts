import { describe, expect, it } from "vitest";
import { buildShareNotification, cleanPlace, MAX_FRIENDS, parseShareBody } from "../../supabase/functions/share-trip-notify/template";

const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";

describe("share-trip-notify: plantilla fija (F-19)", () => {
  it("ignora title, message y url libres del cliente", () => {
    const input = parseShareBody({
      friend_ids: [F1], title: "Tu cuenta será suspendida", message: "Entra a https://phish.example ya",
      url: "https://phish.example/login", destinos: ["Roma", "Florencia"], fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15",
    });
    expect(input).not.toBeNull();
    const n = buildShareNotification("Ana", input!, "https://traveliatos.life");
    expect(n.title).toBe("Ana te compartió un viaje ✈️");
    expect(n.body).toBe("Mira este viaje que estoy armando con IATOS AI: Roma → Florencia (10/11/2026 → 15/11/2026).");
    expect(`${n.title} ${n.body}`).not.toMatch(/phish|suspendida/);
  });

  it("solo enlaza rutas internas de la app, con el dominio de la app", () => {
    const ok = parseShareBody({ friend_ids: [F1], path: "/dashboard/planear?destino=Roma" })!;
    expect(buildShareNotification("Ana", ok, "https://traveliatos.life").body)
      .toMatch(/\nhttps:\/\/traveliatos\.life\/dashboard\/planear\?destino=Roma$/);
    for (const path of ["https://evil.example", "//evil.example/x", "javascript:alert(1)", "/dashboard/<script>"]) {
      expect(parseShareBody({ friend_ids: [F1], path })!.path, path).toBeNull();
    }
  });

  it("los destinos son texto corto sin URLs ni marcado", () => {
    expect(cleanPlace("Roma <b>gratis</b> https://phish.example")).toBe("Roma bgratis/b");
    expect(cleanPlace("x".repeat(200))).toHaveLength(60);
    expect(cleanPlace("   ")).toBeNull();
  });

  it("valida ids de amigos, quita duplicados y pone tope", () => {
    expect(parseShareBody({ friend_ids: ["no-uuid"] })).toBeNull();
    expect(parseShareBody({ friend_ids: [F1, F1, F2] })!.friendIds).toEqual([F1, F2]);
    const many = Array.from({ length: 50 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(parseShareBody({ friend_ids: many })!.friendIds).toHaveLength(MAX_FRIENDS);
  });

  it("fechas que no son ISO se descartan", () => {
    const i = parseShareBody({ friend_ids: [F1], fecha_salida: "mañana <img>", destinos: [] })!;
    expect(buildShareNotification("", i, "https://traveliatos.life")).toEqual({
      title: "Un amigo te compartió un viaje ✈️",
      body: "Mira este viaje que estoy armando con IATOS AI.",
    });
  });
});
