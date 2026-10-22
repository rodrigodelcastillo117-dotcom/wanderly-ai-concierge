/**
 * Todo enlace a otro sitio (proveedores, mapas, aerolíneas) se abre en una pestaña nueva.
 *
 * Varios enlaces a proveedores no traían target: el usuario salía de IATOS en la misma pestaña y,
 * dentro de un marco (vista previa de Lovable, apps que incrustan la web), proveedores como
 * Kiwi.com —al que redirige Aviasales— se niegan a cargar ("rechazó la conexión"). En vez de
 * corregir enlace por enlace, un solo listener en captura agrega target="_blank" y
 * rel="noopener noreferrer" a los enlaces externos sin target. Los esquemas de un toque (tel:,
 * mailto:, sms:, whatsapp:) y los enlaces internos no se tocan.
 */
export function shouldOpenInNewTab(anchor: HTMLAnchorElement, origin: string): boolean {
  if (anchor.target || anchor.hasAttribute("download")) return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return false;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.origin !== origin;
}

export function installExternalLinkHandler(doc: Document = document, origin: string = window.location.origin): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const el = (e.target as Element | null)?.closest?.("a[href]");
    if (!(el instanceof HTMLAnchorElement)) return;
    if (!shouldOpenInNewTab(el, origin)) return;
    el.target = "_blank";
    const rel = new Set((el.rel || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    el.rel = [...rel].join(" ");
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
