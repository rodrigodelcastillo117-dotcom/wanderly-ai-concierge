import { supabase } from "@/integrations/supabase/client";

export type InsightAction = "saved" | "removed" | "viewed" | "searched" | "planned" | "skipped";
export type InsightTarget = "destination" | "hotel" | "flight" | "tour" | "restaurant" | "expense";

export async function logInsight(
  action: InsightAction,
  target_type: InsightTarget,
  target_label: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("behavioral_insights").insert([{
      user_id: user.id,
      action,
      target_type,
      target_label,
      metadata: metadata as any,
    }]);
  } catch (e) {
    // silent — telemetry should never break UX
    console.warn("logInsight failed", e);
  }
}
