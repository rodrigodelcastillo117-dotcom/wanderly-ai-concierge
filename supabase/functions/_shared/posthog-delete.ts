// Borrado de la persona y sus eventos en PostHog al eliminar la cuenta (ronda sec2-b). Sin Deno:
// la configuración y fetch se inyectan (pruebas en src/test/accountDeletion.test.ts).
// El frontend identifica a la persona con el id interno (identifyUser(user.id)), así que
// distinct_id = id de la cuenta. PostHog procesa el borrado de eventos de forma asíncrona.
// API privada: POST {host}/api/projects/{project_id}/persons/bulk_delete/ con una llave personal
// (POSTHOG_PERSONAL_API_KEY, alcance person:write) y POSTHOG_PROJECT_ID. Sin alguna de las dos el
// paso queda 'pending_key' (paso del dueño) y se reintenta después.

export type PosthogConfig = { personalApiKey?: string | null; projectId?: string | null; host?: string | null };

export async function deletePosthogPerson(
  cfg: PosthogConfig,
  distinctId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"done" | "pending_key"> {
  if (!cfg.personalApiKey || !cfg.projectId) return "pending_key";
  const host = (cfg.host || "https://us.posthog.com").replace(/\/+$/, "");
  const res = await fetchImpl(`${host}/api/projects/${encodeURIComponent(cfg.projectId)}/persons/bulk_delete/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.personalApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ distinct_ids: [distinctId], delete_events: true, delete_recordings: true }),
  });
  // 404 = la persona ya no existe (nunca aceptó analítica o ya se borró): nada que hacer.
  if (res.ok || res.status === 404) return "done";
  throw new Error(`posthog_${res.status}`);
}
