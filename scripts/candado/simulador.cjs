// Servidor de datos SIMULADO para las capturas del candado visual (scripts/candado/visual.cjs).
// Nada sale a internet: Supabase, Pexels y las portadas de Google se responden aquí con datos fijos, y la
// fecha del navegador se congela, para que la misma pantalla salga igual hoy y dentro de un mes.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const MOCK_ORIGIN = "http://supabase-mock.localhost:54399";
const MOCK_HOST = "supabase-mock.localhost:54399";
/** Fecha fija de las capturas (mediodía en la Ciudad de México). */
const FECHA_FIJA = "2026-10-29T18:00:00Z";
const USER_ID = "00000000-0000-4000-8000-00000000ca10";

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const EXP = Math.floor(Date.parse(FECHA_FIJA) / 1000) + 10 * 365 * 86400;
const JWT = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: USER_ID, exp: EXP, role: "authenticated", aud: "authenticated", session_id: "s" })}.simulado`;
const USER = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "carlo.simulado@example.com", user_metadata: { full_name: "Carlo Simulado" }, app_metadata: { provider: "email" }, created_at: "2026-01-01T00:00:00Z" };
const SESSION = { access_token: JWT, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: EXP, user: USER };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

const T = (id, destino, pais, salida, regreso, extra = {}) => ({
  id, user_id: USER_ID, destino, pais_destino: pais, ciudad_origen: "Ciudad de México", fecha_salida: salida, fecha_regreso: regreso,
  num_viajeros: 2, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", status: "cotizado", total_estimado: null,
  cover_image_url: null, itinerario_json: {}, fuente: "plan", ...extra,
});
const ITALIA = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "src/test/fixtures/italia2230848bCompleto.json"), "utf8"));
  return { ...raw, user_id: USER_ID, created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-18T10:00:00Z", total_estimado: 153166, current_quote_id: null, cover_image_url: null,
    desglose_presupuesto: { comida: 35399, extras: 3708, hospedaje: 67315, tours: 7527, transporte_local: 4285, vuelos: 34932 } };
})();
const TRIPS = [
  T("c1-tokio", "Tokio → Kioto → Osaka", "Japón", "2027-03-20", "2027-03-29", { itinerario_json: { destinations: ["Tokio", "Kioto", "Osaka"] } }),
  T("c2-lisboa", "Lisboa → Sintra → Oporto", "Portugal", "2027-04-15", "2027-04-23", { itinerario_json: { destinations: ["Lisboa", "Sintra", "Oporto"] } }),
  ITALIA,
  T("c5-madrid", "Madrid", "España", "2027-02-10", "2027-02-15", { cover_image_url: "https://lh3.googleusercontent.com/places/simulada-portada-madrid=s1600-w800" }),
];
const ago = (h) => new Date(Date.parse(FECHA_FIJA) - h * 3600_000).toISOString();
const ADMIN = { id: "d", name: "Equipo IATOS", email: "equipo@example.com" };
const OPS = {
  generated_at: FECHA_FIJA, counts: { nueva: 1, en_proceso: 1, resuelta: 3 },
  items: [
    { source: "concierge_request", id: "7e300000-0000-0000-0000-000000000001", type: "reservation", title: "Mesa en restaurante (simulado)", status: "solicitado",
      stage: "nueva", created_at: ago(1), requested_for: "2026-11-02T20:30", party_size: 4, place: "Restaurante simulado",
      payload: { fecha: "2026-11-02", hora: "20:30", personas: 4, lugar: "Restaurante simulado", detalle: "Aniversario" },
      user: { id: "a", name: "Ana Simulada", email: "ana@example.com" }, owner: null, evidence: null, alert: null, history: [], replies: [] },
    { source: "ai_reservation", id: "7e400000-0000-0000-0000-000000000001", type: "ai_reservation", title: "Reserva IA · Lugar simulado", status: "needs_user",
      stage: "en_proceso", reason: "no_contact", ref_code: "R-SIM01", created_at: ago(3), requested_for: "2026-11-03T21:00", party_size: 2, place: "Lugar simulado",
      experience: { name: "Lugar simulado", city: "Ciudad de México", country: "MX" }, venue: { phone: null },
      user: { id: "a", name: "Ana Simulada", email: "ana@example.com" }, owner: ADMIN, evidence: null, alert: null,
      history: [{ at: ago(2), kind: "note", action: "tomar", actor: "equipo", by: ADMIN }], replies: [] },
  ],
};
const GEO = { "ciudad de méxico": [19.4326, -99.1332], roma: [41.9028, 12.4964], florencia: [43.7696, 11.2558], venecia: [45.4408, 12.3155] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

/** Foto simulada: un degradado con el nombre de lo que se buscó (siempre igual para la misma búsqueda). */
function fotoSvg(texto) {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const safe = texto.replace(/[<>&"]/g, "").slice(0, 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 35% 22%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 42%)"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><text x="600" y="420" fill="#f5e6c8" font-family="sans-serif" font-size="56" text-anchor="middle">${safe}</text></svg>`;
}

