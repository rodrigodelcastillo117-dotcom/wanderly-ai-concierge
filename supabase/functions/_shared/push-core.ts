// Lógica de envío de web push sin dependencias de Deno ni de web-push, para probarla con Vitest.
// push.ts la conecta con web-push y con la base de datos.

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url: string };
/** TTL en segundos: si el teléfono está apagado más tiempo, el aviso ya no se entrega (llegaría viejo). */
export type PushOptions = { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high" };

export type PushDeps = {
  env: (k: string) => string | undefined;
  /** Configura VAPID una sola vez; puede lanzar si las llaves están mal formadas. */
  setVapid: (subject: string, publicKey: string, privateKey: string) => void;
  send: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, body: string, options: PushOptions) => Promise<unknown>;
  listSubscriptions: (userId: string) => Promise<PushSubscriptionRow[]>;
  deleteSubscription: (endpoint: string) => Promise<void>;
  warn?: (...args: unknown[]) => void;
};

export const FLIGHT_PUSH_OPTIONS: PushOptions = { TTL: 6 * 3600, urgency: "high" };
export const PRICE_PUSH_OPTIONS: PushOptions = { TTL: 24 * 3600, urgency: "normal" };

export const vapidSubject = (raw: string | undefined) => {
  const value = raw || "concierge@iatos.ai";
  // web-push requires a mailto: or https:// subject.
  return /^(mailto:|https?:\/\/)/i.test(value) ? value : `mailto:${value}`;
};

/**
 * Crea un emisor que configura VAPID la primera vez que se usa. Si faltan las llaves (o son
 * inválidas) no lanza: devuelve 0 envíos, para que las notificaciones dentro de la app sí se creen.
 */
export function createPushSender(deps: PushDeps) {
  let state: "pending" | "ready" | "disabled" = "pending";
  const warn = deps.warn ?? (() => {});

  const ready = (): boolean => {
    if (state !== "pending") return state === "ready";
    const pub = deps.env("VAPID_PUBLIC_KEY");
    const priv = deps.env("VAPID_PRIVATE_KEY");
    if (!pub || !priv) {
      warn("push: faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY; solo se crean avisos dentro de la app");
      state = "disabled";
      return false;
    }
    try {
      deps.setVapid(vapidSubject(deps.env("VAPID_SUBJECT")), pub, priv);
      state = "ready";
    } catch (e) {
      warn("push: llaves VAPID inválidas", (e as Error)?.message);
      state = "disabled";
    }
    return state === "ready";
  };

  return async function pushToUser(userId: string, payload: PushPayload, options: PushOptions = {}): Promise<number> {
    if (!ready()) return 0;
    const subs = await deps.listSubscriptions(userId);
    let sent = 0;
    for (const s of subs) {
      try {
        await deps.send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...payload, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }),
          options,
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode;
        // 410/404 = suscripción expirada → borrar
        if (status === 410 || status === 404) await deps.deleteSubscription(s.endpoint);
        else warn("push: envío fallido", status ?? (e as Error)?.message);
      }
    }
    return sent;
  };
}
