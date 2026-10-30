// Canales (30-oct-2026): Iato completo por Telegram y WhatsApp con la sesión del viajero, el Operador por el mismo canal,
// preferencias (canal preferido y no molestar), ventana de 24 h de WhatsApp y voz preparada (apagada). Todo con mocks:
// nada sale a la red, ningún mensaje ni llamada real.
import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeCanalesDb, type FakeCanalesDb } from "./helpers/fakeCanalesDb";
import { atenderCanal, type CanalDeps, vaAlCaso } from "../../supabase/functions/_shared/channels/conversacion";
import { crearIatoCanal, elegirViajeParaGasto } from "../../supabase/functions/_shared/channels/iatoCanal";
import { abrirSesionDeUsuario, type AdminAuthLike, type AnonAuthLike } from "../../supabase/functions/_shared/channels/sesionUsuario";
import { canalDeLlamada, notaCanal } from "../../supabase/functions/_shared/channels/modoCanal";
import { armarMensajes, leerBoton, markdownATelegram, markdownAWhatsApp, type MensajeCanal } from "../../supabase/functions/_shared/channels/formato";
import { enNoMolestar, finDeNoMolestar, normalizarPreferencias, planDeEntrega } from "../../supabase/functions/_shared/channels/preferencias";
import { avisarUsuario, entregarDiferidos, type EntregaDeps } from "../../supabase/functions/_shared/channels/entrega";
import {
  enlaceWaMe, metaButtonsPayload, parseMetaWebhook, parseTwilioForm, PLANTILLAS_WHATSAPP, proveedorWhatsApp, secretosWhatsApp, tituloBoton,
  verificarSuscripcionMeta, verifyMetaSignature, verifyTwilioSignature, whatsappChannel, whatsappProveedor, whatsappVerifyToken,
} from "../../supabase/functions/_shared/channels/whatsapp";
import { inlineKeyboard, linkCodeIn, newLinkCode, parseTelegramUpdate } from "../../supabase/functions/_shared/channels/telegram";
import { cuerpoLlamadaVapi, firmaLlamada, leerFinDeLlamada, registrarLlamada, verificarFirmaLlamada, vozVapi } from "../../supabase/functions/_shared/channels/voz";
import { INTERNAL_HEADER, signInternal } from "../../supabase/functions/_shared/internalCall";
import { evaluateRateLimit } from "../../supabase/functions/_shared/rate-limit-core";
import type { ChannelSendResult } from "../../supabase/functions/_shared/channels/types";

afterEach(() => { vi.useRealTimers(); });

const SECRET = "service-role-de-prueba";
const ANA = "0c000000-0000-4000-8000-00000000000a";
const BETO = "0c000000-0000-4000-8000-00000000000b";
const VIAJE_ANA = "0a000000-0000-4000-8000-0000000000aa";
const VIAJE_BETO = "0b000000-0000-4000-8000-0000000000bb";
const sha = async (s: string) => createHash("sha256").update(s).digest("hex");

/** Backend falso (PostgREST, Storage, concierge-chat y scan-receipt) que solo responde con los datos DEL DUEÑO del token. */
function backend() {
  const userDeToken = (h: Headers) => ({ "Bearer tok-ana": ANA, "Bearer tok-beto": BETO } as Record<string, string>)[h.get("authorization") ?? ""] ?? null;
  const datos: Record<string, { viaje: { id: string; destino: string; fecha_salida: string; fecha_regreso: string }; historial: Array<{ role: string; content: string }>; clima: string }> = {
    [ANA]: { viaje: { id: VIAJE_ANA, destino: "Roma", fecha_salida: "2026-10-28", fecha_regreso: "2026-11-05" }, historial: [{ role: "user", content: "Estoy en Roma" }, { role: "assistant", content: "¡Disfruta Roma!" }], clima: "Roma: 18 °C y soleado" },
    [BETO]: { viaje: { id: VIAJE_BETO, destino: "Tokio", fecha_salida: "2026-10-29", fecha_regreso: "2026-11-02" }, historial: [{ role: "user", content: "Llegué a Tokio" }], clima: "Tokio: 14 °C y lluvia" },
  };
  const llamadas: Array<{ url: string; method: string; user: string | null; canal: string | null; body: unknown }> = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers);
    const user = userDeToken(h);
    let body: unknown = null;
    if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    // La firma interna se verifica como lo hace concierge-chat: atada al dueño del token.
    const modo = user ? await canalDeLlamada(h, SECRET, user, Date.now()) : { canal: null, invalido: false };
    llamadas.push({ url, method: init?.method ?? "GET", user, canal: modo.canal, body });
    if (!user || modo.invalido) return new Response(JSON.stringify({ code: "UNAUTHENTICATED", message: "Tu sesión expiró." }), { status: 401 });
    const d = datos[user];
    if (url.includes("/rest/v1/concierge_conversations")) return Response.json([{ trip_id: d.viaje.id, messages: d.historial, updated_at: new Date().toISOString() }]);
    if (url.includes("/rest/v1/trips")) return Response.json([d.viaje]);
    if (url.includes("/rest/v1/profiles")) return Response.json([{ active_trip_id: null }]);
    if (url.includes("/storage/v1/object/trip-receipts/")) {
      const path = url.split("/trip-receipts/")[1];
      // Política de Storage: <viaje>/<quien sube>/<archivo>, y solo el dueño del token.
      if (path.split("/")[1] !== user) return new Response("{}", { status: 403 });
      return Response.json({ Key: path });
    }
    if (url.endsWith("/functions/v1/scan-receipt")) return Response.json({ ok: true, receipt: { merchant: "Trattoria da Enzo", date: "2026-10-30", total: 62.5, currency: "EUR", tip: 5, confidence: "media", warnings: ["La fecha está borrosa"] } });
    if (url.endsWith("/functions/v1/concierge-chat")) {
      const b = body as { mode?: string; action?: { type?: string; params?: Record<string, unknown> }; messages?: Array<{ content: string }> };
      if (b.mode === "action") return Response.json({ ok: true, message: "Gasto registrado.", link: "/dashboard/gastos" });
      return Response.json({
        text: `**${d.clima}**. Tu viaje a ${d.viaje.destino} va bien.`,
        cards: [{ type: "weather", title: d.clima, subtitle: "MET Norway", links: [{ kind: "website", label: "Pronóstico", url: "https://www.yr.no/" }] }],
        actions: user === ANA ? [{ id: "act-1", type: "add_expense", params: { monto: 450, moneda: "EUR", trip_id: VIAJE_ANA }, summary: "Registrar gasto: €450 · Restaurantes", confirm_label: "Registrar gasto", runs: "server" }] : [],
      });
    }
    return new Response("{}", { status: 404 });
  });
  return { fetch: f as unknown as typeof fetch, llamadas };
}

