// N-05: las respuestas de Iato mostraban los asteriscos del Markdown. Se interpreta un subconjunto
// seguro, sin HTML crudo y con enlaces solo https.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SafeMarkdown, safeHttpsUrl } from "@/components/concierge/SafeMarkdown";

describe("SafeMarkdown", () => {
  it("negritas, cursivas y saltos de línea sin asteriscos visibles", () => {
    const { container } = render(<SafeMarkdown text={"Lleva **bloqueador** y *sombrero*.\nSegunda línea"} />);
    expect(container.querySelector("strong")?.textContent).toBe("bloqueador");
    expect(container.querySelector("em")?.textContent).toBe("sombrero");
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.textContent).not.toContain("*");
  });

  it("listas con viñetas y numeradas", () => {
    const { container } = render(<SafeMarkdown text={"Tres consejos:\n\n1. Usa **FPS 50**\n2. Hidrátate\n\n- Gorra\n* Lentes"} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("ol strong")?.textContent).toBe("FPS 50");
    expect(container.textContent).not.toMatch(/\*|^- /);
  });

  it("enlaces solo https, en pestaña nueva y sin opener", () => {
    render(<SafeMarkdown text={"Reserva en [Booking](https://www.booking.com/x?a=1)"} />);
    const a = screen.getByRole("link", { name: "Booking" });
    expect(a.getAttribute("href")).toBe("https://www.booking.com/x?a=1");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("XSS: no se crea HTML ni enlaces peligrosos", () => {
    const evil = [
      "<img src=x onerror=alert(1)>",
      "<script>alert(1)</script>",
      "[clic](javascript:alert(1))",
      "[datos](data:text/html,<script>alert(1)</script>)",
      "[inseguro](http://example.com)",
      "**<b onclick=alert(1)>hola</b>**",
    ].join("\n");
    const { container } = render(<SafeMarkdown text={evil} />);
    expect(container.querySelector("img, script, b[onclick], [onerror], [onclick]")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    // El texto se ve literal (escapado por React), no interpretado.
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("clic");
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it("no rompe palabras con guion bajo ni asteriscos sueltos", () => {
    const { container } = render(<SafeMarkdown text={"usa mi_codigo_promo y 5 * 3 = 15"} />);
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toBe("usa mi_codigo_promo y 5 * 3 = 15");
  });

  it("safeHttpsUrl acepta solo https", () => {
    expect(safeHttpsUrl("https://a.mx/b")).toBe("https://a.mx/b");
    expect(safeHttpsUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://a.mx")).toBeNull();
    expect(safeHttpsUrl("/relativo")).toBeNull();
  });
});

it("cursiva con guion bajo entre espacios", () => {
  const { container } = render(<SafeMarkdown text={"es _muy_ bonito"} />);
  expect(container.querySelector("em")?.textContent).toBe("muy");
  expect(container.textContent).toBe("es muy bonito");
});
