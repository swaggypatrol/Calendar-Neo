import { afterEach, describe, expect, it, vi } from 'vitest';
import { SLOTS, fieldDate, firstMonthShowing, keyOf, monthKeys, monthPairTitle, monthSlots, pairLayout } from '../src/single/keypad';

describe('monthSlots', () => {
  it('lays October 2026 out from Sunday: the 1st is a Thursday', () => {
    const s = monthSlots(2026, 9, 0);
    expect(s).toHaveLength(SLOTS);
    expect(s.slice(0, 5)).toEqual([null, null, null, null, 1]);
    expect(s.indexOf(31)).toBe(34);
    expect(s.slice(35).every((d) => d === null)).toBe(true);
  });

  it('shifts by one when weeks start on Monday', () => {
    expect(monthSlots(2026, 9, 1).indexOf(1)).toBe(3);
  });

  it('always keeps six rows, even for a month that fits in four', () => {
    // February 2026 starts on a Sunday and has 28 days
    const s = monthSlots(2026, 1, 0);
    expect(s).toHaveLength(42);
    expect(s[0]).toBe(1);
    expect(s[27]).toBe(28);
    expect(s[28]).toBeNull();
  });

  it('pads keys', () => {
    expect(keyOf(2026, 0, 5)).toBe('2026-01-05');
  });
});

describe('monthKeys', () => {
  const oct2026 = 2026 * 12 + 9;

  it('holds down the month on the day keys and marks this month', () => {
    const keys = monthKeys(2026, oct2026 + 2, oct2026);
    expect(keys).toHaveLength(12);
    expect(keys.filter((k) => k.latched).map((k) => k.index)).toEqual([oct2026 + 2]);
    expect(keys.filter((k) => k.current).map((k) => k.index)).toEqual([oct2026]);
    expect(keys.filter((k) => k.past)).toHaveLength(9);
  });

  it('locks the months wholly outside min / max', () => {
    // From today (October 2026) up to some day in February 2027
    const keys = monthKeys(2027, oct2026, oct2026, oct2026, 2027 * 12 + 1);
    expect(keys.map((k) => k.off)).toEqual([false, false, ...Array(10).fill(true)]);
    expect(keys.some((k) => k.latched || k.current)).toBe(false);
  });
});

describe('fieldDate', () => {
  const now = new Date(2026, 9, 3);

  it('prints a date this year as a booking field does', () => {
    expect(fieldDate('2026-10-27', 'en-US', now)).toBe('Oct 27');
    expect(fieldDate('2026-10-27', 'ja-JP', now)).toBe('10月27日');
    expect(fieldDate('2026-10-27', 'zh-CN', now)).toBe('10月27日');
  });

  it('adds the year only when it is not this one', () => {
    expect(fieldDate('2027-01-05', 'en-US', now)).toBe('Jan 5, 2027');
    expect(fieldDate('2027-01-05', 'ja-JP', now)).toBe('2027年1月5日');
  });
});

describe('two months', () => {
  it('stand one above the other on a tall screen and side by side on a wide one, as the picker lays out its book', () => {
    expect(pairLayout(390, 844)).toBe('stack');
    expect(pairLayout(844, 390)).toBe('side');
    expect(pairLayout(1440, 900)).toBe('side');
    // A square screen is not taller than it is wide
    expect(pairLayout(800, 800)).toBe('side');
  });

  it('move as little as possible to bring a month on: none when it is shown, back to it, or on to it as the last', () => {
    const oct = 2026 * 12 + 9;
    expect(firstMonthShowing(oct, oct, 2)).toBe(oct);
    expect(firstMonthShowing(oct + 1, oct, 2)).toBe(oct);
    expect(firstMonthShowing(oct + 2, oct, 2)).toBe(oct + 1);
    expect(firstMonthShowing(oct - 1, oct, 2)).toBe(oct - 1);
    // One month: the month itself, as before
    expect(firstMonthShowing(oct + 1, oct, 1)).toBe(oct + 1);
    expect(firstMonthShowing(oct - 3, oct, 1)).toBe(oct - 3);
  });
});

describe('the title over two months', () => {
  const oct = new Date(2026, 9, 1);
  const dec = new Date(2026, 11, 1);
  const cases: Array<[string, string, string, string]> = [
    ['zh-CN', '至', '2026年10月至11月', '2026年12月至2027年1月'],
    ['ja-JP', ' – ', '2026年10月 – 11月', '2026年12月 – 2027年1月'],
    ['en-US', ' – ', 'Oct – Nov 2026', 'Dec 2026 – Jan 2027'],
  ];
  // (a language's own range may set thin spaces round the dash)
  const plain = (s: string) => s.replace(/\s/g, ' ');
  afterEach(() => vi.restoreAllMocks());

  it.each(cases)('%s: one year said once, and both years across a new year', (locale, to, same, across) => {
    expect(plain(monthPairTitle(locale, oct, to))).toBe(same);
    expect(plain(monthPairTitle(locale, dec, to))).toBe(across);
  });

  it.each(cases)('%s: the same where the language range gives only numbers, as in newer browsers', (locale, to, same, across) => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatRange').mockReturnValue('2026/10 – 2026/11');
    expect(monthPairTitle(locale, oct, to)).toBe(same);
    expect(monthPairTitle(locale, dec, to)).toBe(across);
  });
});