function montar(o: { canal?: "telegram" | "whatsapp"; twilio?: boolean; db?: FakeCanalesDb; sesion?: (u: string) => Promise<{ ok: true; token: string; cerrar: () => Promise<void> } | { ok: false; code: "FALLO" }> } = {}) {
  const db = o.db ?? fakeCanalesDb();
  const be = backend();
  const sesiones: string[] = [];
  const cerradas: string[] = [];
  const iato = crearIatoCanal({
    supabaseUrl: "https://proyecto.supabase.co", anonKey: "anon", canal: o.canal ?? "telegram", fetch: be.fetch,
    sesion: o.sesion ?? (async (u) => { sesiones.push(u); return { ok: true, token: u === ANA ? "tok-ana" : "tok-beto", cerrar: async () => { cerradas.push(u); } }; }),
    firmar: (u) => signInternal(SECRET, u, (o.canal ?? "telegram") === "telegram" ? "canal_telegram" : "canal_whatsapp"),
  });
  const enviados: Array<{ to: string; m: MensajeCanal }> = [];
  const botones: string[] = [];
  const despertados: string[] = [];
  const deps: CanalDeps = {
    canal: o.canal ?? "telegram", db, twilio: o.twilio,
    enviar: async (to, m) => { enviados.push({ to, m }); },
    escribiendo: async () => undefined,
    responderBoton: async (id) => { botones.push(id); },
    descargar: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg" }),
    reportar: vi.fn(async (i) => ({ ok: true, id: db.abrirCaso(i.userId), folio: "X", created: true, texto: "Abrí tu caso. Folio ABCD1234. Esto puedes hacer ya…" }) as never),
    despertar: async (id) => { despertados.push(id); },
    sha256: sha, appUrl: "https://traveliatos.life/dashboard", iato,
  };
  let seq = 1000;
  const tg = (chat: number, extra: Record<string, unknown>) => parseTelegramUpdate({ update_id: ++seq, message: { message_id: seq, date: 1_793_000_000, chat: { id: chat, type: "private" }, from: { id: chat, username: `u${chat}` }, ...extra } })[0];
  const boton = (chat: number, data: string) => parseTelegramUpdate({ update_id: ++seq, callback_query: { id: `cb${seq}`, data, from: { id: chat }, message: { message_id: 1, chat: { id: chat, type: "private" } } } })[0];
  return { db, be, deps, enviados, botones, despertados, sesiones, cerradas, tg, boton, ultimo: () => enviados.at(-1)!.m };
}

// ═══════════════════════════ Firmas de webhooks ═══════════════════════════

describe("firmas de webhooks", () => {
  it("Meta: X-Hub-Signature-256 = HMAC-SHA256 del cuerpo crudo con el app secret (cambiar un byte → rechazo)", async () => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "5215512345678", type: "text", text: { body: "hola" } }] } }] }] });
    const firma = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    expect(await verifyMetaSignature(firma, raw, "app-secret")).toBe(true);
    expect(await verifyMetaSignature(firma, raw.replace("hola", "hole"), "app-secret")).toBe(false);
    expect(await verifyMetaSignature(firma, raw, "otro")).toBe(false);
    expect(await verifyMetaSignature(null, raw, "app-secret")).toBe(false);
    expect(await verifyMetaSignature(firma.replace("sha256=", ""), raw, "app-secret")).toBe(false);
  });

  it("Meta: verificación GET del webhook (hub.challenge solo con el token correcto)", async () => {
    const token = await whatsappVerifyToken("app-secret");
    expect(token).toMatch(/^[0-9a-f]{40}$/);
    expect(await whatsappVerifyToken("app-secret", "mi_token_propio_12345")).toBe("mi_token_propio_12345");
    const u = (q: string) => new URL(`https://x/functions/v1/whatsapp-webhook?${q}`);
    expect(verificarSuscripcionMeta(u(`hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`), token)).toBe("1158201444");
    expect(verificarSuscripcionMeta(u(`hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1158201444`), token)).toBeNull();
    expect(verificarSuscripcionMeta(u(`hub.mode=unsubscribe&hub.verify_token=${token}&hub.challenge=1`), token)).toBeNull();
    expect(verificarSuscripcionMeta(u(`hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=<script>`), token)).toBeNull();
  });

  it("Twilio: X-Twilio-Signature = base64(HMAC-SHA1(URL + parámetros ordenados))", async () => {
    const url = "https://proyecto.supabase.co/functions/v1/whatsapp-webhook";
    const params = { From: "whatsapp:+5215512345678", Body: "hola", MessageSid: "SM1" };
    const firma = createHmac("sha1", "auth").update(url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("")).digest("base64");
    expect(await verifyTwilioSignature(firma, url, params, "auth")).toBe(true);
    expect(await verifyTwilioSignature(firma, `${url}?x=1`, params, "auth")).toBe(false);
    expect(await verifyTwilioSignature(firma, url, { ...params, Body: "adiós" }, "auth")).toBe(false);
  });

  it("voz (Vapi): el encabezado x-iatos-voz va firmado y atado al caso; vence a las 2 h", async () => {
    const caso = "0e000000-0000-4000-8000-000000000001";
    const t = Date.UTC(2026, 9, 30, 12);
    const h = (await firmaLlamada("voz-secreto", caso, t))!;
    expect(await verificarFirmaLlamada(h, "voz-secreto", t + 60_000)).toBe(caso);
    expect(await verificarFirmaLlamada(h, "otro", t)).toBeNull();
    expect(await verificarFirmaLlamada(h, "voz-secreto", t + 3 * 3600_000)).toBeNull();
    expect(await verificarFirmaLlamada(h.replace(caso, "0e000000-0000-4000-8000-000000000002"), "voz-secreto", t)).toBeNull();
  });

  it("concierge-chat por canal: la firma interna vale solo para ESE usuario y ese propósito", async () => {
    const t = Date.now();
    const hdr = (v: string | null) => ({ get: (n: string) => (n === INTERNAL_HEADER ? v : null) });
    const tg = await signInternal(SECRET, ANA, "canal_telegram", t);
    expect(await canalDeLlamada(hdr(null), SECRET, ANA, t)).toEqual({ canal: null, invalido: false });
    expect(await canalDeLlamada(hdr(tg), SECRET, ANA, t)).toEqual({ canal: "telegram", invalido: false });
    expect(await canalDeLlamada(hdr(await signInternal(SECRET, ANA, "canal_whatsapp", t)), SECRET, ANA, t)).toEqual({ canal: "whatsapp", invalido: false });
    // De otro usuario, alterada, vencida o de "análisis": se rechaza (no se ignora en silencio).
    expect((await canalDeLlamada(hdr(tg), SECRET, BETO, t)).invalido).toBe(true);
    expect((await canalDeLlamada(hdr(tg!.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), SECRET, ANA, t)).invalido).toBe(true);
    expect((await canalDeLlamada(hdr(tg), SECRET, ANA, t + 11 * 60_000)).invalido).toBe(true);
    expect((await canalDeLlamada(hdr(await signInternal(SECRET, ANA, "analysis", t)), SECRET, ANA, t)).invalido).toBe(true);
    expect(notaCanal("telegram")).toMatch(/Telegram[\s\S]*breve/);
  });

  it("la cubeta por IP se omite solo cuando se pide (llamada interna firmada); las del usuario siguen", async () => {
    const hits: string[] = [];
    const hit = async (subject: string) => { hits.push(subject); return true; };
    await evaluateRateLimit(hit, "concierge-chat", ANA, "203.0.113.9", { skipIp: true });
    expect(hits).toEqual([`user:${ANA}`, `user:${ANA}`]);
    hits.length = 0;
    await evaluateRateLimit(hit, "concierge-chat", ANA, "203.0.113.9", {});
    expect(hits).toContain("ip:203.0.113.9");
  });
});

