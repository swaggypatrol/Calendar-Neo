/**
 * Pure helpers for <retro-calendar> and <retro-picker>: the 6 × 7 key layout of a month, the twelve keys of the month
 * pad, and how the date field prints a date. Kept free of the DOM so they can be unit tested.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a local year, 0-based month and day. */
export const keyOf = (y: number, m0: number, d: number): string => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

/** Number of key slots on the pad: always six rows, so the pad never changes height between months. */
export const SLOTS = 42;

/** The day of the month on each of the 42 keys (null for a blank key), weeks starting on weekStart (0 Sunday). */
export function monthSlots(year: number, month0: number, weekStart = 0): (number | null)[] {
  const offset = (new Date(year, month0, 1).getDay() - weekStart + 7) % 7;
  const days = new Date(year, month0 + 1, 0).getDate();
  return Array.from({ length: SLOTS }, (_, i) => {
    const d = i - offset + 1;
    return d >= 1 && d <= days ? d : null;
  });
}

/** One key of the month pad. Months are counted as year * 12 + month (0-based), as everywhere else here. */
export interface MonthKey {
  index: number;
  /** The month the day keys are showing: its key is the one down. */
  latched: boolean;
  /** This month, marked with a lamp. */
  current: boolean;
  /** Before this month, printed grey. */
  past: boolean;
  /** Wholly outside min / max, so locked. */
  off: boolean;
}

/** The twelve keys of the month pad for a year, given the month on the day keys, this month and the allowed range. */
export function monthKeys(year: number, shown: number, current: number, min = -Infinity, max = Infinity): MonthKey[] {
  return Array.from({ length: 12 }, (_, m) => {
    const index = year * 12 + m;
    return { index, latched: index === shown, current: index === current, past: index < current, off: index < min || index > max };
  });
}

/**
 * A date the way a booking site's date field prints it: "Oct 27" in English, "10月27日" in Chinese and Japanese (their
 * own month and day characters), with the year added only when it isn't this year.
 */
export function fieldDate(key: string, locale?: string, now = new Date()): string {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  const lang = (locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).toLowerCase();
  const month = /^(zh|ja|ko)/.test(lang) ? 'long' : 'short';
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear() ? { month, day: 'numeric' } : { year: 'numeric', month, day: 'numeric' };
  return new Intl.DateTimeFormat(locale, opts).format(d);
}
