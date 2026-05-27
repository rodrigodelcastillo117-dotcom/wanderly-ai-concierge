import { supabase } from "@/integrations/supabase/client";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function ensureSWRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  } catch { return null; }
}

export async function subscribePush(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!("Notification" in window) || !("PushManager" in window)) {
      return { ok: false, error: "Tu navegador no soporta notificaciones push" };
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, error: "Permiso denegado" };

    const reg = await ensureSWRegistered();
    if (!reg) return { ok: false, error: "No pude registrar el service worker" };

    // Pedir public key al backend (también guarda suscripción cuando se la mandemos después)
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-subscribe`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      const { vapidPublicKey } = await r.json();
      if (!vapidPublicKey) return { ok: false, error: "VAPID key no configurada" };
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const { error } = await supabase.functions.invoke("push-subscribe", {
      body: { subscription: sub.toJSON(), user_agent: navigator.userAgent },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Error desconocido" };
  }
}

export async function trackFlight(args: { flight: string; flight_date?: string; route?: string; trip_id?: string; active?: boolean }) {
  const { data, error } = await supabase.functions.invoke("track-flight", { body: args });
  if (error) throw error;
  return data;
}