// ═══════════════════════════ Vinculación ═══════════════════════════

describe("vinculación por código (Telegram y WhatsApp)", () => {
  it("WhatsApp: el enlace wa.me trae «IATOS CÓDIGO»; se canjea una vez y el chat queda ligado a esa cuenta", async () => {
    const x = montar({ canal: "whatsapp" });
    const code = newLinkCode();
    expect(linkCodeIn(`IATOS ${code}`)).toBe(code);
    expect(enlaceWaMe("+5215500000000", code)).toBe(`https://wa.me/5215500000000?text=IATOS%20${code}`);
    const msg = (id: string, text: string) => parseMetaWebhook({ entry: [{ changes: [{ value: { messages: [{ id, from: "5215511112222", timestamp: "1793000000", type: "text", text: { body: text } }] } }] }] })[0];
    expect((await atenderCanal(x.deps, msg("w1", "hola"))).accion).toBe("sin_vincular");
    expect(x.ultimo().texto).toMatch(/Perfil → Ajustes → WhatsApp/);
    x.db.codigo(ANA, "whatsapp", code);
    expect((await atenderCanal(x.deps, msg("w2", `IATOS ${code}`))).accion).toBe("vinculado");
    expect((await atenderCanal(x.deps, msg("w3", `IATOS ${code}`))).accion).toBe("codigo_invalido");
    expect((await atenderCanal(x.deps, msg("w3", `IATOS ${code}`))).accion).toBe("duplicado");
    // Un código de Telegram no sirve en WhatsApp.
    const tgCode = newLinkCode();
    x.db.codigo(BETO, "telegram", tgCode);
    expect((await atenderCanal(x.deps, msg("w4", `IATOS ${tgCode}`))).accion).toBe("codigo_invalido");
    expect(x.db.links.filter((l) => l.active)).toEqual([expect.objectContaining({ user: ANA, channel: "whatsapp", external: "+5215511112222" })]);
  });
});

// ═══════════════════════════ Conversación completa por Telegram ═══════════════════════════

