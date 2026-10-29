// Respuesta de buscar-video al pasar el límite: 200 "sin video" + retry_after (segundos), sin 429.
// Pura para probarla en Vitest.
export function videoRateLimited(retryAfter: number, corsHeaders: Record<string, string> = {}): Response {
  const secs = Math.max(1, Math.round(Number(retryAfter) || 60));
  return new Response(JSON.stringify({ url: null, poster: null, rate_limited: true, retry_after: secs }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(secs), "Cache-Control": "no-store" },
  });
}
