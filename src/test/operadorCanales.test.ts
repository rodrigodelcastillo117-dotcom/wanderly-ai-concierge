// Operador IATOS · canales: Telegram (adaptador, webhook con secreto, vincular con código de un solo uso, la
// conversación entra al mismo caso y al operador), respuesta del proveedor por correo (operador+<token>@) y las
// interfaces de WhatsApp y voz (apagadas). Sin red: fetch simulado.
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkCodeIn, newLinkCode, parseTelegramUpdate, sameSecret, sha256Hex, telegramChannel, telegramWebhookSecret } from "../../supabase/functions/_shared/channels/telegram";
import { atenderTelegram, type TelegramDeps } from "../../supabase/functions/_shared/operador/telegramEntrada";
import { respuestaProveedor } from "../../supabase/functions/_shared/operador/entrante";
import { esCorreoDeReclamos, rutaEntrante } from "../../supabase/functions/_shared/derechos/rutas";
import { dentroDeVentana, metaTextPayload, parseMetaWebhook, verifyMetaSignature } from "../../supabase/functions/_shared/channels/whatsapp";
import { aperturaLlamada, vozApagada, vozChannel } from "../../supabase/functions/_shared/channels/voz";
import { createChannelRegistry } from "../../supabase/functions/_shared/channels/registry";
import { arnes, guion, USER } from "./helpers/operadorHarness";
import { trabajarCaso } from "../../supabase/functions/_shared/operador/bucle";

afterEach(() => { vi.useRealTimers(); });

const TOKEN = "123456:ABC-prueba";
const update = (id: number, text: string, chat = 555001, type = "private") => ({ update_id: id, message: { message_id: id, date: 1_790_000_000, text, chat: { id: chat, type }, from: { id: chat, username: "ana_viaja" } } });

