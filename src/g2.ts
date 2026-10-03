/** A point (x, y), y running down. */
export type Pt = [number, number];

/** Apple's continuous corners (iOS): how far the curve's easing into the straight edge is drawn out (0 a plain arc). */
const SMOOTHING = 0.6;

/**
 * A closed path through the points, every corner rounded off the way Apple rounds them (a "continuous" corner, as on the
 * iPhone itself and in its SDKs): the curvature grows smoothly out of each straight edge into a short circular arc and
 * back, so the outline has no kink in curvature anywhere (G2), unlike a plain quarter circle. The corner of nominal
 * radius r takes (1 + SMOOTHING)·r of each edge, or as much as the edges either side allow.
 */
export const rounded = (pts: Pt[], radius: number): string => {
  const n = pts.length;
  const f = (v: number) => v.toFixed(2);
  const rad = (deg: number) => (deg * Math.PI) / 180;
  let d = '';
  for (let k = 0; k < n; k++) {
    const [px, py] = pts[(k + n - 1) % n];
    const [x, y] = pts[k];
    const [nx, ny] = pts[(k + 1) % n];
    const l1 = Math.hypot(x - px, y - py) || 1;
    const l2 = Math.hypot(nx - x, ny - y) || 1;
    const [ux, uy] = [(x - px) / l1, (y - py) / l1];
    const [vx, vy] = [(nx - x) / l2, (ny - y) / l2];
    // (the same easing as Figma's "corner smoothing", which follows Apple's: limited by the room each edge has)
    const room = Math.min(l1, l2) / 2;
    const r = Math.max(0, Math.min(radius, room));
    const s = r > 0 ? Math.max(0, Math.min(SMOOTHING, room / r - 1)) : 0;
    const p = Math.min((1 + s) * r, room);
    const arcDeg = 90 * (1 - s);
    const arc = Math.sin(rad(arcDeg / 2)) * r * Math.SQRT2;
    const alpha = (90 - arcDeg) / 2;
    const p3p4 = r * Math.tan(rad(alpha / 2));
    const beta = 45 * s;
    const c = p3p4 * Math.cos(rad(beta));
    const dd = c * Math.tan(rad(beta));
    const b = (p - arc - c - dd) / 3;
    const a = 2 * b;
    // In the corner's own frame: along the incoming edge (u) and along the outgoing one (v)
    const at = (i: number, j: number) => `${f(x - ux * p + ux * i + vx * j)} ${f(y - uy * p + uy * i + vy * j)}`;
    const sweep = ux * vy - uy * vx > 0 ? 1 : 0;
    d +=
      `${k ? 'L' : 'M'}${at(0, 0)}` +
      `C${at(a, 0)} ${at(a + b, 0)} ${at(a + b + c, dd)}` +
      `A${f(r)} ${f(r)} 0 0 ${sweep} ${at(a + b + c + arc, dd + arc)}` +
      `C${at(p, p - a - b)} ${at(p, p - a)} ${at(p, p)}`;
  }
  return `${d}Z`;
};

/** A w × h box with every corner continuous (see rounded). */
export const roundedRect = (w: number, h: number, radius: number): string =>
  rounded(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    radius,
  );
