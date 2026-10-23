// "Si pongo mexico sin acento no me sale México" (amigo del dueño): los buscadores ignoran acentos.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Command, CommandInput, CommandItem, CommandList, accentInsensitiveFilter } from "@/components/ui/command";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

describe("buscar sin acentos", () => {
  it("el filtro trata igual con y sin acento", () => {
    expect(accentInsensitiveFilter("México", "mexico")).toBeGreaterThan(0);
    expect(accentInsensitiveFilter("Cancún", "CANCUN")).toBeGreaterThan(0);
    expect(accentInsensitiveFilter("Perú", "chile")).toBe(0);
  });

  it("en la lista, escribir 'mexico' muestra México", () => {
    render(
      <Command>
        <CommandInput placeholder="Buscar país…" />
        <CommandList>
          <CommandItem value="México">México</CommandItem>
          <CommandItem value="Perú">Perú</CommandItem>
        </CommandList>
      </Command>,
    );
    fireEvent.change(screen.getByPlaceholderText("Buscar país…"), { target: { value: "mexico" } });
    expect(screen.getByText("México")).toBeInTheDocument();
    expect(screen.queryByText("Perú")).toBeNull();
  });
});
