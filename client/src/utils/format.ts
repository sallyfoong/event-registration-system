// The backend returns UTC ISO strings ("2026-11-18T09:47:01.666Z"), which
// are for machines. Humans need a display format.
//
// Why not just new Date(x).toLocaleString()? That renders in whatever
// timezone the browser happens to be in, so the same event shows different
// times for people in different places and looks like a bug. Every
// formatter here pins timeZone to Asia/Singapore - the events happen in
// Singapore, so they display in Singapore time regardless of who's looking.
//
// Why several formatters? The contexts differ:
//   admin tables want compact "2026-05-15 09:00 AM" (scanning 10 columns
//   per row, shorter is better)
//   the public detail view wants "July 15, 2026 at 6:00 PM" (one event on
//   screen, should read naturally)
// Display format follows the context, not one "nicest" format for all.

/** "2026-04-20".
 *  en-CA's date format happens to be ISO YYYY-MM-DD - the shortest way to
 *  get there; hand-padding three segments is longer. */
const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Singapore',
});

/** "09:00 AM". 12-hour clock with two-digit hours for the compact table
 *  columns. */
const time12Formatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Singapore',
});

/** "July 15, 2026", for the public detail view's dates. */
const longDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeZone: 'Asia/Singapore',
});

/** "6:00 PM", combined with longDate into "July 15, 2026 at 6:00 PM".
 *  Not one formatter producing the whole string because Intl has no option
 *  for "long date + short time with ' at ' between" - composing is more
 *  controllable. */
const shortTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeStyle: 'short',
  hour12: true,
  timeZone: 'Asia/Singapore',
});

/** Shared guard: null/undefined and unparseable strings all become an em
 *  dash. "—" beats "Invalid Date" on screen, and keeps React from choking
 *  on a NaN render. */
const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "2026-05-15 09:00 AM", the admin table's event date time column. */
export const formatDateTimeCompact = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  if (!date) return '—';
  return `${isoDateFormatter.format(date)} ${time12Formatter.format(date)}`;
};

/** "2026-04-20", the admin table's created on / registration deadline columns. */
export const formatDateIso = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? isoDateFormatter.format(date) : '—';
};

/** "July 15, 2026", the public detail view. */
export const formatDateLong = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  return date ? longDateFormatter.format(date) : '—';
};

/** "July 15, 2026 at 6:00 PM", the public detail view's event time. */
export const formatDateTimeLong = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  if (!date) return '—';
  return `${longDateFormatter.format(date)} at ${shortTimeFormatter.format(date)}`;
};
