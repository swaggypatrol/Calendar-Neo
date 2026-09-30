import { describe, expect, it } from 'vitest';
import { CELLS, HOLD, HighlighterEngine, type RowLayout } from '../src/engine';

const W = 48;
const H = 42;
const GAP = 4;

/** 5 行 x 7 列的假布局，key 为 "r{row}c{col}"。 */
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

describe('划选', () => {
  it('横着划过三天的中间，三天都被选中，上下排不受影响', () => {
    const e = engine();
    e.beginStroke('highlight', cx(1) - W / 2 + 2, cy(2));
    e.moveTo(cx(3) + W / 2 - 2, cy(2));
    e.endStroke();
    expect(e.value).toEqual(['r2c1', 'r2c2', 'r2c3']);
  });

  it('贴着格子顶边划过不会选中', () => {
    const e = engine();
    e.beginStroke('highlight', cx(0) - W / 2, cy(1) - H * 0.42);
    e.moveTo(cx(4), cy(1) - H * 0.42);
    e.endStroke();
    expect(e.value).toEqual([]);
  });

  it('只划了一小半的日期松手后会被清掉', () => {
    const e = engine();
    e.beginStroke('highlight', cx(0) - W / 2, cy(0));
    e.moveTo(cx(1) - W * 0.2, cy(0));
    expect(painted(e, 'r0c1')).toBeGreaterThan(0);
    e.endStroke();
    expect(e.value).toEqual(['r0c0']);
    expect(painted(e, 'r0c1')).toBe(0);
    expect(painted(e, 'r0c0')).toBe(CELLS);
  });

  it('跨行斜着划，只涂笔尖所在那一行', () => {
    const e = engine();
    e.beginStroke('highlight', cx(2), cy(0));
    e.moveTo(cx(2), cy(3));
    e.endStroke();
    // 竖着划过的格子涂到的只是窄窄一列，不够阈值
    expect(e.value).toEqual([]);
  });

  it('阈值可调', () => {
    const e = engine(10);
    e.beginStroke('highlight', cx(0) - W / 2, cy(0) - H * 0.42);
    e.moveTo(cx(0) + W / 2, cy(0) - H * 0.42);
    e.endStroke();
    expect(e.value).toEqual(['r0c0']);
  });
});

describe('长按扩散', () => {
  it('按在日期中间不动：只填满这一天', () => {
    const e = engine();
    e.beginStroke('highlight', cx(3), cy(1));
    e.startHold(cx(3), cy(1));
    holdFor(e, 5000);
    e.endStroke();
    expect(e.value).toEqual(['r1c3']);
  });

  it('按在两个数字之间：先洇到邻格一半停住，继续按住才选中邻格', () => {
    const e = engine();
    const x = cx(3) + W / 2 - 3; // 靠近右边缘
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

  it('洇到一半就松手：邻格不选中并被清掉', () => {
    const e = engine();
    const x = cx(3) - W / 2 + 3; // 靠近左边缘
    e.beginStroke('highlight', x, cy(1));
    e.startHold(x, cy(1));
    holdUntil(e, 'pause');
    expect(painted(e, 'r1c2')).toBe(CELLS / 2);
    e.endStroke();
    expect(e.value).toEqual(['r1c3']);
    expect(painted(e, 'r1c2')).toBe(0);
  });
});

describe('橡皮擦', () => {
  it('右键划过已选日期会取消选中，逻辑与涂色对称', () => {
    const e = engine();
    e.setSelection(['r0c0', 'r0c1', 'r0c2']);
    e.beginStroke('erase', cx(0) - W / 2, cy(0));
    e.moveTo(cx(1) + W / 2, cy(0));
    e.endStroke();
    expect(e.value).toEqual(['r0c2']);
    expect(painted(e, 'r0c2')).toBe(CELLS);
  });

  it('擦了一点没到阈值，松手后恢复满格', () => {
    const e = engine();
    e.setSelection(['r0c0']);
    e.beginStroke('erase', cx(0) - W / 2, cy(0));
    e.moveTo(cx(0) - W * 0.1, cy(0));
    expect(painted(e, 'r0c0')).toBeLessThan(CELLS);
    e.endStroke();
    expect(painted(e, 'r0c0')).toBe(CELLS);
    expect(e.value).toEqual(['r0c0']);
  });

  it('单击：左键选中、右键取消', () => {
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
