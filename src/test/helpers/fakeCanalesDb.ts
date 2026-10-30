// Base falsa de CANALES (migración 20261030030000_canales) para Vitest: misma semántica que las funciones SQL que
// prueba supabase/tests/canales (vínculos por chat, acciones de un solo uso atadas al chat y a la cuenta, ubicación,
// ventana de 24 h, preferencias, diferidos) y lo mínimo de incidentes (caso abierto y bitácora).
import { createHash, randomUUID } from "node:crypto";

type Link = { user: string; channel: string; external: string; active: boolean; lastInbound: number | null; loc: { lat: number; lng: number } | null; locAt: number | null };
type Accion = { id: string; user: string; channel: string; external: string; action: Record<string, unknown>; created: number; expires: number; used: number | null; outcome: string | null };

export function fakeCanalesDb(o: { now?: () => number } = {}) {
  const now = o.now ?? (() => Date.now());
  const seen = new Set<string>();
  const codes = new Map<string, { user: string; channel: string; used: boolean; exp: number }>();
  const links: Link[] = [];
  const acciones: Accion[] = [];
  const prefs = new Map<string, Record<string, unknown>>();
  const emails = new Map<string, string>();
  const nombres = new Map<string, string>();
  const casos = new Map<string, { id: string; lastToUserAt: string | null; events: Array<Record<string, unknown>> }>();
  const diferidos: Array<{ id: number; user: string; payload: unknown; sendAfter: number; status: string; dedupe: string }> = [];
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const active = (channel: string, external: string) => links.find((l) => l.active && l.channel === channel && l.external === external);
  const ok = (data: unknown) => Promise.resolve({ data, error: null });

  const db = {
    llamadas, links, acciones, casos, diferidos,
    sha: (s: string) => createHash("sha256").update(s).digest("hex"),
    /** La app pidió un código para este usuario (como channel_link_code_create). */
    codigo(user: string, channel: string, code: string) { codes.set(createHash("sha256").update(code).digest("hex"), { user, channel, used: false, exp: now() + 900_000 }); },
    vincular(user: string, channel: string, external: string) {
      for (const l of links) if (l.active && l.channel === channel && (l.external === external || l.user === user)) l.active = false;
      links.push({ user, channel, external, active: true, lastInbound: null, loc: null, locAt: null });
    },
    setUser(user: string, email: string, nombre: string) { emails.set(user, email); nombres.set(user, nombre); },
    setPrefs(user: string, p: Record<string, unknown>) { prefs.set(user, p); },
    abrirCaso(user: string, lastToUserAt: string | null = null) { const id = randomUUID(); casos.set(user, { id, lastToUserAt, events: [] }); return id; },
    rpc(fn: string, a: Record<string, unknown>) {
      llamadas.push({ fn, args: a });
      switch (fn) {
        case "channel_inbound_seen": { const k = `${a._channel}:${a._update_id}`; const n = !seen.has(k); seen.add(k); return ok(n); }
        case "channel_link_redeem": {
          const c = codes.get(String(a._code_hash));
          if (!c || c.channel !== a._channel) return ok({ ok: false, code: "BAD_CODE" });
          if (c.used) return ok({ ok: false, code: "USED" });
          if (c.exp < now()) return ok({ ok: false, code: "EXPIRED" });
          c.used = true;
          db.vincular(c.user, String(a._channel), String(a._external_id));
          return ok({ ok: true, user_id: c.user });
        }
        case "channel_link_for": { const l = active(String(a._channel), String(a._external_id)); if (l) l.lastInbound = now(); return ok(l?.user ?? null); }
        case "channel_location_set": { const l = active(String(a._channel), String(a._external_id)); if (!l) return ok(false); l.loc = { lat: Number(a._lat), lng: Number(a._lng) }; l.locAt = now(); return ok(true); }
        case "channel_location_get": { const l = active(String(a._channel), String(a._external_id)); return ok(l?.loc && l.locAt! > now() - 2 * 3600_000 ? l.loc : null); }
        case "channel_action_put": {
          if (!links.some((l) => l.active && l.user === a._user && l.channel === a._channel && l.external === a._external_id)) return ok({ ok: false, code: "NOT_LINKED" });
          const id = randomUUID();
          acciones.push({ id, user: String(a._user), channel: String(a._channel), external: String(a._external_id), action: a._action as Record<string, unknown>, created: now(), expires: now() + 86400_000, used: null, outcome: null });
          return ok({ ok: true, id, ref: id.replace(/-/g, "") });
        }
        case "channel_action_take": {
          const r = String(a._ref ?? "").toLowerCase();
          if (!/^[0-9a-f]{8}([0-9a-f]{24})?$/.test(r)) return ok({ ok: false, code: "NOT_FOUND" });
          const m = acciones.filter((x) => x.id.replace(/-/g, "").startsWith(r) && x.channel === a._channel && x.external === a._external_id);
          if (m.filter((x) => !x.used).length > 1) return ok({ ok: false, code: "AMBIGUOUS" });
          const x = m.sort((p, q) => (p.used ? 1 : 0) - (q.used ? 1 : 0))[0];
          if (!x) return ok({ ok: false, code: "NOT_FOUND" });
          if (x.used) return ok({ ok: false, code: "USED", outcome: x.outcome });
          if (x.expires < now()) return ok({ ok: false, code: "EXPIRED" });
          if (!links.some((l) => l.active && l.user === x.user && l.channel === a._channel && l.external === a._external_id)) return ok({ ok: false, code: "NOT_LINKED" });
          x.used = now(); x.outcome = a._cancel ? "cancelada" : "confirmada";
          return ok({ ok: true, user_id: x.user, action: x.action, cancelled: !!a._cancel });
        }
        case "channel_open_case": { const c = casos.get(String(a._user)); return ok(c ? { id: c.id, last_to_user_at: c.lastToUserAt } : null); }
        case "incident_open_for_user": return ok(casos.get(String(a._user))?.id ?? null);
        case "incident_add_event": {
          const c = [...casos.values()].find((x) => x.id === a._id);
          if (!c) return ok({ ok: false, code: "NOT_FOUND" });
          const ev = a._ev as Record<string, unknown>;
          if (ev.dedupe_key && c.events.some((e) => e.dedupe_key === ev.dedupe_key)) return ok({ ok: true, event_id: null, duplicate: true });
          c.events.push(ev);
          return ok({ ok: true, event_id: c.events.length, duplicate: false });
        }
        case "channel_prefs_get": return ok(prefs.get(String(a._user)) ?? { preferido: "app" });
        case "channel_targets": {
          const u = String(a._user);
          return ok({
            prefs: prefs.get(u) ?? { preferido: "app" },
            links: links.filter((l) => l.active && l.user === u).map((l) => ({ channel: l.channel, external_id: l.external, window_open: !!l.lastInbound && l.lastInbound > now() - 86400_000 })),
            email: emails.get(u) ?? null, name: nombres.get(u) ?? null,
          });
        }
        case "channel_deferred_add": {
          const u = String(a._user);
          if (diferidos.some((d) => d.user === u && d.dedupe === a._dedupe)) return ok({ ok: true, id: null, duplicate: true });
          diferidos.push({ id: diferidos.length + 1, user: u, payload: a._payload, sendAfter: Date.parse(String(a._send_after)), status: "pendiente", dedupe: String(a._dedupe) });
          return ok({ ok: true, id: diferidos.length, duplicate: false });
        }
        case "channel_deferred_due": {
          const due = diferidos.filter((d) => d.status === "pendiente" && d.sendAfter <= now());
          due.forEach((d) => { d.status = "enviando"; });
          return ok(due.map((d) => ({ id: d.id, user_id: d.user, payload: d.payload })));
        }
        case "channel_deferred_finish": { const d = diferidos.find((x) => x.id === a._id); if (d) d.status = a._ok ? "enviado" : "pendiente"; return ok(true); }
        default:
          return Promise.resolve({ data: null, error: { message: `rpc desconocida ${fn}` } });
      }
    },
  };
  return db;
}
export type FakeCanalesDb = ReturnType<typeof fakeCanalesDb>;
