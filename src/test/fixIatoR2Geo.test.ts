// Auditoría 10, ronda 2 (#15): 400 de api.bigdatacloud.net en la consola. El navegador ya no llama a
// ese servicio: usa la función geocode de IATOS (Geocoding de Google con caché), que siempre responde 200.
import { describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { placeFromGeocode, reversePlace, roundLatLng } from "../../supabase/functions/_shared/reverseGeo";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";

const GOOGLE_CDMX = { status: "OK", results: [{ address_components: [
  { long_name: "Centro", short_name: "Centro", types: ["sublocality"] },
  { long_name: "Ciudad de México", short_name: "CDMX", types: ["locality", "political"] },
  { long_name: "México", short_name: "MX", types: ["country", "political"] },
] }] };

describe("#15 · nombre del lugar sin servicios de terceros en el navegador", () => {
  it("ningún archivo de la app llama a bigdatacloud", () => {
    const hits = execSync("grep -rlnE 'https?://[a-z.]*bigdatacloud' src index.html public || true", { encoding: "utf8" }).split("\n").filter((f) => f && !f.startsWith("src/test/"));
    expect(hits).toEqual([]);
  });
  it("Google → ciudad y país; 2 decimales; caché por zona (una sola llamada a Google)", async () => {
    expect(placeFromGeocode(GOOGLE_CDMX)).toEqual({ city: "Ciudad de México", country_code: "MX", label: "Ciudad de México" });
    expect(roundLatLng("19.43251,-99.13321")).toMatchObject({ key: "19.43,-99.13" });
    const store = memoryCacheStore(() => 0);
    const geocode = vi.fn(async () => ({ ok: true, json: GOOGLE_CDMX }));
    expect(await reversePlace("19.43251,-99.13321", { store, geocode, now: () => 0 })).toMatchObject({ city: "Ciudad de México", country_code: "MX" });
    expect(await reversePlace("19.4329,-99.1349", { store, geocode, now: () => 0 })).toMatchObject({ city: "Ciudad de México", from_cache: true });
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode.mock.calls[0]).toEqual(["19.43,-99.13"]);
  });
  it("si Google falla: city null, sin lanzar (la función responde 200 y la consola queda limpia)", async () => {
    expect(await reversePlace("19.43,-99.13", { geocode: async () => { throw new Error("x"); } })).toEqual({ city: null, country_code: null, label: null });
    expect(await reversePlace("no-coords", { geocode: async () => ({ ok: true, json: GOOGLE_CDMX }) })).toMatchObject({ city: null });
  });
});
