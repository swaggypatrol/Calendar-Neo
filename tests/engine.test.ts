import { describe, expect, it } from 'vitest';
import { CELLS, HOLD, HighlighterEngine, type RowLayout } from '../src/engine';

const W = 48;
const H = 42;
const GAP = 4;

/** Fake 5-row x 7-column layout; keys are "r{row}c{col}". */
function layout(): RowLayout[] {
  const rows: RowLayout[] = [];
  for (let r = 0; r < 5; r++) {
    const top = r * (H + GAP);
    rows.push({
      top,
      bottom: top + H,
      days: Array.from({ length: 7 }, (_, c) => ({
        key: `r${r}c${c}`,
        slot: c,
        left: c * (W + GAP),
        top,
        right: c * (W + GAP) + W,
        bottom: top + H,
      })),
    });
  }
  return rows;
}

const cx = (c: number) => c * (W + GAP) + W / 2;
const cy = (r: number) => r * (H + GAP) + H / 2;

function engine(threshold = 35) {
  const e = new HighlighterEngine();
  e.threshold = threshold;
  e.setLayout(layout());
  return e;
}

function holdFor(e: HighlighterEngine, ms: number) {
  for (let t = 0; t < ms; t += 16) e.tick(16);
}

function holdUntil(e: HighlighterEngine, phase: string) {
  for (let t = 0; t < 10000 && e.holdPhase !== phase; t += 16) e.tick(16);
  expect(e.holdPhase).toBe(phase);
}

const painted = (e: HighlighterEngine, key: string) => e.state(key)!.mask.reduce((a, b) => a + b, 0);

describe('stroke selection', () => {
  it('sweeping horizontally across the middle of three days selects all three and leaves adjacent rows alone', () => {
    const e = engine();
    e.beginStroke('highlight', cx(1) - W / 2 + 2, cy(2));
    e.moveTo(cx(3) + W / 2 - 2, cy(2));
    e.endStroke();
    expect(e.value).toEqual(['r2c1', 'r2c2', 'r2c3']);
  });

  it('a stroke grazing the top edge of the cells selects nothing', () => {
    const e = engine();
    e.beginStroke('highlight', cx(0) - W / 2, cy(1) - H * 0.42);
    e.moveTo(cx(4), cy(1) - H * 0.42);
    e.endStroke();
    expect(e.value).toEqual([]);
  });

  it('a day only partly painted is cleared on release', () => {
    const e = engine();
    e.beginStroke('highlight', cx(0) - W / 2, cy(0));
    e.moveTo(cx(1) - W * 0.2, cy(0));
    expect(painted(e, 'r0c1')).toBeGreaterThan(0);
    e.endStroke();
    expect(e.value).toEqual(['r0c0']);
    expect(painted(e, 'r0c1')).toBe(0);
    expect(painted(e, 'r0c0')).toBe(CELLS);
  });

  it('a stroke crossing rows only paints the row under the brush', () => {
    const e = engine();
    e.beginStroke('highlight', cx(2), cy(0));
    e.moveTo(cx(2), cy(3));
    e.endStroke();
    // A vertical pass only paints a narrow column in each cell, below the threshold
    expect(e.value).toEqual([]);
  });

  it('threshold is adjustable', () => {
    const e = engine(10);
    e.beginStroke('highlight', cx(0) - W / 2, cy(0) - H * 0.42);
    e.moveTo(cx(0) + W / 2, cy(0) - H * 0.42);
    e.endStroke();
    expect(e.value).toEqual(['r0c0']);
  });
});

describe('hold to spread', () => {
  it('holding in the middle of a day fills only that day', () => {
    const e = engine();
    e.beginStroke('highlight', cx(3), cy(1));
    e.startHold(cx(3), cy(1));
    holdFor(e, 5000);
    e.endStroke();
    expect(e.value).toEqual(['r1c3']);
  });

  it('holding between two numbers bleeds halfway into the neighbour, then selects it if held longer', () => {
    const e = engine();
    const x = cx(3) + W / 2 - 3; // near the right edge
    e.beginStroke('highlight', x, cy(1));
    e.startHold(x, cy(1));
    holdUntil(e, 'pause');
    expect(e.isSelected('r1c3')).toBe(true);
    expect(e.isSelected('r1c4')).toBe(false);
    expect(painted(e, 'r1c4')).toBe(CELLS / 2);
    expect(painted(e, 'r1c2')).toBe(0);

    holdFor(e, HOLD.pause - 50);
    expect(e.isSelected('r1c4')).toBe(false);
    holdUntil(e, 'done');
    expect(e.value).toEqual(['r1c3', 'r1c4']);
    e.endStroke();
    expect(e.value).toEqual(['r1c3', 'r1c4']);
  });

  it('releasing at the halfway point leaves the neighbour unselected and cleared', () => {
    const e = engine();
    const x = cx(3) - W / 2 + 3; // near the left edge
    e.beginStroke('highlight', x, cy(1));
    e.startHold(x, cy(1));
    holdUntil(e, 'pause');
    expect(painted(e, 'r1c2')).toBe(CELLS / 2);
    e.endStroke();
    expect(e.value).toEqual(['r1c3']);
    expect(painted(e, 'r1c2')).toBe(0);
  });
});

describe('eraser', () => {
  it('right-dragging over selected days deselects them, mirroring highlight', () => {
    const e = engine();
    e.setSelection(['r0c0', 'r0c1', 'r0c2']);
    e.beginStroke('erase', cx(0) - W / 2, cy(0));
    e.moveTo(cx(1) + W / 2, cy(0));
    e.endStroke();
    expect(e.value).toEqual(['r0c2']);
    expect(painted(e, 'r0c2')).toBe(CELLS);
  });

  it('erasing below the threshold restores the full cell on release', () => {
    const e = engine();
    e.setSelection(['r0c0']);
    e.beginStroke('erase', cx(0) - W / 2, cy(0));
    e.moveTo(cx(0) - W * 0.1, cy(0));
    expect(painted(e, 'r0c0')).toBeLessThan(CELLS);
    e.endStroke();
    expect(painted(e, 'r0c0')).toBe(CELLS);
    expect(e.value).toEqual(['r0c0']);
  });

  it('tap: left click selects, right click deselects', () => {
    const e = engine();
    e.beginStroke('highlight', cx(5), cy(4));
    expect(e.tap(cx(5), cy(4))).toBe(true);
    e.endStroke();
    expect(e.value).toEqual(['r4c5']);
    e.beginStroke('erase', cx(5), cy(4));
    e.tap(cx(5), cy(4));
    e.endStroke();
    expect(e.value).toEqual([]);
  });
});
