// Dates are where this kind of system goes wrong: the client sends a local
// time, MySQL stores it at +08:00, and the trend view buckets by day. If each
// of those three parses on its own rules you get events that happen on the
// 24th while the trend chart is missing a day. So one parser on the way in,
// one formatter on the way out, one key format for day buckets.

const NAIVE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// The fractional-seconds part has to be a capturing group. Written as
// (?:\.\d{1,3})? there is no group 7 to destructure, so the milliseconds
// always come back as the default 0 and get dropped on the floor.
const NAIVE_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** Parse an input into a Date, or null when it isn't a date.
 *
 *  Accepts a Date instance, ISO 8601 with or without a zone, and the
 *  "YYYY-MM-DD HH:mm:ss" / "YYYY-MM-DD" forms.
 *
 *  Not just `new Date(value)`: for a string without a zone the behaviour
 *  differs between spec revisions (some read it as UTC, some as local).
 *  Splitting the parts and building the date explicitly makes it local and
 *  predictable. Strings that do carry a zone still go to the native parser,
 *  because there the standard is unambiguous. */
export const parseDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const dateOnly = NAIVE_DATE_RE.exec(trimmed);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
  }

  const naive = NAIVE_DATETIME_RE.exec(trimmed);
  if (naive) {
    const [, y, mo, d, h, mi, s = '0', ms = '0'] = naive;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
      Number(ms),
    );
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Always emit UTC ISO, and let the client render it in Asia/Singapore.
 *  The API never has to answer "which timezone is that?". */
export const toIsoString = (date: Date): string => date.toISOString();

/** Midnight of the given day, local time. Day buckets have to line up with
 *  the calendar day or two requests for the same event can land in different
 *  buckets because of a millisecond. */
export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

/** Add days without touching the input.
 *  setDate instead of adding 86_400_000 ms, because the day of a DST switch
 *  isn't 24 hours long. Singapore has no DST, but this way the code doesn't
 *  depend on "local time is always UTC+8". */
export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/** Local "YYYY-MM-DD" key used to bucket the trend.
 *  Not toISOString().slice(0, 10) - that converts to UTC, so a registration
 *  between midnight and 8am would land on the previous day. */
export const formatDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
