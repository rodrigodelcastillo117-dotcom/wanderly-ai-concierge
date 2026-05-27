// Estado de vuelo en vivo usando Perplexity (busca en Google/sitios oficiales en tiempo real)
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { flight, date, route } = await req.json();
    // flight: "AF179" o "AeroMéxico 002". date: "2026-05-28" (opcional). route: "CDMX-CDG" (opcional)
    if (!flight && !route) {
      return new Response(JSON.stringify({ error: 'Falta número de vuelo o ruta' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!PERPLEXITY_API_KEY) {
      return new Response(JSON.stringify({ error: 'Falta PERPLEXITY_API_KEY' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          { role: 'system', content: 'Eres un asistente que consulta estado de vuelos en sitios oficiales (FlightAware, FlightRadar24, aerolínea, aeropuerto). Devuelves SOLO JSON, sin texto extra.' },
          { role: 'user', content: q },
        ],
        temperature: 0.1,
        max_tokens: 600,
        return_related_questions: false,
      }),
    });
    const j = await r.json();
    const content: string = j?.choices?.[0]?.message?.content ?? '';
    const citations: string[] = j?.citations ?? [];

    // Intentar extraer JSON del contenido
    let parsed: any = null;
    const m = content.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }

    return new Response(JSON.stringify({
      flight, date: date ?? today, route,
      data: parsed,
      raw: content,
      citations,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
