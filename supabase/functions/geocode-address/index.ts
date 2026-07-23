// Geocodifica una dirección/lugar via Google Maps Platform gateway (la browser key NO sirve para Geocoding)
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_maps';
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  try {
    const { address, near } = await req.json();
    if (!address || typeof address !== 'string' || address.length > 300) {
      return new Response(JSON.stringify({ error: 'address inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      return new Response(JSON.stringify({ error: 'Faltan credenciales del conector' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Usamos Places API (New) Text Search — entiende "aeropuerto", "el hotel", etc. mejor que geocoding puro
    const body: any = { textQuery: address, languageCode: 'es' };
    if (near?.lat && near?.lng) {
      body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
    }
    const r = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': GOOGLE_MAPS_API_KEY,
        'Content-Type': 'application/json',
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const p = j?.places?.[0];
    if (!p?.location) {
      return new Response(JSON.stringify({ error: 'No se encontró el lugar', raw: j }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      lat: p.location.latitude,
      lng: p.location.longitude,
      label: p.formattedAddress || p.displayName?.text || address,
      name: p.displayName?.text || address,
      place_id: p.id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
