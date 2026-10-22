// Compatibilidad: estos nombres se usan en varias pantallas. La implementación vive en
// src/lib/localDate.ts (una sola regla para leer fechas de calendario como fechas locales).
export {
  parseLocalDate as parseDateOnly,
  formatLocalDate as formatDateOnly,
  diffLocalDays as diffDateOnlyDays,
} from "@/lib/localDate";