async function supabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "" });
  const p = url.pathname;
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  const one = (row) => json(route, single ? row : row == null ? [] : [row]);
  if (p.startsWith("/functions/v1/")) {
    const fn = p.slice("/functions/v1/".length);
    let b = {};
    try { b = JSON.parse(req.postData() || "{}"); } catch { /* sin cuerpo */ }
    if (fn === "pexels-image") return json(route, { image: `https://images.pexels.com/photos/simulada/${encodeURIComponent(String(b.query || "foto"))}.svg`, photographer: "Simulado" });
    if (fn === "geocode") { const g = GEO[String(b.address || "").toLowerCase()]; return json(route, { results: g ? [{ lat: g[0], lng: g[1] }] : [] }); }
    if (fn === "buscar-video") return json(route, { url: null, poster: null });
    return json(route, {});
  }
  if (p.startsWith("/auth/v1/user")) return json(route, USER);
  if (p.startsWith("/auth/v1/")) return json(route, {});
  if (p.startsWith("/rest/v1/rpc/")) {
    const fn = p.slice("/rest/v1/rpc/".length);
    if (fn === "admin_ops_list") return json(route, OPS);
    return json(route, null);
  }
  if (p.startsWith("/rest/v1/trips")) {
    if (!["GET", "HEAD"].includes(req.method())) return json(route, []);
    const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
    const rows = id ? TRIPS.filter((t) => t.id === id) : TRIPS;
    return json(route, single ? rows[0] ?? null : rows);
  }
  if (p.startsWith("/rest/v1/user_onboarding_state")) return one({ user_id: USER_ID, completed_onboarding: true, completed_at: "2026-01-02T00:00:00Z", current_step: 5, selected_cards: [], selected_loyalty_airlines: [], selected_loyalty_hotels: [], travel_dna_seed: null });
  if (p.startsWith("/rest/v1/profiles")) return one({ id: USER_ID, user_id: USER_ID, full_name: "Carlo Simulado", avatar_url: null, ciudad_origen: "Ciudad de México", active_trip_id: null });
  if (p.startsWith("/rest/v1/admins")) return one({ user_id: USER_ID });
  if (p.startsWith("/rest/v1/")) return json(route, single ? null : []);
  return json(route, {});
}

/** Contexto de navegador con todo simulado. `sesion`: entra como Carlo (simulado). */
async function nuevoContexto(browser, { sesion = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    locale: "es-MX", timezoneId: "America/Mexico_City", serviceWorkers: "block", reducedMotion: "reduce",
    permissions: [], geolocation: undefined,
  });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.host === MOCK_HOST) return supabase(route).catch(() => route.abort());
    if (u.hostname === "images.pexels.com") {
      const q = decodeURIComponent((u.pathname.split("/").pop() || "").replace(/\.svg$/, ""));
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: fotoSvg(q) });
    }
    if (u.hostname.endsWith("googleusercontent.com")) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: fotoSvg("Portada guardada") });
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    // Nada más sale (texturas del globo, mapas, fuentes externas, analítica): la captura no depende de la red.
    return route.abort();
  });
  await ctx.addInitScript(([key, sess, conSesion]) => {
    try {
      if (conSesion) localStorage.setItem(key, JSON.stringify(sess));
      localStorage.setItem("iatos_cookie_consent_v2", "essential");
      localStorage.setItem("iatos_trip_tour_v1", "done");
    } catch { /* sin almacenamiento */ }
    const css = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}";
    const put = () => { if (document.getElementById("candado-css")) return; const s = document.createElement("style"); s.id = "candado-css"; s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    document.addEventListener("DOMContentLoaded", put);
  }, ["sb-supabase-mock-auth-token", SESSION, sesion]);
  return ctx;
}

module.exports = { MOCK_ORIGIN, FECHA_FIJA, TRIPS, ITALIA, nuevoContexto };
