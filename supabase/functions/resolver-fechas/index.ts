// supabase/functions/resolver-fechas/index.ts
// Smart Date Resolution: detecta si el usuario dio fechas explícitas; si no,
// usa Gemini para calcular el mes históricamente más barato/menos masificado
// para el destino y genera una ventana estratégica (segundo martes + 10 días).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Body = {
  destino: string;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  notas_usuario?: string | null;
  trip_length_days?: number | null;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

// Segundo martes de un mes/año dado (UTC para evitar drift de zona horaria).
function secondTuesday(year: number, monthIdx0: number): Date {
  const first = new Date(Date.UTC(year, monthIdx0, 1));
  const day = first.getUTCDay(); // 0=domingo, 2=martes
  const offsetToFirstTuesday = (2 - day + 7) % 7;
  const firstTuesday = new Date(Date.UTC(year, monthIdx0, 1 + offsetToFirstTuesday));
  return new Date(Date.UTC(year, monthIdx0, firstTuesday.getUTCDate() + 7));
}

// Próximo año/mes para un monthIdx0 (0-11) a partir de hoy. Si ya pasó este año, salta al siguiente.
function nextOccurrence(monthIdx0: number, today = new Date()): { year: number; month: number } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  // Si el mes ya pasó o es el actual y ya estamos después del día 7 (no daría margen para segundo martes), salta.
  if (monthIdx0 < m || (monthIdx0 === m && today.getUTCDate() > 7)) {
    return { year: y + 1, month: monthIdx0 };
  }
  return { year: y, month: monthIdx0 };
}

const MONTH_NAMES = [
  "enero","febrero","marzo","abril","mayo","junio",
  "julio","agosto","septiembre","octubre","noviembre","diciembre",
];

function parseMonthName(s: string | undefined | null): number | null {
  if (!s) return null;
  const k = s.toLowerCase().trim();
  const idx = MONTH_NAMES.indexOf(k);
  if (idx >= 0) return idx;
  // English fallback
  const en = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const j = en.indexOf(k);
  return j >= 0 ? j : null;
}

async function geminiOptimalMonth(destino: string, pais?: string | null): Promise<{
  month_idx: number; month_name: string; reason: string;
} | null> {
  if (!LOVABLE_API_KEY) return null;
  const prompt = `Para el destino "${destino}${pais ? ", " + pais : ""}", ¿cuál es el ÚNICO mes calendario del año históricamente más barato Y menos masificado para viajar (sweet spot precio + clima razonable + bajo turismo)? Devuelve SOLO JSON estricto: {"month":"<nombre del mes en español, minúsculas>","reason":"<1-2 frases en español explicando por qué (temporada baja, clima, eventos)>"}. Sin texto extra.`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(AI_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "Eres un experto en estacionalidad turística mundial. Respondes solo JSON válido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    }).finally(() => clearTimeout(tid));
    if (!r.ok) {
      console.error("optimal-month gemini status", r.status, await r.text());
      return null;
    }
    const j = await r.json();
    let raw = (j?.choices?.[0]?.message?.content ?? "").trim();
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* try extract */
      const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]);
    }
    const idx = parseMonthName(parsed?.month);
    if (idx === null) return null;
    return { month_idx: idx, month_name: MONTH_NAMES[idx], reason: String(parsed?.reason ?? "Temporada baja del destino.") };
  } catch (e) {
    console.error("optimal-month err", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const destino = (body.destino ?? "").trim();
    if (!destino) {
      return new Response(JSON.stringify({ error: "destino requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hasOut = !!body.fecha_salida && ISO_RE.test(body.fecha_salida);
    const hasRet = !!body.fecha_regreso && ISO_RE.test(body.fecha_regreso);
    const has_specific_dates = hasOut && hasRet && (body.fecha_regreso! > body.fecha_salida!);

    if (has_specific_dates) {
      return new Response(JSON.stringify({
        has_specific_dates: true,
        fecha_salida: body.fecha_salida,
        fecha_regreso: body.fecha_regreso,
        optimization: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sin fechas → calcula ventana óptima.
    const opt = await geminiOptimalMonth(destino, body.pais_destino ?? null);
    // Fallback determinista si Gemini falla: próximo mes ~60 días al frente.
    let year: number, monthIdx: number, monthName: string, reason: string;
    if (opt) {
      const occ = nextOccurrence(opt.month_idx);
      year = occ.year; monthIdx = occ.month;
      monthName = opt.month_name; reason = opt.reason;
    } else {
      const fallback = new Date();
      fallback.setUTCDate(fallback.getUTCDate() + 60);
      year = fallback.getUTCFullYear(); monthIdx = fallback.getUTCMonth();
      monthName = MONTH_NAMES[monthIdx];
      reason = "No pudimos calcular el mes ideal, usamos una ventana de 60 días con tarifas típicamente más bajas.";
    }

    const tripDays = Math.min(21, Math.max(3, Number(body.trip_length_days) || 10));
    const out = secondTuesday(year, monthIdx);
    const ret = new Date(out);
    ret.setUTCDate(ret.getUTCDate() + tripDays);

    return new Response(JSON.stringify({
      has_specific_dates: false,
      fecha_salida: ymd(out),
      fecha_regreso: ymd(ret),
      optimization: {
        optimal_month: monthName,
        optimal_month_idx: monthIdx,
        year,
        trip_length_days: tripDays,
        reason,
        strategy: "Segundo martes del mes óptimo + ventana de viaje sugerida.",
        generated_at: new Date().toISOString(),
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("resolver-fechas error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
