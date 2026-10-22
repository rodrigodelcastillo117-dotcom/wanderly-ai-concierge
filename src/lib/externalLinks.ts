/**
 * Todo enlace a otro sitio (proveedores, mapas, aerolíneas) se abre en una pestaña nueva.
 *
 * Varios enlaces a proveedores no traían target: el usuario salía de IATOS en la misma pestaña y,
 * dentro de un marco (vista previa de Lovable, apps que incrustan la web), proveedores como
 * Kiwi.com —al que redirige Aviasales— se niegan a cargar ("rechazó la conexión"). En vez de
 * corregir enlace por enlace, un solo listener en captura agrega target="_blank" y
 * rel="noopener noreferrer" a los enlaces externos sin target. Los esquemas de un toque (tel:,
 * mailto:, sms:, whatsapp:) y los enlaces internos no se tocan. Un enlace externo que ya traía
 * target="_blank" sin rel recibe noopener (AUD-04, reverse tabnabbing).
 */
/** ¿Es un enlace http(s) a otro origen? */
function isExternalHttp(anchor: HTMLAnchorElement, origin: string): boolean {
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

export function shouldOpenInNewTab(anchor: HTMLAnchorElement, origin: string): boolean {
  if (anchor.target || anchor.hasAttribute("download")) return false;
  return isExternalHttp(anchor, origin);
}

export function installExternalLinkHandler(doc: Document = document, origin: string = window.location.origin): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const el = (e.target as Element | null)?.closest?.("a[href]");
    if (!(el instanceof HTMLAnchorElement)) return;
    const rel = new Set((el.rel || "").split(/\s+/).filter(Boolean));
    // Un enlace externo que ya traía target="_blank" sin rel: se le agrega noopener (reverse
    // tabnabbing en navegadores que no lo implican). No se agrega noreferrer: quien puso el target
    // pudo querer conservar el referer (atribución de afiliados).
    if (el.target === "_blank" && !rel.has("noopener") && !rel.has("noreferrer") && isExternalHttp(el, origin)) {
      rel.add("noopener");
      el.rel = [...rel].join(" ");
      return;
    }
    if (!shouldOpenInNewTab(el, origin)) return;
    el.target = "_blank";
    rel.add("noopener");
    rel.add("noreferrer");
    el.rel = [...rel].join(" ");
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}