describe("Telegram: conversación completa con Iato y sus herramientas", () => {
  it("ubicación → pregunta (clima, viaje, gasto) → botón Confirmar → foto de ticket; todo con la sesión del viajero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
    const x = montar();
    const code = newLinkCode();
    x.db.codigo(ANA, "telegram", code);
    expect((await atenderCanal(x.deps, x.tg(111, { text: `/start ${code}` }))).accion).toBe("vinculado");
    expect(x.ultimo().texto).toMatch(/Planear y preguntar por tu viaje[\s\S]*foto de un ticket[\s\S]*«Confirmar»/);

    // Ubicación compartida (2 h).
    expect((await atenderCanal(x.deps, x.tg(111, { location: { latitude: 41.8986, longitude: 12.4769 } }))).accion).toBe("ubicacion");
    expect(x.ultimo().texto).toMatch(/Tengo tu ubicación/);

    // Pregunta normal → Iato (concierge-chat) con su historial, su ubicación y la firma canal_telegram de ESA cuenta.
    expect((await atenderCanal(x.deps, x.tg(111, { text: "¿Qué clima hará mañana? Y regístrame la cena de 450 euros" }))).accion).toBe("iato");
    const chat = x.be.llamadas.find((l) => l.url.endsWith("/concierge-chat"))!;
    expect(chat).toMatchObject({ user: ANA, canal: "telegram" });
    expect(chat.body).toMatchObject({ stream: false, trip_id: VIAJE_ANA, client_date: "2026-10-30", tz: "America/Mexico_City", context: { coords: { lat: 41.8986, lng: 12.4769 } } });
    expect((chat.body as { messages: Array<{ content: string }> }).messages.map((m) => m.content)).toEqual(["Estoy en Roma", "¡Disfruta Roma!", "¿Qué clima hará mañana? Y regístrame la cena de 450 euros"]);
    // Formato de Telegram: negritas y tarjeta con su enlace; la acción aparte con Confirmar/Cancelar.
    const [respuesta, accion] = x.enviados.slice(-2).map((e) => e.m);
    expect(respuesta.texto).toContain("<b>Roma: 18 °C y soleado</b>");
    expect(respuesta.texto).toContain('<a href="https://www.yr.no/">');
    expect(accion.texto).toMatch(/Registrar gasto: €450/);
    const ref = leerBoton(accion.botones[0].data)!.ref;
    expect(accion.botones.map((b) => b.data)).toEqual([`a:${ref}:s`, `a:${ref}:n`]);
    // La sesión se abrió para Ana y se cerró al terminar.
    expect(x.sesiones).toEqual([ANA]);
    expect(x.cerradas).toEqual([ANA]);

    // Confirmar → concierge-chat mode=action (vuelve a validar con sus viajes), idempotente por botón.
    expect((await atenderCanal(x.deps, x.boton(111, `a:${ref}:s`))).accion).toBe("accion_confirmada");
    const acc = x.be.llamadas.filter((l) => l.url.endsWith("/concierge-chat")).at(-1)!;
    expect(acc).toMatchObject({ user: ANA, canal: "telegram" });
    expect(acc.body).toMatchObject({ mode: "action", action: { type: "add_expense", params: { monto: 450, moneda: "EUR" } }, action_id: "act-1", idempotency_key: `canal-${ref}` });
    expect(x.ultimo()).toEqual({ texto: "✅ Gasto registrado.", botones: [{ texto: "Ver en la app", url: "https://traveliatos.life/dashboard/gastos" }] });
    expect(x.botones.length).toBe(1);
    // El mismo botón otra vez: no se ejecuta de nuevo.
    expect((await atenderCanal(x.deps, x.boton(111, `a:${ref}:s`))).accion).toBe("accion_invalida");
    expect(x.ultimo().texto).toMatch(/ya quedó atendido/);
    expect(x.be.llamadas.filter((l) => (l.body as { mode?: string })?.mode === "action").length).toBe(1);

    // Foto de un ticket → se sube con SU sesión a trip-receipts/<viaje>/<ella>/, se lee, se borra y se propone el gasto.
    expect((await atenderCanal(x.deps, x.tg(111, { photo: [{ file_id: "AgACAgEAAx0small_____", width: 90, height: 90, file_size: 1000 }, { file_id: "AgACAgEAAx0grande_____", width: 1280, height: 960, file_size: 90_000 }], caption: "cena" }))).accion).toBe("ticket");
    const sube = x.be.llamadas.find((l) => l.url.includes("/storage/v1/object/trip-receipts/") && l.method === "POST")!;
    expect(sube.url).toMatch(new RegExp(`/trip-receipts/${VIAJE_ANA}/${ANA}/canal-\\d+\\.jpg$`));
    expect(x.be.llamadas.find((l) => l.url.endsWith("/scan-receipt"))).toMatchObject({ user: ANA, canal: "telegram", body: { trip_id: VIAJE_ANA } });
    expect(x.be.llamadas.some((l) => l.url === sube.url && l.method === "DELETE")).toBe(true);
    const [leido, gasto] = x.enviados.slice(-2).map((e) => e.m);
    expect(leido.texto).toMatch(/Leí tu ticket de Trattoria da Enzo: 62.5 EUR/);
    expect(gasto.texto).toMatch(/Registrar gasto: 62.5 EUR · Trattoria da Enzo · cena · 2026-10-30/);
    expect(gasto.texto).toMatch(/confianza media/);
    expect(gasto.botones[0].texto).toBe("✅ Registrar gasto");
    // Cancelar no ejecuta nada.
    const ref2 = leerBoton(gasto.botones[1].data)!.ref;
    expect((await atenderCanal(x.deps, x.boton(111, `a:${ref2}:n`))).accion).toBe("accion_cancelada");
    expect(x.be.llamadas.filter((l) => (l.body as { mode?: string })?.mode === "action").length).toBe(1);
  });

  it("un problema abre el caso con la guía (sin depender de la IA) y lo que responde al operador entra al caso", async () => {
    const x = montar();
    x.db.vincular(ANA, "telegram", "111");
    const r = await atenderCanal(x.deps, x.tg(111, { text: "Llegué a Cancún y el chofer no llegó, ya pasó una hora" }));
    expect(r.accion).toBe("caso_nuevo");
    expect(x.deps.reportar).toHaveBeenCalledWith(expect.objectContaining({ userId: ANA, canal: "telegram", origen: "canal" }));
    expect(x.despertados).toEqual([r.incidentId]);
    expect(x.be.llamadas.length).toBe(0);
    // El operador le escribió hace poco: su respuesta va al caso, no a Iato.
    x.db.casos.get(ANA)!.lastToUserAt = new Date(Date.now() - 20 * 60_000).toISOString();
    expect((await atenderCanal(x.deps, x.tg(111, { text: "Terminal 2, puerta B" }))).accion).toBe("al_caso");
    expect(x.db.casos.get(ANA)!.events.at(-1)).toMatchObject({ actor: "usuario", channel: "telegram", direction: "entrante", body: "Terminal 2, puerta B" });
  });

  it("con un caso abierto, una pregunta que no es del caso va a Iato con el recordatorio del folio; «caso:» lo manda al operador", async () => {
    const x = montar();
    x.db.vincular(ANA, "telegram", "111");
    const id = x.db.abrirCaso(ANA, new Date(Date.now() - 6 * 3600_000).toISOString());
    expect((await atenderCanal(x.deps, x.tg(111, { text: "¿Qué clima hará mañana?" }))).accion).toBe("iato");
    expect(x.enviados[0].m.texto).toMatch(/sigue abierto: para escribirle al operador, empieza tu mensaje con «caso»/);
    expect((await atenderCanal(x.deps, x.tg(111, { text: "caso: ya me dieron otra habitación" }))).accion).toBe("al_caso");
    expect(x.db.casos.get(ANA)!.events.at(-1)).toMatchObject({ body: "ya me dieron otra habitación" });
    expect(id).toBeTruthy();
    const ahora = new Date();
    const caso = { id, lastToUserAt: new Date(ahora.getTime() - 3600_000).toISOString() };
    expect(vaAlCaso("Terminal 2", caso, ahora)).toBe(true);
    expect(vaAlCaso("¿dónde ceno hoy?", { ...caso, lastToUserAt: new Date(ahora.getTime() - 5 * 3600_000).toISOString() }, ahora)).toBe(false);
    expect(vaAlCaso("sí", { ...caso, lastToUserAt: new Date(ahora.getTime() - 5 * 3600_000).toISOString() }, ahora)).toBe(true);
    expect(vaAlCaso("Sí, envía C-AB12CD", { ...caso, lastToUserAt: null }, ahora)).toBe(true);
    expect(vaAlCaso("hola", null, ahora)).toBe(false);
  });

  it("sin Iato configurado (CANALES_IATO=off) se comporta como antes: problemas al operador y lo demás a la app", async () => {
    const x = montar();
    x.deps.iato = null;
    x.db.vincular(ANA, "telegram", "111");
    expect((await atenderCanal(x.deps, x.tg(111, { text: "¿Qué clima hará mañana?" }))).accion).toBe("general");
    expect(x.ultimo().texto).toMatch(/Para planear o buscar, sigue en la app/);
    expect((await atenderCanal(x.deps, x.tg(111, { photo: [{ file_id: "AgACAgEAAx0grande_____", width: 10, height: 10 }] }))).accion).toBe("ticket_error");
    expect(x.be.llamadas.length).toBe(0);
  });

  it("si Iato no responde (cuota del plan gratis, IA caída) se dice con el mensaje del servidor; el plan lo decide concierge-chat", async () => {
    const x = montar();
    x.db.vincular(ANA, "telegram", "111");
    const f = vi.fn(async () => new Response(JSON.stringify({ code: "FREE_LIMIT_REACHED", message: "Usaste tus 15 mensajes gratis de este mes." }), { status: 402 }));
    x.deps.iato = crearIatoCanal({ supabaseUrl: "https://p.supabase.co", anonKey: "a", canal: "telegram", fetch: f as unknown as typeof fetch,
      sesion: async () => ({ ok: true, token: "tok-ana", cerrar: async () => undefined }), firmar: (u) => signInternal(SECRET, u, "canal_telegram") });
    expect((await atenderCanal(x.deps, x.tg(111, { text: "Planea mi día en Roma" }))).accion).toBe("iato_error");
    expect(x.ultimo().texto).toBe("Usaste tus 15 mensajes gratis de este mes. Puedes pasarte a PRO en la app (Perfil → Plan).");
  });
});

// ═══════════════════════════ Aislamiento entre usuarios ═══════════════════════════

