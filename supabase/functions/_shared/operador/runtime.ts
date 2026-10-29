// Operador IATOS · conexión real (Deno). Arma OperadorDeps con: base (service_role), Claude (modelo de la
// configuración existente, ANTHROPIC_MODEL → vigente, con respaldo: _shared/claude.ts), canales (push, Telegram si
// está prendido, correo), reclamos atados al caso, vuelos (caché de seguimiento y una búsqueda con la caché y el cupo
// de flights-search), lugares (Google Places) y contactos de proveedores (descubrimiento de Reservas IA: sitio
// oficial / Google Places; nunca adivina). La lógica vive en bucle.ts y herramientas.ts.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { callClaudeWithFallback, claudeModels } from "../claude.ts";
import { sendEmail } from "../email.ts";
import { pushToUser } from "../push.ts";
import { redactPii } from "../redact.ts";
import { incidentChannels } from "../incident-runtime.ts";
import { buildReclamosDeps } from "../derechos/runtime.ts";
import { verTodo } from "../derechos/contexto.ts";
import { buildServiceDeps } from "../ai-reservations/runtime.ts";
import { discoverVenueContact } from "../ai-reservations/contact.ts";
import { DEFAULT_REPLY_DOMAIN } from "../ai-reservations/core.ts";
import { liveSearchGateFor, serpFetchFor } from "../serpRuntime.ts";
import { searchFlights } from "../../flights-search/search.ts";
import { nearbySearchBody, rankEmergencyPlaces } from "../../places-nearby/rank.ts";
import type { ChannelSendResult } from "../channels/types.ts";
import type { IncidentDb } from "../incidents.ts";
import type { DespachoDeps } from "./bucle.ts";
import type { ContactoProveedor, LugarCercano, OperadorDeps } from "./tipos.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
const GATEWAY = "https://connector-gateway.lovable.dev";
export const OPERADOR_FROM = "IATOS Operador <operador@traveliatos.life>";

// deno-lint-ignore no-explicit-any -- cliente sin tipos generados
export function adminClient(): any {
  return createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}

// deno-lint-ignore no-explicit-any
export function dbDe(admin: any): IncidentDb {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(fn, args ?? {});
      return { data, error: error ? { message: redactPii(error.message) ?? "db_error", code: error.code } : null };
    },
  };
}

/** Despierta al operador para un caso (fuego y olvido, 2 s): lo usan incidente, concierge-chat, telegram-webhook y reclamos-inbound. */
export async function despertarOperador(incidentId: string, motivo = "nuevo"): Promise<void> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !/^[0-9a-f-]{36}$/i.test(incidentId)) return;
  await fetch(`${url}/functions/v1/operador`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ incident_id: incidentId, motivo, async: true }), signal: AbortSignal.timeout(3_000),
  }).then((r) => r.body?.cancel()).catch(() => undefined);
}

/** Tick del operador desde el vigilante (la función operador trabaja en segundo plano y responde 202). */
export async function despertarOperadorTick(): Promise<void> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  await fetch(`${url}/functions/v1/operador`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tick: true, async: true }), signal: AbortSignal.timeout(3_000),
  }).then((r) => r.body?.cancel()).catch(() => undefined);
}

async function lugares(q: { lat: number; lng: number; tipo: string }): Promise<LugarCercano[] | { error: string }> {
  const key = env("GOOGLE_MAPS_API_KEY");
  const lovable = env("LOVABLE_API_KEY");
  if (!key || !lovable) return { error: "lugares_no_configurado" };
  const res = await fetch(`${GATEWAY}/google_maps/places/v1/places:searchNearby`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.internationalPhoneNumber,places.googleMapsUri,places.currentOpeningHours.openNow,places.primaryType,places.primaryTypeDisplayName" },
    body: JSON.stringify(nearbySearchBody({ lat: q.lat, lng: q.lng, kind: q.tipo, radius: 3000 }, q.tipo)),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res || !res.ok) return { error: "lugares_no_disponible" };
  const data = await res.json().catch(() => ({}));
  // deno-lint-ignore no-explicit-any
  const places = (data.places ?? []).map((p: any) => ({
    id: p.id, name: p.displayName?.text ?? "", address: p.formattedAddress ?? "", lat: p.location?.latitude, lng: p.location?.longitude,
    rating: p.rating ?? null, ratings_count: p.userRatingCount ?? 0, phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
    maps_url: p.googleMapsUri ?? null, open_now: p.currentOpeningHours?.openNow ?? null, type: p.primaryTypeDisplayName?.text ?? null, primary_type: p.primaryType ?? null,
  }));
  // deno-lint-ignore no-explicit-any
  return rankEmergencyPlaces(q.tipo, places, { lat: q.lat, lng: q.lng }).slice(0, 5).map((p: any) => ({
    nombre: p.name, direccion: p.address || null, telefono: p.phone ?? null, mapa: p.maps_url ?? null, abierto: p.open_now ?? null,
  }));
}

