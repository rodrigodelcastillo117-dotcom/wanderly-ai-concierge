// "Ver todo": lo que el Operador IATOS puede leer del usuario para resolver su caso, SOLO con su permiso
// explícito y SIEMPRE con la sesión del propio usuario (RLS: la base solo devuelve lo suyo). Nunca usa
// la llave de servicio. Los datos sensibles se recortan (número de documento enmascarado, mensajes cortos).
// Sin Deno: el lector se inyecta (en concierge-chat es el cliente de Supabase con el JWT del usuario).

export const ALCANCES = ["viaje", "vuelos", "reservas", "boveda", "gastos", "conversaciones", "correos", "reclamos"] as const;
export type Alcance = typeof ALCANCES[number];

type Q = { data: unknown; error: unknown };
/** Lo mínimo del cliente de Supabase que se usa (from().select().eq().order().limit()). */
export type Lector = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): unknown;
      order(col: string, o?: { ascending?: boolean }): unknown;
      limit(n: number): unknown;
    };
  };
};

export const PREGUNTA_PERMISO =
  "Para resolverlo necesito revisar tu viaje, vuelos, reservas, documentos de la Bóveda (sin mostrar números completos), gastos, " +
  "conversaciones y los correos que me reenviaste. ¿Me das permiso? Solo lo uso para este caso.";

const MAX = 600;
const corto = (s: unknown, n = MAX) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
export const enmascarar = (num: unknown) => {
  const s = String(num ?? "").replace(/\s+/g, "");
  return s ? `••••${s.slice(-4)}` : null;
};

type Consulta = { tabla: string; cols: string; filtros?: Array<[string, unknown]>; orden?: string; limite: number; mapa?: (r: Record<string, unknown>) => Record<string, unknown> };

function consultas(userId: string, tripId: string | null): Record<Alcance, Consulta[]> {
  const deUsuario: Array<[string, unknown]> = [["user_id", userId]];
  const delViaje = (extra: Array<[string, unknown]> = []) => (tripId ? [...extra, ["trip_id", tripId] as [string, unknown]] : extra);
  return {
    viaje: [{
      tabla: "trips", cols: "id, destino, pais_destino, ciudad_origen, fecha_salida, fecha_regreso, num_viajeros, status, vuelos_json, hospedaje_json",
      filtros: tripId ? [["id", tripId], ...deUsuario] : deUsuario, orden: "fecha_salida", limite: 3,
      mapa: (r) => ({ ...r, vuelos_json: corto(JSON.stringify(r.vuelos_json ?? null), 1200), hospedaje_json: corto(JSON.stringify(r.hospedaje_json ?? null), 1200) }),
    }],
    vuelos: [{ tabla: "tracked_flights", cols: "flight, flight_date, route, last_status, last_estimated, last_gate, last_terminal, trip_id", filtros: delViaje(deUsuario), orden: "flight_date", limite: 10 }],
    reservas: [
      { tabla: "bookings", cols: "category, provider, status, title, city, country, start_at, end_at, price_amount, price_currency, confirmation_code, trip_id", filtros: delViaje(deUsuario), orden: "start_at", limite: 20 },
      { tabla: "ai_reservations", cols: "venue_name, status, requested_local, party_size, venue_city, trip_id", filtros: delViaje(deUsuario), orden: "created_at", limite: 10 },
    ],
    boveda: [{
      tabla: "vault_items", cols: "section, kind, title, issuer, holder_name, country_code, number, expires_on", filtros: deUsuario, orden: "created_at", limite: 30,
      mapa: (r) => ({ ...r, number: enmascarar(r.number) }),
    }],
    gastos: [{ tabla: "expenses", cols: "amount, currency, category, description, expense_date, trip_id", filtros: delViaje(deUsuario), orden: "expense_date", limite: 100 }],
    conversaciones: [{
      tabla: "concierge_conversations", cols: "trip_id, updated_at, resumen_historico, messages", filtros: delViaje(deUsuario), orden: "updated_at", limite: 2,
      mapa: (r) => {
        const msgs = Array.isArray(r.messages) ? r.messages.slice(-6) : [];
        return {
          trip_id: r.trip_id, updated_at: r.updated_at, resumen: corto(r.resumen_historico, 800),
          ultimos: msgs.map((m: Record<string, unknown>) => ({ rol: m?.role, texto: corto(m?.content, 300) })),
        };
      },
    }],
    correos: [{ tabla: "forwarded_emails", cols: "subject, from_address, received_at, text_excerpt, sender_verified, claim_id", filtros: deUsuario, orden: "created_at", limite: 10, mapa: (r) => ({ ...r, text_excerpt: corto(r.text_excerpt, 1500) }) }],
    reclamos: [{ tabla: "claims", cols: "id, ref_code, kind, provider_name, status, channel, sent_at, last_reply_at, reply", filtros: deUsuario, orden: "created_at", limite: 10, mapa: (r) => ({ ...r, reply: r.reply ? { resultado: (r.reply as Record<string, unknown>).resultado_final, resumen: (r.reply as Record<string, unknown>).resumen_es } : null }) }],
  };
}

export type VerTodoResultado =
  | { ok: false; code: "PERMISO_REQUERIDO"; pregunta: string }
  | { ok: true; fuente: "tu cuenta de IATOS (solo tus datos)"; datos: Partial<Record<Alcance, unknown>>; no_disponible: Alcance[] };

export async function verTodo(l: Lector, userId: string, i: { permiso?: boolean; alcance?: string[] | null; trip_id?: string | null }): Promise<VerTodoResultado> {
  if (i?.permiso !== true) return { ok: false, code: "PERMISO_REQUERIDO", pregunta: PREGUNTA_PERMISO };
  const pedidos = (i.alcance?.length ? i.alcance : ALCANCES).filter((a): a is Alcance => (ALCANCES as readonly string[]).includes(a));
  const tripId = typeof i.trip_id === "string" && /^[0-9a-f-]{36}$/i.test(i.trip_id) ? i.trip_id : null;
  const qs = consultas(userId, tripId);
  const datos: Partial<Record<Alcance, unknown>> = {};
  const no: Alcance[] = [];
  await Promise.all(pedidos.map(async (a) => {
    const partes: Record<string, unknown> = {};
    let fallo = false;
    for (const q of qs[a]) {
      // deno-lint-ignore no-explicit-any
      let b: any = l.from(q.tabla).select(q.cols);
      for (const [col, val] of q.filtros ?? []) b = b.eq(col, val);
      if (q.orden) b = b.order(q.orden, { ascending: false });
      const r = (await b.limit(q.limite)) as Q;
      if (r.error) { fallo = true; continue; }
      const rows = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : [];
      partes[q.tabla] = q.mapa ? rows.map(q.mapa) : rows;
    }
    if (fallo && !Object.keys(partes).length) no.push(a);
    else datos[a] = qs[a].length === 1 ? partes[qs[a][0].tabla] : partes;
  }));
  return { ok: true, fuente: "tu cuenta de IATOS (solo tus datos)", datos, no_disponible: no };
}
