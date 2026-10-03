/**
 * Liquid glass for <retro-calendar>: Apple's continuous (G2) corner outline, and the refraction map that bends the view
 * through a slab of glass near its rounded edge (after kube.io's "Liquid Glass in the browser"). The map feeds an SVG
 * feDisplacementMap used as a backdrop-filter, which only Chromium draws; elsewhere the glass is frosted without bending.
 */

/** Chromium draws SVG filters in backdrop-filter; userAgentData is a cheap way to recognise it. */
export const CAN_BEND = typeof navigator !== 'undefined' && 'userAgentData' in navigator;

/** How far the curve eases into the straight edge (Apple's corner smoothing; 0 would be a plain quarter circle). */
const SMOOTHING = 0.6;

/**
 * A w × h rectangle with Apple's continuous corners of nominal radius r: the curvature grows smoothly out of each
 * straight edge into a short arc and back, so the outline has no kink in curvature (G2). A corner takes (1 + SMOOTHING)·r
 * of each edge, or as much as the edge allows. Returned as an SVG path in the rectangle's own pixels.
 */
export function continuousRect(w: number, h: number, r: number): string {
  const f = (v: number) => v.toFixed(2);
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const room = Math.min(w, h) / 2;
  r = Math.max(0, Math.min(r, room));
  const s = r > 0 ? Math.max(0, Math.min(SMOOTHING, room / r - 1)) : 0;
  const p = Math.min((1 + s) * r, room);
  const arcDeg = 90 * (1 - s);
  const arc = Math.sin(rad(arcDeg / 2)) * r * Math.SQRT2;
  const p3p4 = r * Math.tan(rad((90 - arcDeg) / 4));
  const beta = 45 * s;
  const c = p3p4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  // Each corner in its own frame: u runs along the incoming edge, v along the outgoing one
  const corners: [number, number, number, number, number, number][] = [
    [w, 0, 1, 0, 0, 1],
    [w, h, 0, 1, -1, 0],
    [0, h, -1, 0, 0, -1],
    [0, 0, 0, -1, 1, 0],
  ];
  let out = '';
  corners.forEach(([x, y, ux, uy, vx, vy], k) => {
    const at = (i: number, j: number) => `${f(x - ux * p + ux * i + vx * j)} ${f(y - uy * p + uy * i + vy * j)}`;
    out +=
      `${k ? 'L' : 'M'}${at(0, 0)}` +
      `C${at(a, 0)} ${at(a + b, 0)} ${at(a + b + c, d)}` +
      `A${f(r)} ${f(r)} 0 0 1 ${at(a + b + c + arc, d + arc)}` +
      `C${at(p, p - a - b)} ${at(p, p - a)} ${at(p, p)}`;
  });
  return `${out}Z`;
}

/**
 * The refraction map for a w × h slab with corner radius r whose top is flat in the middle and rounds over a bezel of
 * the given width at its edge, in the profile of a convex squircle, y = (1 − (1 − x)⁴)^¼. Where the surface tilts, the
 * light bends towards the thick middle, so the view there is taken from further in: the red and green channels say how
 * far, as a fraction of the filter's scale (128 is no shift). Returns a PNG data URL.
 */
export function refractionMap(w: number, h: number, r: number, bezel: number): string {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(W, H);
  const px = img.data;
  // A continuous corner reaches further along its edges than a circular one of the same radius; a slightly larger
  // circle stands in for it closely enough for a distance field
  const R = Math.min(r * 1.25, W / 2, H / 2);
  const hw = W / 2;
  const hh = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Signed distance to the rounded rectangle (negative inside) and its outward gradient
      const qx = Math.abs(x + 0.5 - hw) - (hw - R);
      const qy = Math.abs(y + 0.5 - hh) - (hh - R);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const len = Math.hypot(ox, oy);
      const dist = len + Math.min(Math.max(qx, qy), 0) - R;
      let nx: number;
      let ny: number;
      if (len > 0) {
        nx = ox / len;
        ny = oy / len;
      } else if (qx > qy) {
        nx = 1;
        ny = 0;
      } else {
        nx = 0;
        ny = 1;
      }
      nx *= Math.sign(x + 0.5 - hw) || 1;
      ny *= Math.sign(y + 0.5 - hh) || 1;
      const depth = -dist;
      let m = 0;
      if (depth > 0 && depth < bezel) {
        const t = depth / bezel;
        const u = 1 - t;
        // The slope of the squircle profile, and how much a ray through it is turned (the sine of the tilt)
        const slope = (u * u * u) / Math.pow(Math.max(1e-6, 1 - u * u * u * u), 0.75);
        m = slope / Math.sqrt(1 + slope * slope);
      }
      const k = (y * W + x) * 4;
      // Take the view from inwards (against the outward normal)
      px[k] = 128 - Math.round(nx * m * 127);
      px[k + 1] = 128 - Math.round(ny * m * 127);
      px[k + 2] = 128;
      px[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
