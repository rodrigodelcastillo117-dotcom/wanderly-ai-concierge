// Web push to every registered device of a user; prunes expired subscriptions.
// VAPID se configura en el primer envío (no al cargar el módulo): si faltan las llaves la función
// sigue funcionando y solo se omite el push.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createPushSender, type PushOptions, type PushPayload } from "./push-core.ts";

export { FLIGHT_PUSH_OPTIONS, PRICE_PUSH_OPTIONS } from "./push-core.ts";

const senders = new WeakMap<SupabaseClient, ReturnType<typeof createPushSender>>();

export function pushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload,
  options: PushOptions = {},
): Promise<number> {
  let sender = senders.get(admin);
  if (!sender) {
    sender = createPushSender({
      env: (k) => Deno.env.get(k),
      setVapid: (subject, pub, priv) => webpush.setVapidDetails(subject, pub, priv),
      send: (sub, body, opts) => webpush.sendNotification(sub, body, opts),
      listSubscriptions: async (id) => {
        const { data } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", id);
        return data ?? [];
      },
      deleteSubscription: async (endpoint) => {
        await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
      },
      warn: (...args) => console.warn(...args),
    });
    senders.set(admin, sender);
  }
  return sender(userId, payload, options);
}
