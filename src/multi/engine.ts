/**
 * Highlighter selection engine (pure logic, no DOM, so it is easy to test and port).
 *
 * Each day is divided into GRID x GRID (8x8) cells. The brush paints the cells it
 * passes over; once the painted count reaches `threshold`, the day flips to
 * "selected" and fills completely. The eraser is the exact mirror operation.
 * When a stroke ends (pointer up), days that did not flip revert, so at rest a
 * day is always either "selected = fully painted" or "unselected = blank".
 */

export const GRID = 8;
export const CELLS = GRID * GRID;

export type Tool = 'highlight' | 'erase';

/** Pixel rect of a day cell inside the container. `slot` is its column within the week (0-6). */
export interface DayRect {
  key: string;
  slot: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One row per week; `days` holds only real dates (blank placeholders are omitted). */
export interface RowLayout {
  top: number;
  bottom: number;
  days: DayRect[];
}

export interface DayState {
  rect: DayRect;
  mask: Uint8Array;
  selected: boolean;
}

export interface FlipEvent {
  key: string;
  selected: boolean;
  /** Where the paint starts bleeding from (in cells, 0..GRID); used for animation. */
  originX: number;
  originY: number;
}

/** Horizontal extent (brush-centre x) and average y this stroke covered on a day; used to complete the stroke after release. */
export interface Coverage {
  minX: number;
  maxX: number;
  sumY: number;
  n: number;
}

export const DEFAULT_THRESHOLD = 35;

/** The brush is a tall ellipse (like a highlighter's chisel tip), sized relative to the day cell. */
export const BRUSH = { rx: 0.16, ry: 0.34 };

export const HOLD = {
  /** How fast paint spreads while holding (cells per second). */
  speed: 5,
  /** After bleeding halfway into a neighbour, how long to keep holding before it takes the neighbour too (ms). */
  pause: 450,
  /** How close to the left/right edge (fraction of cell width) counts as "between two numbers". */
  edgeZone: 0.25,
};

interface Contested {
  day: DayState;
  side: -1 | 1;
}

interface Hold {
  x: number;
  y: number;
  own: DayState;
  contested: Contested[];
  r: number;
  phase: 'grow' | 'pause' | 'spread' | 'done';
  wait: number;
}

export class HighlighterEngine {
  onFlip: ((e: FlipEvent) => void) | null = null;
  brushScale = 1;
  /** Which days cannot be selected (e.g. past days when booking). The brush has no effect on them. */
  isDisabled: ((key: string) => boolean) | null = null;

  private _threshold = DEFAULT_THRESHOLD;
  private rows: RowLayout[] = [];
  private states = new Map<string, DayState>();
  private selection = new Set<string>();
  private tool: Tool = 'highlight';
  private active = false;
  private last: { x: number; y: number } | null = null;
  private touched = new Set<DayState>();
  private hold: Hold | null = null;
  private _coverage = new Map<string, Coverage>();

  get threshold(): number {
    return this._threshold;
  }

  set threshold(v: number) {
    this._threshold = Math.min(CELLS, Math.max(1, Math.round(v)));
  }

  get value(): string[] {
    return [...this.selection].sort();
  }

  get layout(): readonly RowLayout[] {
    return this.rows;
  }

  get stroking(): boolean {
    return this.active;
  }

  get holding(): boolean {
    return this.hold !== null;
  }

  /** Phase of the hold spread: grow = spreading / pause = halfway into a neighbour, waiting / spread = taking the neighbour / done = finished. */
  get holdPhase(): Hold['phase'] | null {
    return this.hold?.phase ?? null;
  }

  /** Coverage of the current stroke on each day. */
  get coverage(): ReadonlyMap<string, Coverage> {
    return this._coverage;
  }

  /** Half-width and half-height of the brush tip (ellipse) on a given day, in pixels. */
  brushRadius(rect: DayRect): { rx: number; ry: number } {
    return {
      rx: (rect.right - rect.left) * BRUSH.rx * this.brushScale,
      ry: (rect.bottom - rect.top) * BRUSH.ry * this.brushScale,
    };
  }

  /** Centre of the hold spread (null when not holding). */
  get holdPoint(): { x: number; y: number } | null {
    return this.hold ? { x: this.hold.x, y: this.hold.y } : null;
  }

  state(key: string): DayState | undefined {
    return this.states.get(key);
  }

  isSelected(key: string): boolean {
    return this.selection.has(key);
  }

