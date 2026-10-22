import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { it, expect, describe } from "vitest";
import { BackButton } from "@/components/BackButton";
import { backFallback, hasInAppHistory, isTabRoot } from "@/lib/backNavigation";

let loc = "";
const Spy = () => { loc = useLocation().pathname; return null; };
const Screen = ({ name }: { name: string }) => <><p>{name}</p><BackButton /></>;

const renderAt = (entries: string[], index = entries.length - 1) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Spy />
      <Routes>
        <Route path="/dashboard" element={<Screen name="INICIO" />} />
        <Route path="/dashboard/viajes" element={<Screen name="MIS VIAJES" />} />
        <Route path="/dashboard/viajes/:id" element={<Screen name="VIAJE" />} />
        <Route path="/dashboard/viajes/:id/split" element={<Screen name="SPLIT" />} />
        <Route path="/dashboard/comparar" element={<Screen name="COMPARAR" />} />
      </Routes>
    </MemoryRouter>,
  );

it("entrada directa (sin historial de la app): 'Volver' va a la pantalla padre, no fuera de IATOS", () => {
  renderAt(["/dashboard/viajes/t1/split"]);
  fireEvent.click(screen.getByRole("button", { name: "Volver" }));
  expect(loc).toBe("/dashboard/viajes/t1");
  expect(screen.getByText("VIAJE")).toBeInTheDocument();
});

it("con historial de la app: 'Volver' regresa a la pantalla anterior", () => {
  renderAt(["/dashboard/comparar", "/dashboard/viajes/t1"]);
  fireEvent.click(screen.getByRole("button", { name: "Volver" }));
  expect(loc).toBe("/dashboard/comparar");
});

it("las pestañas raíz no muestran 'Volver'", () => {
  renderAt(["/dashboard/viajes"]);
  expect(screen.getByText("MIS VIAJES")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Volver" })).toBeNull();
});

describe("backNavigation", () => {
  it("backFallback", () => {
    expect(backFallback("/dashboard/viajes/abc/diario")).toBe("/dashboard/viajes/abc");
    expect(backFallback("/dashboard/viajes/abc")).toBe("/dashboard/viajes");
    expect(backFallback("/dashboard/comparar")).toBe("/dashboard");
    expect(backFallback("/onboarding/deep")).toBe("/dashboard/perfil");
  });
  it("hasInAppHistory usa el índice de React Router y, sin él, la key", () => {
    expect(hasInAppHistory("x1", { idx: 0 })).toBe(false);
    expect(hasInAppHistory("x1", { idx: 3 })).toBe(true);
    expect(hasInAppHistory("default", null)).toBe(false);
    expect(hasInAppHistory("k8a", null)).toBe(true);
  });
  it("isTabRoot", () => {
    expect(isTabRoot("/dashboard/viajes/")).toBe(true);
    expect(isTabRoot("/dashboard/comparar")).toBe(false);
  });
});
