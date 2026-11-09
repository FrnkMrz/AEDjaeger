import { isCalendarDate } from "../../src/domain/localDate";

/**
 * An observation can describe an older photo, so the write API must not limit
 * its age. Reject future dates, while allowing up to UTC+14 so a user in the
 * world's earliest time zone can still submit their local date.
 */
export function isAcceptableObservationDate(value: unknown, now: number): value is string {
  if (!isCalendarDate(value)) return false;
  const latestLocalDate = new Date(now + 14 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  return value <= latestLocalDate;
}