describe("aislamiento: un usuario nunca ve datos de otro", () => {
  it("cada chat habla con la sesión de SU cuenta; el botón de Ana no sirve desde el chat de Beto", async () => {
    const x = montar();
    x.db.vincular(ANA, "telegram", "111");
    x.db.vincular(BETO, "telegram", "222");
    await atenderCanal(x.deps, x.tg(111, { text: "¿Cómo va mi viaje?" }));
    const refAna = leerBoton(x.enviados.at(-1)!.m.botones[0].data)!.ref;
    const n = x.enviados.length;
    await atenderCanal(x.deps, x.tg(222, { text: "¿Cómo va mi viaje?" }));
    const paraBeto = x.enviados.slice(n).filter((e) => e.to === "222").map((e) => e.m.texto).join("\n");
    expect(paraBeto).toMatch(/Tokio/);
    expect(paraBeto).not.toMatch(/Roma/);
    expect(x.enviados.slice(n).every((e) => e.to === "222")).toBe(true);
    expect(x.sesiones).toEqual([ANA, BETO]);
    expect(x.be.llamadas.filter((l) => l.url.endsWith("/concierge-chat")).map((l) => l.user)).toEqual([ANA, BETO]);
    // Beto toca (o fabrica) el botón de Ana desde su chat → nada.
    expect((await atenderCanal(x.deps, x.boton(222, `a:${refAna}:s`))).accion).toBe("accion_invalida");
    expect(x.be.llamadas.some((l) => (l.body as { mode?: string })?.mode === "action")).toBe(false);
    expect(x.sesiones).toEqual([ANA, BETO]);
    // Si Ana desvincula y otra cuenta toma ese chat, su botón viejo tampoco sirve.
    x.db.vincular(BETO, "telegram", "111");
    expect((await atenderCanal(x.deps, x.boton(111, `a:${refAna}:s`))).accion).toBe("accion_invalida");
    expect(x.be.llamadas.some((l) => (l.body as { mode?: string })?.mode === "action")).toBe(false);
  });

  it("la firma de un usuario con el token de otro no pasa (el backend lo rechaza)", async () => {
    const be = backend();
    const iato = crearIatoCanal({ supabaseUrl: "https://p.supabase.co", anonKey: "a", canal: "telegram", fetch: be.fetch,
      sesion: async () => ({ ok: true, token: "tok-beto", cerrar: async () => undefined }), firmar: (u) => signInternal(SECRET, u, "canal_telegram") });
    // Firma de Ana + sesión de Beto (no debería pasar nunca; aquí se fuerza): 401.
    const r = await iato.conversar(ANA, { texto: "hola", coords: null, canal: "telegram" });
    expect(r).toMatchObject({ ok: false });
    expect(be.llamadas.find((l) => l.url.endsWith("/concierge-chat"))).toMatchObject({ user: BETO, canal: null });
  });

  it("sesión del viajero: solo con correo confirmado; la sesión debe ser de ESE usuario; se cierra SOLO esa (local)", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const generateLink = vi.fn(async () => ({ data: { properties: { hashed_token: "hash-1" } }, error: null }));
    const admin = (u: Record<string, unknown> | null) => ({ auth: { admin: { getUserById: async () => ({ data: { user: u }, error: null }), generateLink, signOut } } }) as unknown as AdminAuthLike;
    const anon = (id: string) => ({ auth: { verifyOtp: vi.fn(async () => ({ data: { session: { access_token: `jwt-${id}`, user: { id } } }, error: null })) } }) as unknown as AnonAuthLike;
    const ok = await abrirSesionDeUsuario({ admin: admin({ id: ANA, email: "ana@x.test", email_confirmed_at: "2026-01-01" }), anon: anon(ANA), userId: ANA });
    expect(ok).toMatchObject({ ok: true, token: `jwt-${ANA}` });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "ana@x.test" });
    if (ok.ok) await ok.cerrar();
    expect(signOut).toHaveBeenCalledWith(`jwt-${ANA}`, "local");
    // La sesión que regresó es de otra cuenta → se cierra y se rechaza.
    signOut.mockClear();
    expect(await abrirSesionDeUsuario({ admin: admin({ id: ANA, email: "ana@x.test", email_confirmed_at: "2026-01-01" }), anon: anon(BETO), userId: ANA })).toEqual({ ok: false, code: "FALLO" });
    expect(signOut).toHaveBeenCalledWith(`jwt-${BETO}`, "local");
    generateLink.mockClear();
    expect(await abrirSesionDeUsuario({ admin: admin({ id: ANA, email: "ana@x.test", email_confirmed_at: null }), anon: anon(ANA), userId: ANA })).toEqual({ ok: false, code: "NO_CONFIRMADO" });
    expect(await abrirSesionDeUsuario({ admin: admin({ id: ANA, email: null, email_confirmed_at: "x" }), anon: anon(ANA), userId: ANA })).toEqual({ ok: false, code: "SIN_CORREO" });
    expect(await abrirSesionDeUsuario({ admin: admin({ id: ANA, email: "a@x", email_confirmed_at: "x", banned_until: "2999-01-01T00:00:00Z" }), anon: anon(ANA), userId: ANA })).toEqual({ ok: false, code: "BLOQUEADO" });
    expect(await abrirSesionDeUsuario({ admin: admin({ id: BETO, email: "b@x", email_confirmed_at: "x" }), anon: anon(BETO), userId: ANA })).toEqual({ ok: false, code: "FALLO" });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("el viaje para un ticket es uno de SUS viajes (en curso → fijado → próximo → reciente)", () => {
    const v = [
      { id: VIAJE_ANA, destino: "Roma", fecha_salida: "2026-10-28", fecha_regreso: "2026-11-05" },
      { id: VIAJE_BETO, destino: "Lima", fecha_salida: "2026-12-01", fecha_regreso: "2026-12-05" },
    ];
    expect(elegirViajeParaGasto(v, null, "2026-10-30")?.id).toBe(VIAJE_ANA);
    expect(elegirViajeParaGasto(v, VIAJE_BETO, "2026-11-20")?.id).toBe(VIAJE_BETO);
    expect(elegirViajeParaGasto(v, null, "2026-11-20")?.id).toBe(VIAJE_BETO);
    expect(elegirViajeParaGasto([v[0]], null, "2027-03-01")).toBeNull();
  });
});

// ═══════════════════════════ WhatsApp: ventana de 24 h, plantillas y formato ═══════════════════════════