describe("Telegram: adaptador", () => {
  it("sin TELEGRAM_BOT_TOKEN queda apagado; con él, prendido (un solo secreto)", () => {
    const off = createChannelRegistry({ env: () => undefined, sendEmail: vi.fn(), adapters: { telegram: () => telegramChannel({ token: "x" }) } });
    expect(off.status().find((s) => s.id === "telegram")).toMatchObject({ enabled: false, missing: ["TELEGRAM_BOT_TOKEN"] });
    const on = createChannelRegistry({ env: (k) => (k === "TELEGRAM_BOT_TOKEN" ? TOKEN : undefined), sendEmail: vi.fn(), adapters: { telegram: (env) => telegramChannel({ token: env("TELEGRAM_BOT_TOKEN")! }) } });
    expect(on.isEnabled("telegram")).toBe(true);
  });

  it("envía a un chat por la Bot API (sin filtrar el token en errores)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), { status: 200 }));
    const ch = telegramChannel({ token: TOKEN, fetch: f as unknown as typeof fetch });
    const r = await ch.send("555001", { text: "Hola" });
    expect(r).toMatchObject({ ok: true, providerMessageId: "77" });
    expect((f.mock.calls[0] as unknown[])[0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(((f.mock.calls[0] as unknown[])[1] as RequestInit).body))).toMatchObject({ chat_id: 555001, text: "Hola" });
    const bad = await telegramChannel({ token: TOKEN, fetch: (async () => new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked" }), { status: 403 })) as unknown as typeof fetch }).send("555001", { text: "x" });
    expect(bad).toMatchObject({ ok: false, code: "SEND_FAILED" });
    expect(JSON.stringify(bad)).not.toContain(TOKEN);
    expect((await ch.send("no-es-chat", { text: "x" })).code).toBe("BAD_ADDRESS");
  });

  it("webhook: sin el secreto correcto → null (401); con él, solo mensajes de texto de chats privados", async () => {
    const ch = telegramChannel({ token: TOKEN });
    const secret = await telegramWebhookSecret(TOKEN);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const req = (h: Record<string, string>, body: unknown) => new Request("https://x/telegram-webhook", { method: "POST", headers: h, body: JSON.stringify(body) });
    expect(await ch.parseInbound!(req({}, update(1, "hola")))).toBeNull();
    expect(await ch.parseInbound!(req({ "X-Telegram-Bot-Api-Secret-Token": "otro" }, update(1, "hola")))).toBeNull();
    const ok = await ch.parseInbound!(req({ "X-Telegram-Bot-Api-Secret-Token": secret }, update(1, "Folio AB12CD34: sigo esperando")));
    expect(ok).toEqual([expect.objectContaining({ channel: "telegram", from: "555001", providerMessageId: "1", folio: "AB12CD34" })]);
    expect(parseTelegramUpdate(update(2, "hola", -100, "group"))).toEqual([]);
    expect(sameSecret("abc", "abd")).toBe(false);
  });

  it("código de vinculación: 8 caracteres sin letras confusas; se reconoce en /start y solo", () => {
    const c = newLinkCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(linkCodeIn(`/start ${c}`)).toBe(c);
    expect(linkCodeIn(c.toLowerCase())).toBe(c);
    expect(linkCodeIn("hola qué tal")).toBeNull();
  });
});

describe("Telegram: la conversación entra al mismo caso y al operador", () => {
  function tg(h: ReturnType<typeof arnes>) {
    const enviados: Array<{ chat: string; texto: string }> = [];
    const despertados: string[] = [];
    const seen = new Set<string>();
    const links = new Map<string, string>(); // chat → user
    const codes = new Map<string, { user: string; used: boolean; exp: number }>();
    const rpc = h.db.rpc;
    const db = {
      rpc: (fn: string, a: Record<string, unknown>) => {
        if (fn === "channel_inbound_seen") { const k = String(a._update_id); const nuevo = !seen.has(k); seen.add(k); return Promise.resolve({ data: nuevo, error: null }); }
        if (fn === "channel_link_redeem") {
          const c = codes.get(String(a._code_hash));
          if (!c) return Promise.resolve({ data: { ok: false, code: "BAD_CODE" }, error: null });
          if (c.used) return Promise.resolve({ data: { ok: false, code: "USED" }, error: null });
          c.used = true; links.set(String(a._external_id), c.user);
          return Promise.resolve({ data: { ok: true, user_id: c.user }, error: null });
        }
        if (fn === "channel_link_for") return Promise.resolve({ data: links.get(String(a._external_id)) ?? null, error: null });
        return rpc(fn, a);
      },
    };
    const deps: TelegramDeps = {
      db, enviar: async (chat, texto) => { enviados.push({ chat, texto }); }, despertar: async (id) => { despertados.push(id); },
      reportar: (i) => h.reportar(i), sha256: sha256Hex, appUrl: "https://traveliatos.life/dashboard",
    };
    return { deps, enviados, despertados, codes };
  }

  it("vincular, abrir un caso por Telegram, seguir la conversación y que el operador conteste por ahí", async () => {
    const h = arnes({ modelo: guion([[{ name: "escribir_viajero", input: { mensaje: "Estoy localizando al chofer." } }, { name: "prometer_seguimiento", input: { siguiente_paso: "Te digo dónde está el chofer", minutos: 15 } }], "ok",
      [{ name: "escribir_viajero", input: { mensaje: "Gracias, sigo con el proveedor." } }], "ok"]) });
    const t = tg(h);
    // Sin vincular: no se lee nada de nadie.
    expect((await atenderTelegram(t.deps, parseTelegramUpdate(update(10, "el chofer no llegó"))[0])).accion).toBe("sin_vincular");
    expect(t.enviados.at(-1)!.texto).toMatch(/Perfil → Ajustes → Telegram/);
    // Código de un solo uso que mostró la app.
    const code = newLinkCode();
    t.codes.set(await sha256Hex(code), { user: USER, used: false, exp: Date.now() + 900_000 });
    expect((await atenderTelegram(t.deps, parseTelegramUpdate(update(11, `/start ${code}`))[0])).accion).toBe("vinculado");
    expect((await atenderTelegram(t.deps, parseTelegramUpdate(update(12, `/start ${code}`))[0])).accion).toBe("codigo_invalido");
    // El mismo update dos veces: una sola vez.
    expect((await atenderTelegram(t.deps, parseTelegramUpdate(update(12, `/start ${code}`))[0])).accion).toBe("duplicado");
    // Un problema → caso nuevo con guía y folio, y despierta al operador.
    const r = await atenderTelegram(t.deps, parseTelegramUpdate(update(13, "Llegué a Cancún y el chofer no está, ya pasó una hora"))[0]);
    expect(r.accion).toBe("caso_nuevo");
    expect(t.enviados.at(-1)!.texto).toMatch(/folio/i);
    expect(t.despertados).toEqual([r.incidentId]);
    const inc = h.db.incidents.get(r.incidentId!)!;
    expect(inc.categoria).toBe("traslado_no_llego");
    // El operador trabaja el caso y le contesta por su canal (Telegram vía avisarViajero).
    await trabajarCaso(h.deps, r.incidentId!, "nuevo");
    expect(h.alViajero[0].texto).toMatch(/localizando al chofer/);
    // Lo siguiente que escribe entra al MISMO caso (canal telegram) y lo despierta.
    const s = await atenderTelegram(t.deps, parseTelegramUpdate(update(14, "Ya tomé un taxi del módulo"))[0]);
    expect(s).toMatchObject({ accion: "al_caso", incidentId: r.incidentId });
    expect(inc.events.at(-1)).toMatchObject({ actor: "usuario", channel: "telegram", direction: "entrante", body: "Ya tomé un taxi del módulo" });
    expect(h.db.incidents.size).toBe(1);
  });
});

describe("respuesta del proveedor por correo (operador+<token>@)", () => {
  it("la ruta se reconoce, Reservas IA la ignora, y la respuesta verificada va a la bitácora y despierta al operador", async () => {
    const tok = "f".repeat(24);
    expect(rutaEntrante([`operador+${tok}@reply.traveliatos.life`])).toEqual({ tipo: "operador", token: tok });
    expect(esCorreoDeReclamos([`Hotel <operador+${tok}@reply.traveliatos.life>`])).toBe(true);
    const h = arnes({ modelo: guion([]) });
    const r = await h.reportar({ descripcion: "El hotel dice que no tengo reserva", origen: "usuario", canal: "app" });
    if (!r.ok) throw new Error("caso");
    // Un correo saliente en la cola con su token.
    h.db.cases.set(r.id, { ...(h.db.cases.get(r.id) ?? {} as never), lockOwner: "op-prueba-0001", lockedUntil: Date.now() + 60_000, state: "activo", lastEventId: 0, wakeAt: null, followUpAt: null, lastRunAt: null, runs: 0, actions: 0, spend: 0, flights: 0, emails: 0, consents: {}, pending: null, summary: null });
    const add = await h.db.rpc("operator_outbox_add", { _id: r.id, _owner: "op-prueba-0001", _o: { provider_name: "Hotel Roma Centro", to_email: "reservas@hotelromacentro.example",
      source: { kind: "sitio_oficial", url: "https://hotelromacentro.example/contatti" }, subject: "Prenotazione", body: "Buongiorno, potete verificare?", dedupe_key: "x1" } });
    const token = (add.data as { reply_token: string }).reply_token;
    const despertar = vi.fn(async () => undefined);
    const correo = { from: "Hotel Roma Centro <reservas@hotelromacentro.example>", subject: "Re: Prenotazione", text: "Sì, abbiamo trovato la prenotazione. La camera è pronta.\n\nOn Wed wrote:\n> Buongiorno", message_id: "<m1@hotel>", authentication: { dkim: "pass", dmarc: "pass" } };
    const x = await respuestaProveedor({ db: h.db, receivedEmail: async () => correo, despertar }, { token, emailId: "em_1", eventId: "evt_1" });
    expect(x.body).toMatchObject({ ok: true, verified: true, duplicate: false });
    const ev = h.db.incidents.get(r.id)!.events.at(-1)!;
    expect(ev).toMatchObject({ actor: "proveedor", direction: "entrante", channel: "email" });
    expect(ev.body).toContain("abbiamo trovato la prenotazione");
    expect(ev.body).not.toContain("On Wed wrote");
    expect(despertar).toHaveBeenCalledWith(r.id);
    // Mismo Message-ID otra vez: no se duplica ni despierta de nuevo.
    expect((await respuestaProveedor({ db: h.db, receivedEmail: async () => correo, despertar }, { token, emailId: "em_1", eventId: "evt_1" })).body).toMatchObject({ duplicate: true });
    expect(despertar).toHaveBeenCalledTimes(1);
    // Un remitente que no es el hotel: se anota marcado como NO verificado.
    await respuestaProveedor({ db: h.db, receivedEmail: async () => ({ ...correo, from: "otro@gmail.com", message_id: "<m2@x>", authentication: { dmarc: "fail" } }), despertar }, { token, emailId: "em_2", eventId: "evt_2" });
    expect(h.db.incidents.get(r.id)!.events.at(-1)!.body).toMatch(/^\[Remitente NO verificado/);
    // Token desconocido: no se toca nada.
    expect((await respuestaProveedor({ db: h.db, receivedEmail: async () => correo }, { token: "a".repeat(24), emailId: "em_3", eventId: "evt_3" })).body).toMatchObject({ unmatched: true });
  });
});

describe("WhatsApp y voz: interfaz lista, apagados", () => {
  it("WhatsApp: ventana de 24 h, cuerpo de Meta, firma X-Hub-Signature-256 y lectura del webhook", async () => {
    const ahora = new Date("2026-10-29T12:00:00Z");
    expect(dentroDeVentana("2026-10-29T00:00:00Z", ahora)).toBe(true);
    expect(dentroDeVentana("2026-10-27T00:00:00Z", ahora)).toBe(false);
    expect(metaTextPayload("+5215512345678", "hola")).toMatchObject({ to: "5215512345678", type: "text", text: { body: "hola" } });
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.1", from: "5215512345678", timestamp: "1790000000", type: "text", text: { body: "Perdí mi pasaporte" } }] } }] }] });
    expect(await verifyMetaSignature("sha256=00", raw, "secreto")).toBe(false);
    expect(parseMetaWebhook(JSON.parse(raw))).toEqual([expect.objectContaining({ channel: "whatsapp", from: "+5215512345678", text: "Perdí mi pasaporte" })]);
    // No está registrado: aunque haya secretos, el registro lo reporta "no implementado".
    const reg = createChannelRegistry({ env: (k) => ({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_WHATSAPP_FROM: "whatsapp:+1" } as Record<string, string>)[k], sendEmail: vi.fn() });
    expect(reg.status().find((s) => s.id === "whatsapp")!.state).toBe("apagado_no_implementado");
  });
  it("voz: nunca llama (NO_IMPLEMENTADO) y la apertura dice que es una IA y que puede grabarse", async () => {
    expect(await vozApagada().llamar({ a: "+5215512345678", proposito: "x", guion: "x", idioma: "es", incidentId: "x", viajero: "Ana", reserva: "TC-1" })).toMatchObject({ ok: false, code: "NO_IMPLEMENTADO" });
    expect((await vozChannel().send("+52", { text: "x" })).code).toBe("CHANNEL_OFF");
    expect(aperturaLlamada({ idioma: "es", viajero: "Ana", reserva: "TC-1" })).toBe("Hola, soy el asistente de IA de IATOS, llamo en nombre de Ana por su reserva TC-1. Esta llamada puede grabarse.");
  });
});