  setLayout(rows: RowLayout[]): void {
    this.rows = rows;
    const next = new Map<string, DayState>();
    for (const row of rows) {
      for (const rect of row.days) {
        const prev = this.states.get(rect.key);
        if (prev) {
          prev.rect = rect;
          next.set(rect.key, prev);
        } else {
          const selected = this.selection.has(rect.key);
          next.set(rect.key, { rect, selected, mask: new Uint8Array(CELLS).fill(selected ? 1 : 0) });
        }
      }
    }
    this.states = next;
  }

  disabled(key: string): boolean {
    return this.isDisabled?.(key) ?? false;
  }

  setSelection(keys: Iterable<string>): void {
    this.selection = new Set([...keys].filter((k) => !this.disabled(k)));
    for (const [key, d] of this.states) {
      d.selected = this.selection.has(key);
      d.mask.fill(d.selected ? 1 : 0);
    }
  }

  /** Set a day directly (for keyboard and taps). `origin` is where the paint bleeds from (in cell coordinates). */
  setDay(key: string, selected: boolean, originX = GRID / 2, originY = GRID / 2): void {
    if (this.selection.has(key) === selected) return;
    if (selected && this.disabled(key)) return;
    if (selected) this.selection.add(key);
    else this.selection.delete(key);
    const d = this.states.get(key);
    if (d) {
      d.selected = selected;
      d.mask.fill(selected ? 1 : 0);
    }
    this.onFlip?.({ key, selected, originX, originY });
  }

  beginStroke(tool: Tool, x: number, y: number): void {
    this.tool = tool;
    this.active = true;
    this.touched.clear();
    this._coverage.clear();
    this.hold = null;
    this.last = { x, y };
    this.stamp(x, y);
  }

  moveTo(x: number, y: number): void {
    if (!this.active || !this.last) return;
    const { x: x0, y: y0 } = this.last;
    const dist = Math.hypot(x - x0, y - y0);
    const step = Math.max(1, this.stepSize());
    const n = Math.ceil(dist / step);
    for (let s = 1; s <= n; s++) {
      this.stamp(x0 + ((x - x0) * s) / n, y0 + ((y - y0) * s) / n);
    }
    this.last = { x, y };
  }

  /** Tap (no drag, no hold): like a drop of paint, fills or erases the tapped day outright. */
  tap(x: number, y: number): boolean {
    const want = this.tool === 'highlight';
    for (const d of this.states.values()) {
      const r = d.rect;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (d.selected === want || this.disabled(r.key)) return false;
      const ox = ((x - r.left) / (r.right - r.left)) * GRID;
      const oy = ((y - r.top) / (r.bottom - r.top)) * GRID;
      this.setDay(r.key, want, ox, oy);
      return true;
    }
    return false;
  }

  endStroke(): void {
    this.active = false;
    this.hold = null;
    this.last = null;
    for (const d of this.touched) d.mask.fill(d.selected ? 1 : 0);
    this.touched.clear();
  }

  /**
   * Pen held still: paint spreads outward from the press point until it fills that day.
   * If pressed between two numbers (near the left/right edge), it first bleeds halfway
   * into the neighbour and stops; keep holding and it takes the neighbour too. The
   * spread stays within the same row and never leaks into the rows above or below.
   */
  startHold(x: number, y: number): void {
    if (!this.active) return;
    const row = this.rowAt(y);
    if (!row) return;
    let own: DayRect | null = null;
    let best = Infinity;
    for (const r of row.days) {
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (dx < best) {
        best = dx;
        own = r;
      }
    }
    if (!own || this.disabled(own.key)) return;
    const w = own.right - own.left;
    if (best > w * 0.25) return;
    const zone = w * HOLD.edgeZone;
    const contested: Contested[] = [];
    const left = row.days.find((r) => r.slot === own.slot - 1);
    const right = row.days.find((r) => r.slot === own.slot + 1);
    if (left && !this.disabled(left.key) && x < own.left + zone) contested.push({ day: this.states.get(left.key)!, side: -1 });
    if (right && !this.disabled(right.key) && x > own.right - zone) contested.push({ day: this.states.get(right.key)!, side: 1 });
    this.hold = {
      x,
      y: Math.min(own.bottom, Math.max(own.top, y)),
      own: this.states.get(own.key)!,
      contested,
      r: 0.5,
      phase: 'grow',
      wait: 0,
    };
  }

  cancelHold(): void {
    this.hold = null;
  }

