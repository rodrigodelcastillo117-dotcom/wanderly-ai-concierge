// Web push to every registered device of a user; prunes expired subscriptions.
import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  // web-push requires a mailto: or https:// subject.
  const raw = Deno.env.get("VAPID_SUBJECT") || "concierge@iatos.ai";
  const subject = /^(mailto:|https?:\/\/)/i.test(raw) ? raw : `mailto:${raw}`;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export async function pushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url: string },
): Promise<number> {
  if (!configure()) return 0;
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }),
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 410 || status === 404) {
        await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      }
    }
  }
  return sent;
}
