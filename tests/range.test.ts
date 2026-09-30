import { describe, expect, it } from 'vitest';
import { HighlighterEngine, type RowLayout } from '../src/engine';
import { DayRange, resolveDay } from '../src/range';

const W = 48;
const H = 42;
const GAP = 4;

/** One row of 7 days: 2026-09-27 … 2026-10-03. */
function row(): RowLayout[] {
  const keys = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
  return [
    {
      top: 0,
      bottom: H,
      days: keys.map((key, c) => ({ key, slot: c, left: c * (W + GAP), top: 0, right: c * (W + GAP) + W, bottom: H })),
    },
  ];
}

const cx = (c: number) => c * (W + GAP) + W / 2;
const NOW = new Date(2026, 8, 30, 15, 0);

function booking(min = 'today') {
  const range = new DayRange();
  range.set('min', min);
  range.refresh(NOW);
  const e = new HighlighterEngine();
  e.isDisabled = (k) => !range.allows(k);
  e.setLayout(row());
  return e;
}

describe('range bound syntax', () => {
  it('today / tomorrow / +N / date', () => {
    expect(resolveDay('today', NOW)).toBe('2026-09-30');
    expect(resolveDay('tomorrow', NOW)).toBe('2026-10-01');
    expect(resolveDay('+90', NOW)).toBe('2026-12-29');
    expect(resolveDay('2026-1-5', NOW)).toBe('2026-01-05');
    expect(resolveDay('gibberish', NOW)).toBeNull();
    expect(resolveDay(null, NOW)).toBeNull();
  });
});

describe('booking: only today onwards', () => {
  it('a stroke from the past into the future selects only today and later', () => {
    const e = booking();
    e.beginStroke('highlight', cx(0) - W / 2 + 2, H / 2);
    e.moveTo(cx(6) + W / 2 - 2, H / 2);
    e.endStroke();
    expect(e.value).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('with min=tomorrow, today cannot be selected either', () => {
    const e = booking('tomorrow');
    e.beginStroke('highlight', cx(3), H / 2);
    expect(e.tap(cx(3), H / 2)).toBe(false);
    e.endStroke();
    expect(e.value).toEqual([]);
  });

  it('neither taps nor direct setting can select past days', () => {
    const e = booking();
    e.beginStroke('highlight', cx(1), H / 2);
    e.tap(cx(1), H / 2);
    e.endStroke();
    e.setDay('2026-09-29', true);
    e.setSelection(['2026-09-01', '2026-10-02']);
    expect(e.value).toEqual(['2026-10-02']);
  });

  it('holding on a past day does not spread; holding on today near yesterday does not bleed into yesterday', () => {
    const e = booking();
    e.beginStroke('highlight', cx(1), H / 2);
    e.startHold(cx(1), H / 2);
    expect(e.holding).toBe(false);
    e.endStroke();

    e.beginStroke('highlight', cx(3) - W / 2 + 3, H / 2);
    e.startHold(cx(3) - W / 2 + 3, H / 2);
    for (let t = 0; t < 8000 && e.holdPhase !== 'done'; t += 16) e.tick(16);
    e.endStroke();
    expect(e.value).toEqual(['2026-09-30']);
  });
});
