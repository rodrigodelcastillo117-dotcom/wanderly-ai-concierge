// Routes API v2 - computeRoutes para los 4 modos
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

type Point = { lat?: number; lng?: number; placeId?: string; address?: string };
type Mode = "DRIVE" | "TRANSIT" | "WALK" | "BICYCLE";

type Body = {
  origin: Point;
  destination: Point;
  modes?: Mode[]; // default: los 4
  language?: string;
  units?: "METRIC" | "IMPERIAL";
  departureTime?: string; // ISO; útil para TRANSIT/DRIVE con tráfico
};

const ALL_MODES: Mode[] = ["DRIVE", "TRANSIT", "WALK", "BICYCLE"];

function waypoint(p: Point) {
  if (p.placeId) return { placeId: p.placeId };
  if (typeof p.lat === "number" && typeof p.lng === "number") {
    return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
  }
  if (p.address) return { address: p.address };
  return null;
}

function mapsLink(origin: Point, destination: Point, mode: Mode): string {
  const travel = mode === "DRIVE" ? "driving" : mode === "TRANSIT" ? "transit" : mode === "WALK" ? "walking" : "bicycling";
  const fmt = (p: Point) =>
    p.placeId
      ? `&origin_place_id=${encodeURIComponent(p.placeId)}`
      : typeof p.lat === "number" && typeof p.lng === "number"
        ? `${p.lat},${p.lng}`
        : p.address ?? "";
  const o = typeof origin.lat === "number" ? `${origin.lat},${origin.lng}` : encodeURIComponent(origin.address ?? "");
  const d = typeof destination.lat === "number" ? `${destination.lat},${destination.lng}` : encodeURIComponent(destination.address ?? "");
  const placeIds =
    (origin.placeId ? `&origin_place_id=${encodeURIComponent(origin.placeId)}` : "") +
    (destination.placeId ? `&destination_place_id=${encodeURIComponent(destination.placeId)}` : "");
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${travel}${placeIds}`;
}

function fieldMaskFor(_mode: Mode): string {
  // Mismo mask sirve para todos los modos; TRANSIT añade transitDetails dentro de steps
  return [
    "routes.duration",
    "routes.distanceMeters",
    "routes.description",
    "routes.legs.duration",
    "routes.legs.distanceMeters",
    "routes.legs.steps.distanceMeters",
    "routes.legs.steps.staticDuration",
    "routes.legs.steps.navigationInstruction",
    "routes.legs.steps.travelMode",
    "routes.legs.steps.transitDetails",
  ].join(",");
}

function parseDurationSec(d: string | number | undefined): number | null {
  if (d == null) return null;
  if (typeof d === "number") return d;
  // formato "123s"
  const m = /^(\d+(\.\d+)?)s$/.exec(d);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function humanDuration(sec: number | null): string | null {
  if (sec == null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

function humanDistance(meters: number | null, units: "METRIC" | "IMPERIAL"): string | null {
  if (meters == null) return null;
  if (units === "IMPERIAL") {
    const mi = meters / 1609.344;
    return mi < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

async function computeRoute(mode: Mode, body: Body, key: string) {
  const origin = waypoint(body.origin);
  const destination = waypoint(body.destination);
  if (!origin || !destination) {
    return { mode, available: false, reason: "origen/destino inválido" };
  }

  const payload: Record<string, unknown> = {
    origin,
    destination,
    travelMode: mode,
    languageCode: body.language ?? "es",
    units: body.units ?? "METRIC",
  };
  if (mode === "DRIVE") payload.routingPreference = "TRAFFIC_AWARE";
  if (mode === "DRIVE" || mode === "TRANSIT") {
    if (body.departureTime) payload.departureTime = body.departureTime;
  }
  if (mode === "TRANSIT") {
    payload.transitPreferences = { routingPreference: "LESS_WALKING" };
  }

  try {
    const res = await fetch("https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`, "X-Connection-Api-Key": key,
        "X-Goog-FieldMask": fieldMaskFor(mode),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      return {
        mode,
        available: false,
        reason: data?.error?.message ?? `HTTP ${res.status}`,
      };
    }
    const route = data?.routes?.[0];
    if (!route) {
      return { mode, available: false, reason: "Sin rutas disponibles para este modo" };
    }

    const durSec = parseDurationSec(route.duration);
    const distM = typeof route.distanceMeters === "number" ? route.distanceMeters : null;
    const units = (body.units ?? "METRIC") as "METRIC" | "IMPERIAL";

    const steps: Array<{
      instruction: string | null;
      distance: string | null;
      duration: string | null;
      mode: string;
      transit: null | {
        line: string | null;
        line_short: string | null;
        vehicle: string | null;
        color: string | null;
        headsign: string | null;
        departure_stop: string | null;
        arrival_stop: string | null;
        departure_time: string | null;
        arrival_time: string | null;
        num_stops: number | null;
      };
    }> = [];
    const transitLegs: Array<NonNullable<(typeof steps)[number]["transit"]>> = [];

    for (const leg of route.legs ?? []) {
      for (const s of leg.steps ?? []) {
        let transit = null as (typeof steps)[number]["transit"];
        if (s.transitDetails) {
          const td = s.transitDetails;
          transit = {
            line: td.transitLine?.name ?? null,
            line_short: td.transitLine?.nameShort ?? null,
            vehicle: td.transitLine?.vehicle?.name?.text ?? td.transitLine?.vehicle?.type ?? null,
            color: td.transitLine?.color ?? null,
            headsign: td.headsign ?? null,
            departure_stop: td.stopDetails?.departureStop?.name ?? null,
            arrival_stop: td.stopDetails?.arrivalStop?.name ?? null,
            departure_time: td.stopDetails?.departureTime ?? td.localizedValues?.departureTime?.time?.text ?? null,
            arrival_time: td.stopDetails?.arrivalTime ?? td.localizedValues?.arrivalTime?.time?.text ?? null,
            num_stops: td.stopCount ?? null,
          };
          transitLegs.push(transit);
        }
        steps.push({
          instruction: s.navigationInstruction?.instructions ?? (transit ? `Toma ${transit.line_short ?? transit.line ?? "transporte"} hacia ${transit.headsign ?? transit.arrival_stop ?? ""}` : null),
          distance: humanDistance(typeof s.distanceMeters === "number" ? s.distanceMeters : null, units),
          duration: humanDuration(parseDurationSec(s.staticDuration)),
          mode: s.travelMode ?? mode,
          transit,
        });
      }
    }

    return {
      mode,
      available: true,
      duration_seconds: durSec,
      duration_text: humanDuration(durSec),
      distance_meters: distM,
      distance_text: humanDistance(distM, units),
      description: route.description ?? null,
      transit_summary: mode === "TRANSIT"
        ? {
            transfers: Math.max(0, transitLegs.length - 1),
            lines: transitLegs.map((t) => t.line_short ?? t.line).filter(Boolean),
            stops: transitLegs.map((t) => ({
              line: t.line_short ?? t.line,
              from: t.departure_stop,
              to: t.arrival_stop,
              num_stops: t.num_stops,
            })),
          }
        : null,
      steps: steps.slice(0, 25),
      maps_url: mapsLink(body.origin, body.destination, mode),
    };
  } catch (err) {
    return { mode, available: false, reason: (err as Error).message ?? "Error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);


  // --- Auth gate: require valid Supabase JWT to prevent API quota abuse ---
  try {
    const __authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!__authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const __serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const __token = __authHeader.replace(/^Bearer\s+/i, "");
    if (!__serviceKey || __token !== __serviceKey) {
      const __apikey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const __ures = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { Authorization: __authHeader, apikey: __apikey },
    });
    if (!__ures.ok) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  } catch (_e) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // --- end auth gate ---
  try {
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!key || !lovableKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.origin || !body?.destination) {
      return new Response(JSON.stringify({ error: "origin y destination requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!waypoint(body.origin) || !waypoint(body.destination)) {
      return new Response(JSON.stringify({ error: "Cada punto requiere {lat,lng}, placeId o address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const modes = (body.modes?.length ? body.modes : ALL_MODES).filter((m) => ALL_MODES.includes(m));
    const results = await Promise.all(modes.map((m) => computeRoute(m, body, key)));

    return new Response(JSON.stringify({ routes: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
