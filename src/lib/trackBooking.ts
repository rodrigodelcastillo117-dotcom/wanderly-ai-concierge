import { supabase } from "@/integrations/supabase/client";

export type TrackBookingInput = {
  category: "restaurant" | "train" | "flight" | "hotel" | "car" | "activity" | "esim" | "insurance";
  provider: string;
  title: string;
  subtitle?: string;
  bookingUrl: string;
  city?: string;
  country?: string;
  startAt?: string;
  imageUrl?: string;
};

export async function trackBookingClick(b: TrackBookingInput) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) {
    window.open(b.bookingUrl, "_blank");
    return;
  }
  await supabase.from("bookings").insert({
    user_id: u.user.id,
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
  window.open(b.bookingUrl, "_blank");
}
