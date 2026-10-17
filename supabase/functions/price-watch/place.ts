// Trip places are free text ("Tokio, Japón", "Roma → Florencia → Venecia").
// The flight watch tracks the outbound leg, so keep the first city only.
export function primaryPlace(raw: string | null | undefined): string {
  return (raw ?? "").split(/→|->|,|;|\||\//)[0].trim();
}
