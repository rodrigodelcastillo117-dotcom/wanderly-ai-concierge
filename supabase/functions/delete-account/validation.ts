// Shared validation for the two explicit deletion confirmations.
export function confirmedDeletion(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every(key => key === "confirm" || key === "confirmation")
    && body.confirm === true && body.confirmation === "ELIMINAR";
}