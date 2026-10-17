import { describe, expect, it } from "vitest";
import { confirmedDeletion } from "../../supabase/functions/delete-account/validation";

describe("account deletion confirmation", () => {
  it("requires both explicit confirmations", () => {
    expect(confirmedDeletion({ confirm: true, confirmation: "ELIMINAR" })).toBe(true);
    expect(confirmedDeletion({ confirm: true })).toBe(false);
    expect(confirmedDeletion({ confirmation: "ELIMINAR" })).toBe(false);
    expect(confirmedDeletion({ confirm: false, confirmation: "ELIMINAR" })).toBe(false);
  });
  it("rejects attempts to target another user's account", () => {
    expect(confirmedDeletion({ confirm: true, confirmation: "ELIMINAR", user_id: "other-user" })).toBe(false);
  });
});