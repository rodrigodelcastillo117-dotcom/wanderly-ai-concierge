// enviar-opinion (lógica sin Deno, probada en src/test/opiniones.test.tsx): valida la opinión en el
// servidor, aplica el límite por persona, la guarda como solicitud de la Mesa de operaciones
// (concierge_requests type 'opinion') y avisa al equipo por correo con la marca de la mesa (sin
// duplicados; si el correo falla queda pendiente y health-check lo reintenta). Nunca confía en el cliente:
// la pantalla la nombra el servidor, el viaje solo se liga si el usuario lo puede ver.
import { folioOf } from "../_shared/ops-labels.ts";
import { opinionPayload, opinionTitle, validateOpinion } from "../_shared/opinion.ts";
import { rateLimitBody, type RateLimitVerdict } from "../_shared/rate-limit-core.ts";
import { idemKeyFrom, type IdemStore, type StoredResponse, withIdempotency } from "../_shared/idempotency.ts";

/** Límite por persona: 3 por minuto, 10 por hora (y 10 por minuto por red). */
export const OPINION_LIMITS = { perMinute: 3, perHour: 10, ipPerMinute: 10 } as const;

type DbError = { code?: string; message: string } | null;
export interface OpinionDeps {
  userId: string;
  userEmail: string | null;
  rateLimit: () => Promise<RateLimitVerdict>;
  /** ¿El usuario puede ver ese viaje? (RLS de trips con su propio token). */
  tripVisible: (tripId: string) => Promise<boolean>;
  insert: (row: Record<string, unknown>) => PromiseLike<{ data: { id: string; status: string } | null; error: DbError }>;
  /** Aviso al equipo (sendOwnerAlert de _shared/ops-desk.ts). */
  alert: (requestId: string, replyTo: string | null) => Promise<{ notified: boolean; code?: string }>;
  idem?: IdemStore | null;
  warn?: (...a: unknown[]) => void;
}

const res = (status: number, body: Record<string, unknown>): StoredResponse => ({ status, body });

export async function submitOpinion(d: OpinionDeps, raw: unknown): Promise<StoredResponse> {
  // Primero el límite: frena el abuso aunque mande basura.
  const rl = await d.rateLimit();
  if (!rl.allowed) {
    const { status, body } = rateLimitBody(rl);
    return res(status, rl.scope === "unavailable" ? body : {
      ...body, message: "Ya nos mandaste varias opiniones en poco tiempo. Espera un rato y vuelve a intentarlo.",
    });
  }
  const v = validateOpinion(raw);
  if (v.ok === false) {
    const bad = v as Extract<typeof v, { ok: false }>;
    return res(400, { ok: false, code: bad.code, message: bad.message });
  }
  const op = v.value;
  const key = idemKeyFrom((raw as Record<string, unknown> | null)?.idempotency_key);

  return await withIdempotency(d.idem ?? null, d.userId, "enviar-opinion", key, async () => {
    const tripId = op.trip_id && await d.tripVisible(op.trip_id).catch(() => false) ? op.trip_id : null;
    const { data, error } = await d.insert({
      user_id: d.userId, trip_id: tripId, type: "opinion", title: opinionTitle(op), payload: opinionPayload(op), status: "solicitado",
    });
    if (error || !data) {
      if (/OPINION_RATE_LIMIT/.test(error?.message ?? "")) {
        return res(429, { ok: false, code: "RATE_LIMITED", message: "Ya nos mandaste varias opiniones en poco tiempo. Espera un rato y vuelve a intentarlo." });
      }
      if (error?.code === "23514") return res(400, { ok: false, code: "INVALID", message: "Revisa lo que escribiste e inténtalo de nuevo." });
      d.warn?.("enviar-opinion: no se guardó", error?.code ?? "", error?.message ?? "");
      return res(500, { ok: false, code: "NOT_SAVED", message: "No pudimos guardar tu opinión. Inténtalo de nuevo en un momento." });
    }
    // Guardada = ya está en la mesa del equipo. El correo es el aviso; si falla, se reintenta solo.
    let notified = false;
    try {
      const r = await d.alert(data.id, op.contactar ? d.userEmail : null);
      notified = r.notified;
      if (!r.notified) d.warn?.("enviar-opinion: aviso pendiente", r.code ?? "");
    } catch (e) {
      d.warn?.("enviar-opinion: error al avisar", e instanceof Error ? e.message : String(e));
    }
    return res(200, {
      ok: true, id: data.id, folio: folioOf(data.id), team_notified: notified,
      // Lo que se adjuntó, tal como quedó guardado (el diálogo lo muestra).
      contexto: { ruta: op.ruta, pantalla: op.pantalla, dispositivo: op.dispositivo, version: op.version, trip_id: tripId },
    });
  });
}
