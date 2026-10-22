// Enlaces a proveedores en la misma pestaña sacaban al usuario de IATOS y, dentro de un marco,
// Kiwi.com (vía Aviasales) mostraba "rechazó la conexión".
import { describe, expect, it } from "vitest";
import { installExternalLinkHandler, shouldOpenInNewTab } from "@/lib/externalLinks";

const ORIGIN = "https://traveliatos.life";
const a = (href: string, attrs: Record<string, string> = {}) => {
  const el = document.createElement("a");
  el.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

describe("enlaces externos en pestaña nueva", () => {
  it("decide bien qué enlaces abrir aparte", () => {
    expect(shouldOpenInNewTab(a("https://www.aviasales.com/search/MEX1012CUN1"), ORIGIN)).toBe(true);
    expect(shouldOpenInNewTab(a("/dashboard/viajes"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("https://traveliatos.life/prive"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("tel:+525555555555"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("mailto:hola@traveliatos.life"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("#seccion"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("https://wa.me/525555", { target: "_self" }), ORIGIN)).toBe(false);
  });

  it("al hacer clic agrega target=_blank y rel noopener a un enlace externo sin target", () => {
    const off = installExternalLinkHandler(document, ORIGIN);
    const link = a("https://www.kiwi.com/");
    const span = document.createElement("span");
    link.appendChild(span);
    document.body.appendChild(link);
    link.addEventListener("click", (e) => e.preventDefault()); // jsdom no navega
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.rel).toContain("noreferrer");
    const internal = a("/dashboard");
    document.body.appendChild(internal);
    internal.addEventListener("click", (e) => e.preventDefault());
    internal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(internal.target).toBe("");
    off();
  });

  // Cierre de auditoría (AUD-04, docs/iatos/cierre/BRIDGE.md): reverse tabnabbing.
  it("un enlace externo que ya traía target=_blank sin rel también recibe noopener (navegadores viejos)", () => {
    const off = installExternalLinkHandler(document, ORIGIN);
    const link = a("https://www.booking.com/", { target: "_blank" });
    document.body.appendChild(link);
    link.addEventListener("click", (e) => e.preventDefault());
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(link.rel).toContain("noopener");
    // Uno interno con target=_blank no se toca (IATOS en otra pestaña puede usar window.opener).
    const internal = a("/dashboard/reservas", { target: "_blank" });
    document.body.appendChild(internal);
    internal.addEventListener("click", (e) => e.preventDefault());
    internal.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(internal.rel).toBe("");
    off();
  });
  it("no abre aparte esquemas peligrosos ni enlaces que la app quiere en la misma pestaña", () => {
    expect(shouldOpenInNewTab(a("javascript:alert(1)"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("data:text/html,hi"), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("https://www.booking.com/", { target: "_self" }), ORIGIN)).toBe(false);
    expect(shouldOpenInNewTab(a("https://x.supabase.co/storage/v1/object/sign/doc.pdf", { download: "" }), ORIGIN)).toBe(false);
  });
});
