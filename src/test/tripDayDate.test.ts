import { describe, expect, it } from "vitest";
import { tripDayDate } from "@/lib/tripDayDate";

describe("fecha de cada día del itinerario", () => {
  it("formatea sin correrse de día por la zona horaria", () => {
    expect(tripDayDate("2027-03-10")).toBe("mié 10 mar");
    expect(tripDayDate("2027-03-11")).toBe("jue 11 mar");
    expect(tripDayDate("2026-11-23")).toBe("lun 23 nov");
  });
  it("viajes viejos sin fecha o con fecha inválida no muestran nada", () => {
    expect(tripDayDate(undefined)).toBeNull();
    expect(tripDayDate("10 de marzo")).toBeNull();
    expect(tripDayDate("2027-02-30")).toBeNull();
  });
});
