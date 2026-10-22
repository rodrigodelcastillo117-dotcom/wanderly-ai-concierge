// SOLO PRUEBAS LOCALES. Un "PostgREST" mínimo sobre un Postgres LOCAL con todas las migraciones del repo,
// para que la app (build de producción) hable con las funciones y tablas REALES con RLS.
//
// · /rest/v1/rpc/<fn>  → ejecuta public.<fn>(args con nombre) en una transacción con
//   request.jwt.claims {sub, role, session_id} y SET LOCAL ROLE authenticated|anon (como PostgREST).
//   Tipos de los argumentos desde pg_proc. Errores con la forma de PostgREST: P0001 → 400 {code,message,
//   details,hint}; función inexistente → 404 PGRST202; permiso → 401/403 42501.
// · /rest/v1/<tabla>   → GET/POST/PATCH/DELETE con select de columnas simples, filtros eq/neq/gt/gte/lt/lte/
//   is/in, order, limit y Prefer: resolution=merge-duplicates, también bajo RLS. Lo que no soporta (embebidos,
//   or=…) se responde vacío y queda ANOTADO en `unsupported` (no se cuenta como probado).
// · /auth/v1/*         → Auth SIMULADA: los JWT no se firman (el shim los decodifica); el usuario sale de
//   auth.users real y la sesión (session_id) existe en auth.sessions (la sesión Privé se ata a ella).
// · /functions/v1/*    → edge functions SIMULADAS ({}), anotadas en `functions`.
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const postgres = require("postgres");

const IDENT = /^[a-z_][a-z0-9_]*$/;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function makeJwt(user, sessionId, ttl = 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return { token: `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: user, exp, role: "authenticated", session_id: sessionId, aud: "authenticated" })}.e2e`, exp };
}
function claimsFrom(req) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return c && typeof c.sub === "string" && c.role === "authenticated" ? c : null;
  } catch { return null; }
}

