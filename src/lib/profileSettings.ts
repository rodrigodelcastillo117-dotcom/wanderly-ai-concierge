// Perfil → Ajustes. El engrane del encabezado lleva a /dashboard/perfil#ajustes (auditoría de cuenta #18).
export const PROFILE_SETTINGS_ID = "ajustes";
export const PROFILE_SETTINGS_PATH = `/dashboard/perfil#${PROFILE_SETTINGS_ID}`;

/** "Actualizado hoy / ayer / hace N días" (antes decía "hace 0 días", auditoría de cuenta #16). */
export function dnaUpdatedLabel(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "Actualizado hoy";
  if (days === 1) return "Actualizado ayer";
  return `Actualizado hace ${Math.floor(days)} días`;
}
