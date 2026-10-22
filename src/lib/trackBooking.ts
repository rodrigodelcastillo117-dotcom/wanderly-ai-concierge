import { supabase } from "@/integrations/supabase/client";

export type TrackBookingInput = {
  category: "restaurant" | "train" | "ferry" | "flight" | "hotel" | "car" | "activity" | "esim" | "insurance" | "other";
  provider: string;
  title: string;
  subtitle?: string;
  bookingUrl: string;
  city?: string;
  country?: string;
  startAt?: string;
  imageUrl?: string;
};

/**
 * Abre un link externo en una pestaña nueva DENTRO del mismo gesto del usuario.
 * CRÍTICO iOS/Safari: cualquier `await` antes de window.open pierde el gesto y Safari bloquea
 * la ventana. No se pasa "noopener" en features porque entonces window.open siempre devuelve
 * null y no se puede saber si se bloqueó; se corta `opener` a mano. Si el navegador bloqueó la
 * pestaña, se navega en la misma (el link nunca se pierde).
 */
export function openExternalUrl(url: string): void {
  if (!url) return;
  const win = window.open(url, "_blank");
  if (win) {
    try { win.opener = null; } catch { /* algunos navegadores no lo permiten; no es crítico */ }
  } else {
    window.location.href = url;
  }
}

/**
 * Registra el clic de afiliado en segundo plano (sin bloquear). Para links <a href> que ya
 * abren solos: llamar en su onClick sin preventDefault.
 */
export function logBookingClick(b: TrackBookingInput): Promise<void> {
  return (async () => {
    try {
      // getSession lee la sesión local (sin red), a diferencia de getUser.
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!userId) return;
      const { error } = await supabase.from("bookings").insert({
        user_id: userId,
        category: b.category,
        provider: b.provider,
        title: b.title,
        subtitle: b.subtitle ?? null,
        booking_url: b.bookingUrl,
        city: b.city ?? null,
        country: b.country ?? null,
        start_at: b.startAt ?? null,
        image_url: b.imageUrl ?? null,
        status: "pending",
      });
      if (error) console.warn("No se pudo registrar el clic de reserva:", error.message);
    } catch (e) {
      console.warn("No se pudo registrar el clic de reserva:", (e as Error)?.message);
    }
  })();
}

/**
 * Abre el link del socio (de inmediato, síncrono) y después registra el clic sin esperar.
 * Antes primero esperaba `getUser()` (red) y el insert, y solo entonces abría: en iOS el
 * pop-up se bloqueaba y el usuario no llegaba al socio.
 */
export function trackBookingClick(b: TrackBookingInput): void {
  openExternalUrl(b.bookingUrl);
  void logBookingClick(b);
}