describe("WhatsApp: ventana de 24 h y plantillas", () => {
  const META = { WHATSAPP_TOKEN: "EAAG-prueba", WHATSAPP_PHONE_NUMBER_ID: "1234567890", WHATSAPP_APP_SECRET: "s" } as Record<string, string>;

  it("proveedor y secretos: Meta por omisión (y alias WHATSAPP_PHONE_ID), Twilio con sus secretos", () => {
    expect(proveedorWhatsApp(() => undefined)).toBe("meta");
    expect(secretosWhatsApp(() => undefined)).toEqual(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"]);
    expect(secretosWhatsApp((k) => ({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "1", WHATSAPP_APP_SECRET: "s" } as Record<string, string>)[k])).toEqual([]);
    expect(proveedorWhatsApp((k) => (k === "TWILIO_WHATSAPP_FROM" ? "whatsapp:+1" : undefined))).toBe("twilio");
  });

  it("dentro de la ventana: texto; fuera: SOLO la plantilla aprobada; fuera y sin plantilla: no se manda nada", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => Response.json({ messages: [{ id: "wamid.OK" }] }));
    const abierta = whatsappChannel({ env: (k) => META[k], fetch: f as unknown as typeof fetch, ventana: async () => true });
    expect(await abierta.send("+5215512345678", { text: "Tu chofer llega en 10 minutos" })).toMatchObject({ ok: true, providerMessageId: "wamid.OK" });
    expect(String(f.mock.calls[0][0])).toBe("https://graph.facebook.com/v26.0/1234567890/messages");
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toMatchObject({ type: "text", to: "5215512345678", text: { body: "Tu chofer llega en 10 minutos" } });
    const cerrada = whatsappChannel({ env: (k) => META[k], fetch: f as unknown as typeof fetch, ventana: async () => false });
    await cerrada.send("+5215512345678", { text: "x" }, { plantilla: { nombre: "iatos_aviso_caso", params: ["Ana", "AB12CD34", "localizamos\na tu chofer"] } });
    expect(JSON.parse(String(f.mock.calls[1][1]!.body))).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: "5215512345678", type: "template",
      template: { name: "iatos_aviso_caso", language: { code: "es_MX" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "AB12CD34" }, { type: "text", text: "localizamos a tu chofer" }] }] },
    });
    expect(await cerrada.send("+5215512345678", { text: "x" })).toMatchObject({ ok: false, code: "CHANNEL_OFF" });
    // Sin saber la ventana se asume CERRADA.
    expect(await whatsappChannel({ env: (k) => META[k], fetch: f as unknown as typeof fetch }).send("+5215512345678", { text: "x" })).toMatchObject({ code: "CHANNEL_OFF" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("plantillas listas para Meta: utilidad, sin variables al inicio ni al final, con ejemplos", () => {
    for (const p of Object.values(PLANTILLAS_WHATSAPP)) {
      expect(p.categoria).toBe("UTILITY");
      for (const idioma of ["es_MX", "en_US"] as const) {
        const t = p.textos[idioma];
        expect(t).not.toMatch(/^\{\{/);
        expect(t.trim()).not.toMatch(/\}\}$/);
        expect(t).not.toMatch(/\}\}\s*\{\{/);
        const n = (t.match(/\{\{\d\}\}/g) ?? []).length;
        expect(p.ejemplo[idioma]).toHaveLength(n);
        expect(t.length).toBeLessThan(1024);
      }
    }
  });

  it("entrada de Meta: texto, botón, ubicación y foto; Twilio: formulario", () => {
    const v = (m: Record<string, unknown>) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "5215512345678", profile: { name: "Ana" } }], messages: [{ id: "w1", from: "5215512345678", timestamp: "1793000000", ...m }] } }] }] });
    expect(parseMetaWebhook(v({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: `a:${"a".repeat(32)}:s`, title: "Registrar gasto" } } }))[0]).toMatchObject({ boton: `a:${"a".repeat(32)}:s` });
    expect(parseMetaWebhook(v({ type: "location", location: { latitude: 19.43, longitude: -99.13, name: "Zócalo" } }))[0]).toMatchObject({ ubicacion: { lat: 19.43, lng: -99.13 }, text: "Zócalo" });
    expect(parseMetaWebhook(v({ type: "image", image: { id: "1234567", mime_type: "image/jpeg", caption: "taxi" } }))[0]).toMatchObject({ media: { ref: "1234567", mime: "image/jpeg" }, text: "taxi" });
    expect(parseMetaWebhook(v({ type: "sticker" }))).toEqual([]);
    expect(parseTwilioForm({ From: "whatsapp:+5215512345678", MessageSid: "SM1", Body: "Hola", NumMedia: "0" })[0]).toMatchObject({ from: "+5215512345678", text: "Hola" });
    expect(parseTwilioForm({ From: "whatsapp:+5215512345678", MessageSid: "SM2", Latitude: "19.4", Longitude: "-99.1" })[0]).toMatchObject({ ubicacion: { lat: 19.4, lng: -99.1 } });
    // Medios solo de api.twilio.com (no se descarga cualquier URL).
    expect(parseTwilioForm({ From: "whatsapp:+5215512345678", MessageSid: "SM3", NumMedia: "1", MediaUrl0: "https://evil.example/x.jpg" })).toEqual([]);
  });

  it("botones de WhatsApp: máx. 3, títulos ≤ 20 y únicos; por Twilio se confirma con «sí <código>»", async () => {
    const p = metaButtonsPayload("+5215512345678", "¿Lo hago?", [{ id: "a", titulo: "Registrar gasto en el viaje a Roma" }, { id: "b", titulo: "Cancelar" }, { id: "c", titulo: "Cancelar" }, { id: "d", titulo: "x" }]);
    const titulos = p.interactive.action.buttons.map((b) => b.reply.title);
    expect(titulos).toHaveLength(3);
    expect(titulos.every((t) => t.length <= 20)).toBe(true);
    expect(new Set(titulos).size).toBe(3);
    expect(tituloBoton("Registrar gasto en el viaje a Roma")).toBe("Registrar gasto en…");
    // Conversación por Twilio: la acción se confirma con "sí <8 caracteres>".
    const x = montar({ canal: "whatsapp", twilio: true });
    x.db.vincular(ANA, "whatsapp", "+5215511112222");
    const msg = (id: string, body: string) => parseTwilioForm({ From: "whatsapp:+5215511112222", MessageSid: id, Body: body })[0];
    expect((await atenderCanal(x.deps, msg("SM10", "¿Cómo va mi viaje?"))).accion).toBe("iato");
    const conf = x.enviados.at(-1)!.m.texto;
    const corto = /responde: sí ([0-9a-f]{8})/.exec(conf)![1];
    expect((await atenderCanal(x.deps, msg("SM11", `Sí ${corto}`))).accion).toBe("accion_confirmada");
    expect(x.be.llamadas.filter((l) => (l.body as { mode?: string })?.mode === "action")).toHaveLength(1);
    expect(x.be.llamadas.find((l) => (l.body as { mode?: string })?.mode === "action")).toMatchObject({ user: ANA, canal: "whatsapp" });
  });

  it("formato: el texto del modelo se escapa (sin HTML inyectado); solo enlaces https", () => {
    const h = markdownATelegram('Hola <script>alert(1)</script> **bien** [ver](https://maps.google.com/?q=a&b=c) [x](javascript:alert(1))');
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<b>bien</b>");
    expect(h).toContain('<a href="https://maps.google.com/?q=a&amp;b=c">ver</a>');
    expect(h).not.toContain("javascript:alert(1)\">");
    expect(markdownAWhatsApp("## Plan\n- **Coliseo** [mapa](https://maps.google.com/x)")).toBe("*Plan*\n• *Coliseo* mapa: https://maps.google.com/x");
    const ms = armarMensajes({ text: "Hecho", actions: [{ type: "export_calendar", runs: "client", summary: "Descargar calendario" }] }, "telegram", { guardadas: [], appUrl: "https://traveliatos.life/dashboard" });
    expect(ms[1].botones).toEqual([{ texto: "Abrir en la app", url: "https://traveliatos.life/dashboard/concierge" }]);
    expect(inlineKeyboard([{ texto: "ok", data: "x".repeat(65) }, { texto: "web", url: "http://inseguro" }])).toBeUndefined();
  });
});