export function createShim({ path, database, log = () => {} }) {
  const sql = postgres({ path, database, username: "postgres", max: 6, onnotice: () => {}, idle_timeout: 5 });
  const stats = { rpc: {}, tables: {}, unsupported: [], functions: [], errors: [] };
  const metaCache = new Map();

  async function fnMeta(name) {
    if (metaCache.has(name)) return metaCache.get(name);
    const rows = await sql`
      SELECT coalesce(p.proargnames, '{}') AS names,
             coalesce((SELECT array_agg(format_type(t, NULL) ORDER BY o) FROM unnest(p.proargtypes) WITH ORDINALITY u(t, o)), '{}') AS types,
             p.pronargdefaults AS ndef, p.proretset AS setof, format_type(p.prorettype, NULL) AS rettype
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ${name}`;
    const list = rows.map((r) => ({ names: r.names.slice(0, r.types.length), types: r.types, ndef: r.ndef, setof: r.setof, rettype: r.rettype }));
    metaCache.set(name, list);
    return list;
  }
  const argExpr = (type, i, v) => {
    if (v === null || v === undefined) return `NULL::${type}`;
    if (type === "jsonb" || type === "json") return `$${i}::${type}`;
    if (type.endsWith("[]")) return `ARRAY(SELECT jsonb_array_elements_text($${i}::jsonb))::${type}`;
    return `($${i}::jsonb #>> '{}')::${type}`;
  };
  const pgErr = (e, anon) => {
    if (e.code === "42883") return [404, { code: "PGRST202", message: e.message, details: null, hint: null }];
    if (e.code === "42501") return [anon ? 401 : 403, { code: "42501", message: e.message, details: e.detail ?? null, hint: e.hint ?? null }];
    if (e.code === "P0001" || /^[0-9A-Z]{5}$/.test(e.code ?? "")) return [400, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null }];
    return [500, { code: "XX000", message: String(e.message ?? e), details: null, hint: null }];
  };
  async function asRole(claims, fn) {
    const role = claims ? "authenticated" : "anon";
    const jwt = claims ? { sub: claims.sub, role, session_id: claims.session_id, aud: "authenticated" } : { role: "anon" };
    return sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)`,
        [JSON.stringify(jwt), claims?.sub ?? "", role]);
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      return fn(tx);
    });
  }

  async function rpc(name, body, claims) {
    stats.rpc[name] = (stats.rpc[name] ?? 0) + 1;
    if (!IDENT.test(name)) return [404, { code: "PGRST202", message: "bad name" }];
    const keys = Object.keys(body ?? {});
    const cands = (await fnMeta(name)).filter((m) => keys.every((k) => m.names.includes(k)) && m.names.slice(0, m.names.length - m.ndef).every((n) => keys.includes(n)));
    if (!cands.length) return [404, { code: "PGRST202", message: `Could not find the function public.${name}(${keys.join(", ")}) in the schema cache`, details: null, hint: null }];
    const m = cands[0];
    const params = [];
    const args = keys.map((k) => {
      const type = m.types[m.names.indexOf(k)];
      const v = body[k];
      if (v !== null && v !== undefined) params.push(v);   // postgres.js serializa según el tipo (jsonb) del parámetro
      return `${k} => ${argExpr(type, params.length, v)}`;
    }).join(", ");
    const call = `public.${name}(${args})`;
    const q = m.rettype === "void" ? `SELECT ${call}, NULL::jsonb AS v`
      : m.setof ? `SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) AS v FROM ${call} r`
      : `SELECT to_jsonb(${call}) AS v`;
    try {
      const rows = await asRole(claims, (tx) => tx.unsafe(q, params));
      return [200, rows[0]?.v ?? null];
    } catch (e) {
      const out = pgErr(e, !claims);
      stats.errors.push({ rpc: name, status: out[0], code: out[1].code, message: out[1].message });
      return out;
    }
  }

  async function table(method, name, url, body, claims, headers) {
    stats.tables[`${method} ${name}`] = (stats.tables[`${method} ${name}`] ?? 0) + 1;
    if (!IDENT.test(name)) return [404, { code: "42P01", message: "bad table" }];
    const params = [];
    const where = [];
    let select = "*"; let order = ""; let limit = "";
    for (const [k, v] of url.searchParams) {
      if (k === "select") {
        const cols = v.split(",").map((c) => c.trim()).filter(Boolean);
        if (cols.some((c) => c !== "*" && !IDENT.test(c))) { stats.unsupported.push(`${method} ${name}?select=${v}`); return [200, []]; }
        select = cols.join(", ") || "*";
      } else if (k === "order") {
        const parts = v.split(",").map((p) => { const [c, dir, nulls] = p.split("."); if (!IDENT.test(c)) return null; return `${c} ${dir === "desc" ? "DESC" : "ASC"}${nulls === "nullslast" ? " NULLS LAST" : nulls === "nullsfirst" ? " NULLS FIRST" : ""}`; });
        if (parts.includes(null)) { stats.unsupported.push(`${method} ${name}?order=${v}`); return [200, []]; }
        order = ` ORDER BY ${parts.join(", ")}`;
      } else if (k === "limit") limit = ` LIMIT ${Number(v) | 0}`;
      else if (k === "offset") limit += ` OFFSET ${Number(v) | 0}`;
      else if (k === "columns" || k === "on_conflict") continue;
      else {
        if (!IDENT.test(k)) { stats.unsupported.push(`${method} ${name}?${k}=${v}`); return [200, []]; }
        const mm = /^(eq|neq|gt|gte|lt|lte|is|in|like|ilike)\.(.*)$/s.exec(v);
        if (!mm) { stats.unsupported.push(`${method} ${name}?${k}=${v}`); return [200, []]; }
        const [, op, val] = mm;
        if (op === "is") where.push(`${k} IS ${val === "null" ? "NULL" : val === "true" ? "TRUE" : "FALSE"}`);
        else if (op === "in") { params.push(val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""))); where.push(`${k}::text IN (SELECT jsonb_array_elements_text($${params.length}::jsonb))`); }
        else { params.push(val); const sqlop = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" }[op]; where.push(`${k}::text ${sqlop} $${params.length}`); }
      }
    }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const wantsObject = (headers.accept || "").includes("vnd.pgrst.object");
    const prefer = headers.prefer || "";
    const returning = /return=representation/.test(prefer);
    let q;
    if (method === "GET" || method === "HEAD") q = `SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS v FROM (SELECT ${select} FROM public.${name}${w}${order}${limit}) t`;
    else if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
      if (!cols.length || cols.some((c) => !IDENT.test(c))) { stats.unsupported.push(`POST ${name}`); return [201, []]; }
      params.push(rows);
      let conflict = "";
      if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
        const target = url.searchParams.get("on_conflict");
        const pk = target ? target.split(",") : (await sql`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = ${"public." + name}::regclass AND i.indisprimary`).map((r) => r.attname);
        conflict = /ignore-duplicates/.test(prefer) ? ` ON CONFLICT (${pk.join(", ")}) DO NOTHING`
          : ` ON CONFLICT (${pk.join(", ")}) DO UPDATE SET ${cols.filter((c) => !pk.includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(", ") || `${pk[0]} = EXCLUDED.${pk[0]}`}`;
      }
      q = `WITH ins AS (INSERT INTO public.${name} (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM jsonb_populate_recordset(NULL::public.${name}, $${params.length}::jsonb)${conflict} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) AS v FROM ins`;
    } else if (method === "PATCH") {
      const cols = Object.keys(body ?? {});
      if (!cols.length || cols.some((c) => !IDENT.test(c))) { stats.unsupported.push(`PATCH ${name}`); return [204, null]; }
      params.push(body);
      q = `WITH up AS (UPDATE public.${name} SET (${cols.join(", ")}) = (SELECT ${cols.join(", ")} FROM jsonb_populate_record(NULL::public.${name}, $${params.length}::jsonb))${w} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(up)), '[]'::jsonb) AS v FROM up`;
      if (cols.length === 1) q = q.replace(`SET (${cols[0]}) = (SELECT ${cols[0]} FROM`, `SET ${cols[0]} = (SELECT ${cols[0]} FROM`);
    } else if (method === "DELETE") q = `WITH d AS (DELETE FROM public.${name}${w} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) AS v FROM d`;
    else return [405, {}];
    try {
      const rows = await asRole(claims, (tx) => tx.unsafe(q, params));
      const v = rows[0]?.v ?? [];
      if (method === "GET" || method === "HEAD") {
        if (wantsObject) return v.length === 1 ? [200, v[0]] : [406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${v.length} rows`, hint: null }];
        return [200, v];
      }
      if (!returning) return [method === "POST" ? 201 : 204, null];
      return [method === "POST" ? 201 : 200, wantsObject ? v[0] ?? null : v];
    } catch (e) {
      const out = pgErr(e, !claims);
      stats.errors.push({ table: `${method} ${name}`, status: out[0], code: out[1].code, message: out[1].message });
      return out;
    }
  }

  async function authUser(claims) {
    if (!claims) return null;
    const [u] = await sql`SELECT id, email, raw_user_meta_data AS user_metadata, created_at FROM auth.users WHERE id = ${claims.sub}`;
    return u ? { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.user_metadata ?? {}, app_metadata: {}, created_at: u.created_at } : null;
  }

  const server = http.createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,HEAD,OPTIONS",
      "access-control-expose-headers": "content-range, content-profile" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let raw = "";
    for await (const ch of req) raw += ch;
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { body = {}; } }
    const url = new URL(req.url, "http://x");
    const send = (code, v) => {
      res.writeHead(code, { ...cors, "content-type": "application/json; charset=utf-8", "content-range": Array.isArray(v) ? `0-${Math.max(0, v.length - 1)}/${v.length}` : "*/*" });
      res.end(code === 204 || v === undefined ? "" : JSON.stringify(v));
    };
    const claims = claimsFrom(req);
    try {
      if (url.pathname === "/auth/v1/user") { const u = await authUser(claims); return u ? send(200, u) : send(401, { code: 401, msg: "invalid JWT" }); }
      if (url.pathname.startsWith("/auth/v1/logout")) return send(204);
      if (url.pathname.startsWith("/auth/v1/token")) {
        // refresh_token "e2e-refresh:<uuid>:<session_id>" (simulado).
        const [, uid, sid] = String(body.refresh_token ?? "").split(":");
        const u = uid ? await authUser({ sub: uid }) : null;
        if (!u) return send(400, { error: "invalid_grant" });
        const j = makeJwt(uid, sid);
        return send(200, { access_token: j.token, refresh_token: body.refresh_token, token_type: "bearer", expires_in: 86400, expires_at: j.exp, user: u });
      }
      if (url.pathname.startsWith("/auth/v1/")) return send(200, {});
      const m = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/.exec(url.pathname);
      if (m) { const [code, v] = await rpc(m[1], body, claims); log(`rpc ${m[1]} → ${code}`); return send(code, v); }
      const t = /^\/rest\/v1\/([A-Za-z0-9_]+)$/.exec(url.pathname);
      if (t) { const [code, v] = await table(req.method, t[1], url, body, claims, req.headers); return send(code, v); }
      if (url.pathname.startsWith("/functions/v1/")) { stats.functions.push(url.pathname.slice(14)); return send(200, {}); }
      return send(404, {});
    } catch (e) {
      stats.errors.push({ path: url.pathname, message: String(e?.message ?? e) });
      return send(500, { message: String(e?.message ?? e) });
    }
  });
  return {
    sql, stats,
    listen: (port, host = "127.0.0.1") => new Promise((r) => server.listen(port, host, r)),
    close: async () => { server.close(); await sql.end({ timeout: 2 }); },
  };
}
