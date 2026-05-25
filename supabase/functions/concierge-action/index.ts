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
  type: "reservation" | "pickup" | "transport" | "jet" | "alert";
  title: string;
  payload?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve user from token
    const supaUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "invalid_user" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = (await req.json()) as Body;
    if (!body?.type || !body?.title) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service client for inserts (RLS still respected via explicit user_id)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Insert concierge_request (status = processing)
    const { data: reqRow, error: reqErr } = await admin
      .from("concierge_requests")
      .insert({
        user_id: userId,
        type: body.type,
        title: body.title,
        payload: body.payload ?? {},
        status: "processing",
      })
      .select()
      .single();

    if (reqErr) {
      console.error("concierge_requests insert error", reqErr);
      return new Response(JSON.stringify({ error: reqErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const labelByType: Record<string, string> = {
      reservation: "Mesa solicitada",
      pickup: "Recolección coordinada",
      transport: "Transporte solicitado",
      jet: "Jet privado solicitado",
      alert: "Alerta atendida",
    };

    // 2) Insert immediate "received" notification
    await admin.from("notifications").insert({
      user_id: userId,
      type: body.type,
      title: `${labelByType[body.type] ?? "Solicitud recibida"} ✦`,
      body: `Tu concierge está procesando: ${body.title}.`,
      related_id: reqRow.id,
    });

    // 3) Background confirmation after short delay (simulated partner confirmation)
    const confirmTask = async () => {
      await new Promise((r) => setTimeout(r, 4500));
      await admin
        .from("concierge_requests")
        .update({ status: "confirmed" })
        .eq("id", reqRow.id);
      await admin.from("notifications").insert({
        user_id: userId,
        type: body.type,
        title: `Confirmado: ${body.title}`,
        body: `Tu ${labelByType[body.type] ?? "solicitud"} está confirmada. Revisa los detalles en tu chat.`,
        related_id: reqRow.id,
      });
    };
    // @ts-ignore EdgeRuntime is available in Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(confirmTask());
    } else {
      confirmTask();
    }

    return new Response(
      JSON.stringify({ ok: true, request: reqRow }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("concierge-action error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
