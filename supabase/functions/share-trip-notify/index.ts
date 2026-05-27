import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Body = {
  friend_ids: string[];
  title?: string;
  message: string;
  url?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "invalid_user" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const senderId = userData.user.id;

    const body = (await req.json()) as Body;
    const friendIds = (body.friend_ids ?? []).filter(Boolean);
    if (!friendIds.length || !body.message) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify friendship — sender must have each recipient in mis_amigos view
    const { data: misAmigos } = await supaUser.from("mis_amigos").select("amigo_id");
    const allowed = new Set((misAmigos ?? []).map((r: any) => r.amigo_id));
    const validIds = friendIds.filter((id) => allowed.has(id));
    if (!validIds.length) {
      return new Response(JSON.stringify({ error: "no_valid_friends" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get sender name for the title
    const { data: senderProfile } = await admin
      .from("profiles").select("full_name, username").eq("id", senderId).maybeSingle();
    const senderName =
      (senderProfile as any)?.full_name ||
      (senderProfile as any)?.username ||
      "Un amigo";

    const title = body.title ?? `${senderName} te compartió un viaje ✈️`;
    const fullBody = body.url ? `${body.message}\n${body.url}` : body.message;

    const rows = validIds.map((uid) => ({
      user_id: uid,
      type: "social",
      title,
      body: fullBody,
      read: false,
    }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, sent: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
