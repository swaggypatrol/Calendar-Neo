import { describe, expect, it } from 'vitest';
import { SLOTS, fieldDate, keyOf, monthKeys, monthSlots } from '../src/keypad';

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