async function placeIdPorTexto(texto: string): Promise<string | null> {
  const key = env("GOOGLE_MAPS_API_KEY");
  const lovable = env("LOVABLE_API_KEY");
  if (!key || !lovable) return null;
  const res = await fetch(`${GATEWAY}/google_maps/places/v1/places:searchText`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": key, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify({ textQuery: texto.slice(0, 200), languageCode: "es", maxResultCount: 1 }), signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return typeof j?.places?.[0]?.id === "string" ? j.places[0].id : null;
}

export function buildOperadorDeps(): OperadorDeps & { despacho: DespachoDeps } {
  const admin = adminClient();
  const db = dbDe(admin);
  const modelos = claudeModels();
  const modelo: OperadorDeps["modelo"] = env("ANTHROPIC_API_KEY")
    ? async (payload) => {
      try {
        const res = await callClaudeWithFallback(payload, { signal: AbortSignal.timeout(60_000) });
        return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
      } catch {
        return { ok: false, status: 0, data: null };
      }
    }
    : null;
  const channels = incidentChannels();
  const reservas = buildServiceDeps();
  const siteUrl = env("SITE_URL") ?? "https://traveliatos.life";

  return {
    db,
    modelo,
    modeloNombre: modelos[0] ?? "claude-sonnet-5-5",
    ahora: () => new Date(),
    owner: `op-${crypto.randomUUID()}`,
    warn: (...a) => console.warn(...a.map((x) => redactPii(String(x)) ?? "")),
    verTodo: (userId, tripId, alcance) => verTodo(admin, userId, { permiso: true, alcance, trip_id: tripId }),
    reclamos: (incidentId) => {
      try { return buildReclamosDeps({ casoActual: incidentId, origen: "iato" }); } catch { return null; }
    },
    avisarViajero: async (userId, m, incidentId) => {
      const out: ChannelSendResult[] = [];
      const url = `${siteUrl}${m.url}`;
      const n = await pushToUser(admin, userId, { title: m.titulo, body: m.texto.slice(0, 180), url: m.url }, { TTL: 3600, urgency: m.urgente ? "high" : "normal" }).catch(() => 0);
      out.push({ ok: n > 0, channel: "email", to: "push", code: n > 0 ? undefined : "SEND_FAILED", error: n > 0 ? null : "sin suscripción push" });
      const { data: links } = await admin.rpc("channel_links_of", { _user: userId });
      const tg = Array.isArray(links) ? links.find((l: { channel?: string }) => l.channel === "telegram") : null;
      let entregado = n > 0;
      if (tg?.external_id && channels.isEnabled("telegram")) {
        const r = await channels.send("telegram", String(tg.external_id), { text: `${m.texto}\n\n${url}` }, { incidentId, purpose: "usuario" });
        out.push(r);
        entregado ||= r.ok;
      }
      // Correo: si es urgente o si nada más le llegó.
      if (m.urgente || !entregado) {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        const email = u?.user?.email;
        if (email) out.push(await channels.send("email", email, { subject: m.titulo, text: `${m.texto}\n\nVer tu caso: ${url}` }, { incidentId, purpose: "usuario" }));
      }
      return out;
    },
    estadoVuelo: async (vuelo, fecha, userId) => {
      let q = admin.from("tracked_flights").select("flight, flight_date, route, last_status, last_estimated, last_gate, last_terminal, last_checked_at")
        .eq("user_id", userId).eq("flight", vuelo);
      if (fecha) q = q.eq("flight_date", fecha);
      const { data } = await q.order("flight_date", { ascending: false }).limit(1);
      const row = Array.isArray(data) ? data[0] : null;
      return row ? { fuente: "seguimiento de vuelos de IATOS (caché)", consultado: row.last_checked_at, ...row }
        : { sin_dato: true, nota: "Ese vuelo no está en seguimiento: no hay estado en caché. No lo inventes; pide al viajero lo que dice la pantalla o la aerolínea." };
    },
    buscarVuelos: async (q, userId) => {
      const serp = serpFetchFor("operador", userId, liveSearchGateFor(userId), { priority: "vuelos" });
      const r = await searchFlights({ origin: q.origen, destination: q.destino, depart: q.fecha, travelers: q.pasajeros, type: "oneway" }, {
        serpKey: env("SERPAPI_PRIVATE_KEY"), tpToken: env("TRAVELPAYOUTS_TOKEN"), lovableKey: env("LOVABLE_API_KEY"), marker: env("TRAVELPAYOUTS_MARKER"), serpFetch: serp.fetch,
      });
      // deno-lint-ignore no-explicit-any
      const b = r.body as any;
      const vuelos = Array.isArray(b?.flights) ? b.flights.slice(0, 5) : Array.isArray(b?.results) ? b.results.slice(0, 5) : [];
      return { disponible: b?.disponible ?? vuelos.length > 0, fuente: b?.source ?? b?.fuente ?? null, vuelos, motivo: b?.motivo_detalle ?? null };
    },
    lugares: (q) => lugares(q),
    buscarContacto: async (q) => {
      const placeId = await placeIdPorTexto([q.nombre, q.ciudad, q.pais].filter(Boolean).join(" "));
      if (!placeId) return null;
      const v = await discoverVenueContact({ name: q.nombre, place_id: placeId, city: q.ciudad, country: q.pais }, { ...reservas.contact, callModel: reservas.callModel });
      if (!v.email && !v.phone && !v.website) return null;
      const fuente: ContactoProveedor["fuente"] = v.email_source
        ? { kind: v.email_source.kind === "catalog" ? "directorio" : "sitio_oficial", url: v.email_source.url, quote: v.email_source.quote }
        : { kind: "sitio_oficial", url: v.maps_url ?? v.website ?? null };
      return { proveedor: v.name, tipo: q.tipo, email: v.email_source ? v.email : null, telefono: v.phone, sitio: v.website, tz: v.timezone, idioma: v.language, fuente };
    },
    contactosDeReservas: async (userId, tripId) => {
      let q = admin.from("ai_reservations").select("id, venue_name, venue_email, venue_email_source, venue_phone, venue_website, venue_timezone, venue_language")
        .eq("user_id", userId).not("venue_email", "is", null);
      if (tripId) q = q.eq("trip_id", tripId);
      const { data } = await q.limit(10);
      // deno-lint-ignore no-explicit-any
      return (Array.isArray(data) ? data : []).filter((r: any) => r.venue_email && r.venue_email_source?.url).map((r: any) => ({
        proveedor: r.venue_name, tipo: "restaurante" as const, email: r.venue_email, telefono: r.venue_phone ?? null, sitio: r.venue_website ?? null,
        tz: r.venue_timezone ?? null, idioma: r.venue_language ?? null, fuente: { kind: "reserva" as const, booking: `ai_reservation:${r.id}`, url: r.venue_email_source.url },
      }));
    },
    nombreViajero: async (userId) => {
      const { data } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
      return (data as { full_name?: string } | null)?.full_name ?? null;
    },
    despacho: {
      db,
      enviar: (m) => sendEmail(m),
      remitente: env("OPERADOR_FROM_ADDRESS") ? `IATOS Operador <${env("OPERADOR_FROM_ADDRESS")}>` : OPERADOR_FROM,
      dominioRespuesta: env("RECLAMOS_REPLY_DOMAIN") ?? env("AI_RESERVATIONS_REPLY_DOMAIN") ?? DEFAULT_REPLY_DOMAIN,
    },
  };
}
