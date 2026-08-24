// Reporte de errores de edge functions a Sentry (opcional).
// Configura el secret SENTRY_DSN en Project Settings → Secrets para activarlo.
// Si no está configurado, no hace nada (nunca rompe la función).

const DSN = Deno.env.get("SENTRY_DSN") ?? "";

type Parsed = { host: string; projectId: string; publicKey: string } | null;

function parseDsn(dsn: string): Parsed {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!projectId || !u.username) return null;
    return { host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

const parsed = parseDsn(DSN);

export async function reportError(
  err: unknown,
  context: { fn: string; userId?: string | null; extra?: Record<string, unknown> },
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${context.fn}]`, message);
  if (!parsed) return;

  try {
    const body = JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "error",
      server_name: context.fn,
      tags: { edge_function: context.fn },
      user: context.userId ? { id: context.userId } : undefined,
      extra: context.extra,
      exception: {
        values: [
          {
            type: err instanceof Error ? err.name : "Error",
            value: message,
            stacktrace: err instanceof Error && err.stack ? { frames: [] } : undefined,
          },
        ],
      },
    });

    await fetch(`https://${parsed.host}/api/${parsed.projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=iatos-edge/1.0, sentry_key=${parsed.publicKey}`,
      },
      body,
    });
  } catch (e) {
    console.error("sentry report failed:", (e as Error).message);
  }
}
