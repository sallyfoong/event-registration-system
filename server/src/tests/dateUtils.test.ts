/** Unit tests for the pure date helpers. These cover the parsing branches that
 *  the API-level tests do not exercise (empty strings, non-strings, native Date
 *  objects, fractional seconds, offset-aware ISO strings, ...). */

import { addDays, formatDateKey, parseDate, startOfDay, toIsoString } from '../utils/date';

describe('parseDate', () => {
  it('returns a Date instance untouched when it is valid', () => {
    const d = new Date('2026-03-01T10:00:00.000Z');
    expect(parseDate(d)).toBe(d);
  });

  it('returns null for an invalid Date instance', () => {
    expect(parseDate(new Date('not-a-date'))).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [['2026-01-01']]])(
    'returns null for non-string input (%p)',
    (value) => {
      expect(parseDate(value)).toBeNull();
    },
  );

  it('returns null for an empty or whitespace-only string', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('    ')).toBeNull();
  });

  it('parses "YYYY-MM-DD" as local midnight', () => {
    const parsed = parseDate('2026-03-04');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(2);
    expect(parsed!.getDate()).toBe(4);
    expect(parsed!.getHours()).toBe(0);
  });

  it('parses "YYYY-MM-DD HH:mm:ss" using local time', () => {
    const parsed = parseDate('2026-03-04 14:30:45')!;
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(30);
    expect(parsed.getSeconds()).toBe(45);
  });

  it('parses "YYYY-MM-DDTHH:mm" and "T HH:mm:ss.mmm" variants', () => {
    expect(parseDate('2026-03-04T14:30')!.getMinutes()).toBe(30);
    const withMs = parseDate('2026-03-04T14:30:45.123')!;
    expect(withMs.getSeconds()).toBe(45);
    expect(withMs.getMilliseconds()).toBe(123);
  });

  it('falls back to the native parser for offset-aware ISO strings', () => {
    const parsed = parseDate('2026-03-04T14:30:45+08:00');
    expect(parsed).not.toBeNull();
    expect(toIsoString(parsed!)).toBe('2026-03-04T06:30:45.000Z');
  });

  it('returns null for an unparseable string', () => {
    expect(parseDate('next tuesday')).toBeNull();
  });
});

describe('date maths', () => {
  it('startOfDay zeroes the time component', () => {
    const sod = startOfDay(new Date(2026, 2, 4, 23, 59, 59, 999));
    expect(sod.getHours()).toBe(0);
    expect(sod.getMinutes()).toBe(0);
    expect(sod.getSeconds()).toBe(0);
    expect(sod.getMilliseconds()).toBe(0);
  });

  it('addDays moves across a month boundary without mutating the input', () => {
    const original = new Date(2026, 1, 28, 12, 0, 0);
    const next = addDays(original, 3);
    expect(next.getMonth()).toBe(2);
    expect(next.getDate()).toBe(3);
    expect(original.getDate()).toBe(28);
  });

  it('addDays accepts a negative offset', () => {
    expect(addDays(new Date(2026, 2, 4), -1).getDate()).toBe(3);
  });

  it('formatDateKey zero-pads month and day', () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('formatDateKey uses local time, so a Singapore-midnight registration stays on its own day', () => {
    // 00:30 on 5 Jan local is still 4 Jan in UTC. The trend bucket must not shift back a day.
    const localEarlyMorning = new Date(2026, 0, 5, 0, 30, 0);
    expect(formatDateKey(localEarlyMorning)).toBe('2026-01-05');
  });
});
