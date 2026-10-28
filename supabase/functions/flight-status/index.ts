// Estado de vuelo: widget estructurado de Google vía SerpApi; Perplexity es un fallback opcional.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { z } from "npm:zod@3.25.76";
import { querySerpApi } from "../_shared/flight-serpapi.ts";
import { serpFetchFor } from "../_shared/serpRuntime.ts";
import { flightStatusUnavailableBody } from "../_shared/flight-serpapi.ts";

const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
const SERPAPI_PRIVATE_KEY = Deno.env.get('SERPAPI_PRIVATE_KEY');
const BodySchema = z.object({
  flight: z.string().trim().min(1).max(80).optional(),
  route: z.string().trim().min(1).max(100).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }).nullish(),
}).refine(body => body.flight || body.route);
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "flight-status", __user.id, { perMinute: 20, perHour: 200, ipPerMinute: 60 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);


  try {
    const input = BodySchema.safeParse(await req.json().catch(() => null));
    if (!input.success) return jsonResponse({ error: 'Número de vuelo/ruta o fecha inválidos' }, 400);
    const { flight, route } = input.data;
    const date = input.data.date ?? new Date().toISOString().slice(0, 10);
    // Tope diario de búsquedas en vivo (o cuota agotada): se dice tal cual, no "no respondió" (auditoría 10 #6).
    let serp: ReturnType<typeof serpFetchFor> | null = null;
    const unavailable = (status: number, extra: Record<string, unknown> = {}) =>
      jsonResponse(flightStatusUnavailableBody(serp?.trace.paused ?? null, { flight, date, ...extra }), status);
    if (SERPAPI_PRIVATE_KEY && flight) {
      try {
        // Caché compartida de 10 min: dos personas en el mismo vuelo pagan una sola búsqueda.
        serp = serpFetchFor("flight-status", __user.id);
        const result = await querySerpApi(SERPAPI_PRIVATE_KEY, flight, date, route ?? undefined, { fetch: serp.fetch });
        if (result) return jsonResponse({ flight, date, route, ...result });
      } catch {
        console.warn('flight-status: SerpApi unavailable; attempting optional fallback');
      }
    }
    if (!PERPLEXITY_API_KEY) {
      return unavailable(503, { message: 'No hay datos verificables para ese vuelo y fecha.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const q = `Estado en tiempo real del vuelo ${flight ?? ''} ${route ? `(${route})` : ''} ${date ?? today}. Responde SOLO JSON válido con campos: status ("a tiempo"|"retrasado"|"cancelado"|"abordando"|"en vuelo"|"aterrizado"|"desconocido"), scheduled_departure (HH:MM local), estimated_departure (HH:MM local), gate, terminal, origin (IATA), destination (IATA), aircraft, delay_minutes (número), source (URL). Si no encuentras datos confiables, status="desconocido".`;

    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'Eres un asistente que consulta estado de vuelos en sitios oficiales (FlightAware, FlightRadar24, aerolínea, aeropuerto). Devuelves SOLO JSON, sin texto extra.' },
          { role: 'user', content: q },
        ],
        temperature: 0.1,
        max_tokens: 600,
        return_related_questions: false,
      }),
      signal: AbortSignal.timeout(20000),

    });
    const j = await r.json();
    if (!r.ok) {
      const errMsg = j?.error?.message || j?.error || `Perplexity ${r.status}`;
      console.warn('flight-status: Perplexity unavailable', r.status);
      return unavailable(502);
    }
    const content: string = j?.choices?.[0]?.message?.content ?? '';
    const citations: string[] = j?.citations ?? [];

    // Intentar extraer JSON del contenido
    let parsed: any = null;
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }
    if (!parsed || parsed.status === 'desconocido' || !citations.length) {
      return unavailable(503);
    }

    return new Response(JSON.stringify({
      flight, date: date ?? today, route,
      data: { ...parsed, fuente: 'perplexity' }, provider: 'perplexity',
      raw: content,
      citations,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    return jsonResponse({ error: 'flight_status_unavailable' }, 502);
  }
});