// ═══════════════════════════ Preferencias: canal preferido y no molestar ═══════════════════════════

function entregaFalsa(db: FakeCanalesDb) {
  const salidas: Array<{ canal: string; to: string; texto?: string; plantilla?: string }> = [];
  const ok = (channel: ChannelSendResult["channel"], to: string): ChannelSendResult => ({ ok: true, channel, to, providerMessageId: "x" });
  const d: EntregaDeps = {
    db, siteUrl: "https://traveliatos.life",
    push: vi.fn(async (u) => { salidas.push({ canal: "push", to: u }); return 1; }),
    telegram: vi.fn(async (to, texto) => { salidas.push({ canal: "telegram", to, texto }); return ok("telegram", to); }),
    whatsapp: {
      proveedor: "meta",
      texto: vi.fn(async (to, texto) => { salidas.push({ canal: "whatsapp", to, texto }); return ok("whatsapp", to); }),
      plantilla: vi.fn(async (to, nombre) => { salidas.push({ canal: "whatsapp", to, plantilla: nombre }); return ok("whatsapp", to); }),
      botones: vi.fn(), descargar: vi.fn(),
    },
    email: vi.fn(async (to) => { salidas.push({ canal: "email", to }); return ok("email", to); }),
  };
  return { d, salidas };
}

describe("preferencias del viajero: canal preferido y horario de no molestar", () => {
  const prefs = { preferido: "whatsapp", noMolestarInicio: "22:00", noMolestarFin: "07:30", tz: "America/Mexico_City" };

  it("horario que cruza la medianoche, en la zona del viajero", () => {
    const p = normalizarPreferencias(prefs);
    // 23:30 en CDMX (UTC-6) = 05:30 UTC del día siguiente.
    expect(enNoMolestar(p, new Date("2026-10-31T05:30:00Z"))).toBe(true);
    expect(enNoMolestar(p, new Date("2026-10-31T13:00:00Z"))).toBe(true); // 07:00 local: aún no termina
    expect(enNoMolestar(p, new Date("2026-10-31T13:31:00Z"))).toBe(false); // 07:31 local
    expect(finDeNoMolestar(p, new Date("2026-10-31T05:30:00Z"))!.toISOString()).toBe("2026-10-31T13:30:00.000Z");
    expect(normalizarPreferencias({ preferido: "sms", noMolestarInicio: "25:00", noMolestarFin: "07:00", tz: "Marte/Olympus" })).toEqual({ preferido: "app", noMolestarInicio: null, noMolestarFin: null, tz: null });
  });

  it("aviso normal de noche → se guarda para el final del horario (no suena nada); al terminar sale por su canal preferido", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T05:30:00Z"));
    const db = fakeCanalesDb();
    db.setUser(ANA, "ana@x.test", "Ana");
    db.setPrefs(ANA, prefs);
    db.vincular(ANA, "whatsapp", "+5215511112222");
    db.vincular(ANA, "telegram", "111");
    const { d, salidas } = entregaFalsa(db);
    const aviso = { titulo: "IATOS · tu caso", texto: "Te conseguimos otra habitación.", url: "/dashboard/concierge", urgente: false, tipo: "caso" as const, plantilla: { nombre: "iatos_aviso_caso", params: ["Ana", "AB12", "otra habitación"] }, dedupe: "caso:1:a" };
    const r = await avisarUsuario(d, ANA, aviso);
    expect(r).toMatchObject({ modo: "diferido", entregados: 0, hasta: "2026-10-31T13:30:00.000Z" });
    expect(salidas).toEqual([]);
    // Antes de que termine: nada.
    expect(await entregarDiferidos(d)).toEqual({ procesados: 0, enviados: 0 });
    vi.setSystemTime(new Date("2026-10-31T13:31:00Z"));
    expect(await entregarDiferidos(d)).toEqual({ procesados: 1, enviados: 1 });
    // Preferido WhatsApp, ventana cerrada (nunca escribió) → plantilla aprobada, y un solo canal.
    expect(salidas).toEqual([{ canal: "whatsapp", to: "+5215511112222", plantilla: "iatos_aviso_caso" }]);
  });

  it("URGENTE de noche → por TODOS los canales disponibles, ya", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T05:30:00Z"));
    const db = fakeCanalesDb();
    db.setUser(ANA, "ana@x.test", "Ana");
    db.setPrefs(ANA, prefs);
    db.vincular(ANA, "whatsapp", "+5215511112222");
    db.vincular(ANA, "telegram", "111");
    await db.rpc("channel_link_for", { _channel: "whatsapp", _external_id: "+5215511112222" }); // escribió: ventana abierta
    const { d, salidas } = entregaFalsa(db);
    const r = await avisarUsuario(d, ANA, { titulo: "Vuelo AM401 cancelado", texto: "Tu vuelo de mañana fue cancelado.", url: "/dashboard/viajes", urgente: true, tipo: "vuelo", plantilla: { nombre: "iatos_aviso_vuelo", params: ["AM401", "2026-10-31", "cancelado"] }, dedupe: "v:1" });
    expect(r).toMatchObject({ modo: "ya", entregados: 4 });
    expect(salidas.map((s) => s.canal)).toEqual(["push", "telegram", "whatsapp", "email"]);
    // Ventana abierta → texto libre, no plantilla.
    expect(salidas[2]).toMatchObject({ texto: expect.stringContaining("Tu vuelo de mañana fue cancelado.") });
    expect(db.diferidos).toEqual([]);
  });

  it("normal de día → solo el canal preferido; si falla, el siguiente; si nada sale, correo", async () => {
    const db = fakeCanalesDb();
    db.setUser(ANA, "ana@x.test", "Ana");
    db.setPrefs(ANA, { preferido: "telegram" });
    db.vincular(ANA, "telegram", "111");
    const { d, salidas } = entregaFalsa(db);
    const aviso = { titulo: "t", texto: "x", url: "/dashboard", urgente: false, tipo: "general" as const, dedupe: "g:1" };
    await avisarUsuario(d, ANA, aviso);
    expect(salidas.map((s) => s.canal)).toEqual(["telegram"]);
    salidas.length = 0;
    d.telegram = vi.fn(async (to) => ({ ok: false, channel: "telegram" as const, to, code: "SEND_FAILED" as const }));
    await avisarUsuario(d, ANA, { ...aviso, dedupe: "g:2" });
    expect(salidas.map((s) => s.canal)).toEqual(["push"]);
    salidas.length = 0;
    d.push = vi.fn(async () => 0);
    await avisarUsuario(d, ANA, { ...aviso, dedupe: "g:3" });
    expect(salidas.map((s) => s.canal)).toEqual(["email"]);
    expect(planDeEntrega({ prefs: normalizarPreferencias({ preferido: "app" }), urgente: false, ahora: new Date(), disponibles: [{ canal: "email", destino: "a@x" }, { canal: "push", destino: "push" }] }))
      .toMatchObject({ modo: "ya", intentos: [{ canal: "push" }] });
  });
});

