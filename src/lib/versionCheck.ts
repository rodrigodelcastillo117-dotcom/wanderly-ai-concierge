/**
 * Aviso de versión nueva. Una pestaña abierta antes de una publicación sigue mostrando la versión
 * vieja hasta recargar (el dueño vio la guía del primer viaje anterior, sin video, horas después de
 * publicar la nueva). Al volver a la pestaña y cada 10 minutos se compara el bundle principal de
 * index.html con el que está corriendo; si cambió, se ofrece "Actualizar" (nunca se recarga solo,
 * para no perder lo que el usuario esté escribiendo).
 */
const MAIN_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

export function mainBundleOf(html: string): string | null {
  return html.match(MAIN_RE)?.[0] ?? null;
}

export function currentMainBundle(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const m = mainBundleOf(s.getAttribute("src") ?? "");
    if (m) return m;
  }
  return null;
}

export function watchForNewVersion(onNew: () => void, opts: { intervalMs?: number; fetcher?: typeof fetch } = {}): () => void {
  const running = currentMainBundle();
  if (!running) return () => {}; // en desarrollo (vite) no hay bundle con hash
  const f = opts.fetcher ?? fetch;
  let notified = false;
  const check = async () => {
    if (notified || document.visibilityState === "hidden") return;
    try {
      const res = await f(`/?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const latest = mainBundleOf(await res.text());
      if (latest && latest !== running) {
        notified = true;
        onNew();
      }
    } catch {
      /* sin red: se intenta en la siguiente vuelta */
    }
  };
  const timer = window.setInterval(check, opts.intervalMs ?? 10 * 60 * 1000);
  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