  /** Advance the hold spread; `dt` is in milliseconds. */
  tick(dt: number): void {
    const h = this.hold;
    if (!h || !this.active || h.phase === 'done') return;
    if (h.phase === 'pause') {
      h.wait -= dt;
      if (h.wait <= 0) h.phase = 'spread';
      return;
    }
    h.r += (HOLD.speed * dt) / 1000;
    const cap = Math.min(CELLS / 2, this._threshold - 1);
    let pending = this.spread(h, h.own, 0, CELLS);
    for (const c of h.contested) {
      const grow = h.phase === 'grow';
      pending = this.spread(h, c.day, grow ? c.side : 0, grow ? cap : CELLS) || pending;
    }
    if (pending && h.r < GRID * 3) return;
    const want = this.tool === 'highlight';
    if (h.phase === 'grow' && h.contested.some((c) => c.day.selected !== want)) {
      h.phase = 'pause';
      h.wait = HOLD.pause;
    } else {
      h.phase = 'done';
    }
  }

  /** Paint cells in `d` within distance `r` of the spread centre; returns whether unreachable cells remain. */
  private spread(h: Hold, d: DayState, side: -1 | 0 | 1, cap: number): boolean {
    const t = this.tool === 'highlight' ? 1 : 0;
    if (d.selected === (t === 1)) return false;
    const r = d.rect;
    const sw = (r.right - r.left) / GRID;
    const sh = (r.bottom - r.top) / GRID;
    let pending = false;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        // A neighbour may only be painted on the half nearest to us
        if (side === -1 && i < GRID / 2) continue;
        if (side === 1 && i >= GRID / 2) continue;
        const idx = j * GRID + i;
        if (d.mask[idx] === t) continue;
        if (this.count(d, t) >= cap) return false;
        const dist = Math.hypot((r.left + (i + 0.5) * sw - h.x) / sw, (r.top + (j + 0.5) * sh - h.y) / sh);
        if (dist <= h.r) {
          this.apply(d, idx);
          if (d.selected === (t === 1)) return false;
        } else {
          pending = true;
        }
      }
    }
    return pending;
  }

  private stepSize(): number {
    const r = this.rows[0]?.days[0];
    if (!r) return 4;
    const rx = (r.right - r.left) * BRUSH.rx * this.brushScale;
    const ry = (r.bottom - r.top) * BRUSH.ry * this.brushScale;
    return Math.min(rx, ry) * 0.6;
  }

  /** Find the row containing y; the brush only affects that row, so it never spills into rows above or below. */
  private rowAt(y: number): RowLayout | null {
    let best: RowLayout | null = null;
    let bd = Infinity;
    for (const row of this.rows) {
      const d = y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
      if (d < bd) {
        bd = d;
        best = row;
      }
    }
    if (!best) return null;
    return bd <= (best.bottom - best.top) * 0.25 ? best : null;
  }

  private stamp(x: number, y: number): void {
    const row = this.rowAt(y);
    if (!row) return;
    for (const r of row.days) {
      const w = r.right - r.left;
      const h = r.bottom - r.top;
      const rx = w * BRUSH.rx * this.brushScale;
      const ry = h * BRUSH.ry * this.brushScale;
      if (x + rx < r.left || x - rx > r.right) continue;
      const d = this.states.get(r.key)!;
      const cov = this._coverage.get(r.key);
      const cx = Math.min(r.right, Math.max(r.left, x));
      if (cov) {
        cov.minX = Math.min(cov.minX, cx);
        cov.maxX = Math.max(cov.maxX, cx);
        cov.sumY += y;
        cov.n++;
      } else {
        this._coverage.set(r.key, { minX: cx, maxX: cx, sumY: y, n: 1 });
      }
      const sw = w / GRID;
      const sh = h / GRID;
      for (let j = 0; j < GRID; j++) {
        const dy = (r.top + (j + 0.5) * sh - y) / ry;
        if (dy * dy > 1) continue;
        for (let i = 0; i < GRID; i++) {
          const dx = (r.left + (i + 0.5) * sw - x) / rx;
          if (dx * dx + dy * dy <= 1) this.apply(d, j * GRID + i);
        }
      }
    }
  }

  private count(d: DayState, t: number): number {
    let n = 0;
    for (let k = 0; k < CELLS; k++) if (d.mask[k] === t) n++;
    return n;
  }

  private apply(d: DayState, idx: number): void {
    const t = this.tool === 'highlight' ? 1 : 0;
    if (d.selected === (t === 1) || d.mask[idx] === t || this.disabled(d.rect.key)) return;
    d.mask[idx] = t;
    this.touched.add(d);
    if (this.count(d, t) < this._threshold) return;

    // Flip: record the centroid of the painted cells so the remaining paint bleeds out from there
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = 0; k < CELLS; k++) {
      if (d.mask[k] !== t) continue;
      sx += (k % GRID) + 0.5;
      sy += Math.floor(k / GRID) + 0.5;
      n++;
    }
    this.setDay(d.rect.key, t === 1, sx / n, sy / n);
  }
}
