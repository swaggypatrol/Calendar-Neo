/**
 * Pure helpers for <retro-calendar>: the 6 × 7 key layout of a month and the seven-segment patterns its filament
 * display lights. Kept free of the DOM so they can be unit tested.
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

/**
 * Seven-segment patterns, segments in the usual order a b c d e f g:
 *
 *    aaa
 *   f   b
 *    ggg
 *   e   c
 *    ddd
 */
export const DIGITS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

/** The eight characters the display shows for a date (YYYYMMDD), or dashes when nothing is chosen. */
export function displayChars(value: string | null): string[] {
  return (value ? value.replace(/-/g, '') : '--------').split('');
}