// ═══════════════════════════ Voz (preparada, apagada) ═══════════════════════════

describe("voz con Vapi: preparada y apagada", () => {
  const CASO = "0e000000-0000-4000-8000-000000000009";
  const pedido = { a: "+529981234567", proposito: "Confirmar llegada tardía", guion: "El huésped llega a las 2 am; pide que no cancelen la reserva.", idioma: "es" as const, incidentId: CASO, viajero: "Ana López", reserva: "HX-77" };

  it("sin VOZ_LLAMADAS_REALES=true (o sin secretos) NO llama ni toca la red", async () => {
    const f = vi.fn();
    const todos = { VAPI_API_KEY: "k", VAPI_PHONE_NUMBER_ID: "p", VOZ_WEBHOOK_SECRET: "s" } as Record<string, string>;
    expect(await vozVapi({ env: (k) => todos[k], fetch: f as unknown as typeof fetch, webhookUrl: "https://x/voz-webhook" }).llamar(pedido)).toMatchObject({ ok: false, code: "APAGADO" });
    expect(await vozVapi({ env: () => undefined, fetch: f as unknown as typeof fetch, webhookUrl: "https://x/voz-webhook" }).llamar(pedido)).toMatchObject({ ok: false, code: "APAGADO", mensaje: expect.stringContaining("VAPI_API_KEY") });
    expect(await vozVapi({ env: (k) => ({ ...todos, VOZ_LLAMADAS_REALES: "true" })[k], fetch: f as unknown as typeof fetch, webhookUrl: "https://x/voz-webhook" }).llamar({ ...pedido, enHorario: false })).toMatchObject({ code: "FUERA_DE_HORARIO" });
    expect(f).not.toHaveBeenCalled();
  });

  it("la llamada abre diciendo que es la IA de IATOS, dura máx. 3 min y su webhook va firmado y atado al caso", async () => {
    const b = await cuerpoLlamadaVapi(pedido, { apiKey: "k", phoneNumberId: "pn", webhookUrl: "https://x/functions/v1/voz-webhook", webhookSecret: "s", structuredOutputId: "so-1" });
    expect(b.assistant.firstMessage).toBe("Hola, soy el asistente de IA de IATOS, llamo en nombre de Ana López por su reserva HX-77. Esta llamada puede grabarse.");
    expect(b.assistant.maxDurationSeconds).toBe(180);
    expect(b.customer).toEqual({ number: "+529981234567" });
    expect(b.assistant.model.messages[0].content).toMatch(/NO pagues[\s\S]*NO canceles/);
    expect(b.assistant.artifactPlan).toEqual({ structuredOutputIds: ["so-1"] });
    expect(await verificarFirmaLlamada(b.assistant.server.headers["x-iatos-voz"], "s")).toBe(CASO);
  });

  it("fin de llamada → resultado estructurado a la bitácora, marcado sin comprobante e idempotente", async () => {
    const db = fakeCanalesDb();
    const id = db.abrirCaso(ANA);
    const fin = leerFinDeLlamada({ message: { type: "end-of-call-report", endedReason: "customer-ended-call", call: { id: "call_1", startedAt: "2026-10-30T10:00:00Z", endedAt: "2026-10-30T10:01:30Z" },
      artifact: { transcript: "AI: Hola… User: Sí, la guardamos.", structuredOutputs: { "so-1": { name: "resultado", result: { contesto: true, confirmado: true, resumen: "Recepción guarda la habitación hasta las 3 am.", dato_clave: "Atendió Laura", siguiente_paso: "Avisar al viajero", requiere_humano: false } } } } } })!;
    expect(fin).toMatchObject({ callId: "call_1", duracionSeg: 90, resultado: { confirmado: true, dato_clave: "Atendió Laura" } });
    expect(leerFinDeLlamada({ message: { type: "status-update" } })).toBeNull();
    expect(await registrarLlamada(db, id, fin)).toMatchObject({ ok: true, duplicate: false });
    expect(await registrarLlamada(db, id, fin)).toMatchObject({ ok: true, duplicate: true });
    const ev = db.casos.get(ANA)!.events[0];
    expect(ev).toMatchObject({ kind: "mensaje", actor: "proveedor", channel: "voz", visible_to_user: false });
    expect(String(ev.body)).toMatch(/sin comprobante[\s\S]*Confirmó[\s\S]*Atendió Laura/);
  });
});

describe("Telegram: entradas nuevas (botones, ubicación, fotos)", () => {
  it("callback de un botón en chat privado; grupos y bots no", () => {
    const cb = parseTelegramUpdate({ update_id: 5, callback_query: { id: "cb1", data: "a:x:s", from: { id: 9 }, message: { message_id: 3, chat: { id: 9, type: "private" } } } });
    expect(cb).toEqual([expect.objectContaining({ from: "9", boton: "a:x:s", callbackId: "cb1", providerMessageId: "5" })]);
    expect(parseTelegramUpdate({ update_id: 6, callback_query: { id: "cb1", data: "a", from: { id: 9 }, message: { chat: { id: -9, type: "group" } } } })).toEqual([]);
    expect(parseTelegramUpdate({ update_id: 7, message: { chat: { id: 9, type: "private" }, location: { latitude: 1, longitude: 2 } } })[0]).toMatchObject({ ubicacion: { lat: 1, lng: 2 } });
    expect(parseTelegramUpdate({ update_id: 8, message: { chat: { id: 9, type: "private" }, document: { file_id: "BQACAgEAAx0doc______", mime_type: "application/zip" } } })).toEqual([]);
  });
});
