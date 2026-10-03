import { describe, expect, it } from 'vitest';
import { DIGITS, SLOTS, displayChars, keyOf, monthSlots } from '../src/keypad';

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
});

describe('display', () => {
  it('shows the date as eight digits, or dashes when nothing is chosen', () => {
    expect(displayChars('2026-10-14')).toEqual(['2', '0', '2', '6', '1', '0', '1', '4']);
    expect(displayChars(null)).toEqual(Array(8).fill('-'));
  });

  it('has a segment pattern for every character it can show', () => {
    for (const c of '0123456789-') expect(DIGITS[c]).toMatch(/^[a-g]+$/);
    expect(DIGITS['8']).toBe('abcdefg');
  });

  it('pads keys', () => {
    expect(keyOf(2026, 0, 5)).toBe('2026-01-05');
  });
});
