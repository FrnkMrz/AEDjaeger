/** Format a date using the device's local calendar, which is what EXIF dates and date inputs use. */
export function localCalendarDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Validate a date-only value without converting it through the device timezone. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Observation dates may be earlier than today, but cannot be in the device's local future. */
export function isValidObservedDate(value: string, now: Date = new Date()): boolean {
  return isCalendarDate(value) && value <= localCalendarDate(now);
}
