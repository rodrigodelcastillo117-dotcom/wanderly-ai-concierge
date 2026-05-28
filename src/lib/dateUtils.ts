export const parseDateOnly = (value?: string | null): Date | null => {
  if (!value) return null;
  const [datePart] = String(value).split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

export const formatDateOnly = (
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {},
  locale = "es-MX",
): string => {
  const date = parseDateOnly(value);
  if (!date) return "—";
  return date.toLocaleDateString(locale, options);
};

export const diffDateOnlyDays = (start?: string | null, end?: string | null): number => {
  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
  if (!s || !e) return 0;
  const startUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  const endUtc = Date.UTC(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.round((endUtc - startUtc) / 86400000);
};
