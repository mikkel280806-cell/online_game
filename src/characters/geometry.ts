// Procedural geometry helpers for the EVA suit. Everything is built in bind-pose mesh space
// (metres, +Y up, character faces +Z, the character's left is +X).

import { BufferGeometry, Float32BufferAttribute, LatheGeometry, Vector2, Vector3 } from 'three';

/** One cross-section of a tube that runs along Y. */
export interface Ring {
  y: number;
  /** Half-width along X. */
  rx: number;
  /** Half-depth toward the front (+Z). */
  rz: number;
  /** Half-depth toward the back (-Z); defaults to `rz`. */
  rzb?: number;
  cx?: number;
  cz?: number;
  /** Superellipse exponent: 2 = ellipse, larger = boxier. */
  n?: number;
}

const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * Point on a ring. `theta` = 0 at the back (-Z), PI/2 on the +X side, PI at the front.
 * `grow` pushes the point outward by roughly that many metres.
 */
export function ringPoint(r: Ring, theta: number, out: Vector3, grow = 0): Vector3 {
  const e = 2 / (r.n ?? 2);
  const s = Math.sin(theta);
  const c = -Math.cos(theta);
  const zr = c >= 0 ? r.rz : (r.rzb ?? r.rz);
  out.set((r.cx ?? 0) + (r.rx + grow) * spow(s, e), r.y, (r.cz ?? 0) + (zr + grow) * spow(c, e));
  return out;
}

/** Linear interpolation of two rings (for resampling). */
export function lerpRing(a: Ring, b: Ring, t: number): Ring {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    y: l(a.y, b.y),
    rx: l(a.rx, b.rx),
    rz: l(a.rz, b.rz),
    rzb: l(a.rzb ?? a.rz, b.rzb ?? b.rz),
    cx: l(a.cx ?? 0, b.cx ?? 0),
    cz: l(a.cz ?? 0, b.cz ?? 0),
    n: l(a.n ?? 2, b.n ?? 2),
  };
}

/** Sample a ring profile (sorted by descending or ascending y) at height y. */
export function sampleRings(rings: Ring[], y: number): Ring {
  const asc = rings[0].y < rings[rings.length - 1].y;
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    const inside = asc ? y >= a.y && y <= b.y : y <= a.y && y >= b.y;
    if (inside) return lerpRing(a, b, (y - a.y) / (b.y - a.y || 1));
  }
  return y > rings[0].y === asc ? { ...rings[rings.length - 1], y } : { ...rings[0], y };
}

/**
 * Insert accordion folds ("convolutes") into a ring list between y0 and y1: `count` ridges whose
 * radius swells by `amp` metres. Adds rings densely enough to resolve each ridge.
 */
export function convolute(rings: Ring[], y0: number, y1: number, count: number, amp: number): Ring[] {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const kept = rings.filter((r) => r.y < lo || r.y > hi);
  const extra: Ring[] = [];
  const steps = count * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = lo + (hi - lo) * t;
    const base = sampleRings(rings, y);
    // Ridges are rounded, valleys are tighter creases.
    const wave = Math.pow(0.5 - 0.5 * Math.cos(t * count * Math.PI * 2), 0.7);
    const edge = Math.sin(t * Math.PI); // fade in/out at the ends
    const g = amp * wave * Math.pow(edge, 0.35);
    extra.push({ ...base, rx: base.rx + g, rz: base.rz + g, rzb: (base.rzb ?? base.rz) + g });
  }
  const all = [...kept, ...extra];
  const asc = rings[0].y < rings[rings.length - 1].y;
  all.sort((a, b) => (asc ? a.y - b.y : b.y - a.y));
  return all;
}

export interface TubeOptions {
  /** Angular range; default full circle. */
  theta0?: number;
  theta1?: number;
  /** Texture tiles around the circumference (rounded so a full tube wraps seamlessly). */
  panelWidth?: number;
  /** Texture tile length along the tube (m). */
  panelLength?: number;
  /** Close the first / last ring with a rounded cap. */
  capStart?: boolean;
  capEnd?: boolean;
  grow?: number;
}

/** A tube through a list of rings (full circle or a partial angular range). Smooth normals. */
export function ringTube(rings: Ring[], segments: number, opts: TubeOptions = {}): BufferGeometry {
  const t0 = opts.theta0 ?? 0;
  const t1 = opts.theta1 ?? Math.PI * 2;
  const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
  const grow = opts.grow ?? 0;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const q = new Vector3();
  const cols = segments + 1;

  // Circumference of the widest ring decides the panel count.
  let circ = 0;
  for (const r of rings) {
    let c = 0;
    ringPoint(r, t0, q, grow);
    for (let i = 1; i <= segments; i++) {
      ringPoint(r, t0 + ((t1 - t0) * i) / segments, p, grow);
      c += p.distanceTo(q);
      q.copy(p);
    }
    circ = Math.max(circ, c);
  }
  const pw = opts.panelWidth ?? 0.2;
  const uScale = full ? Math.max(1, Math.round(circ / pw)) : circ / pw;
  const pl = opts.panelLength ?? 0.24;

  let vAcc = 0;
  for (let j = 0; j < rings.length; j++) {
    if (j > 0) {
      const a = rings[j - 1];
      const b = rings[j];
      vAcc += Math.hypot(b.y - a.y, b.rx - a.rx);
    }
    for (let i = 0; i <= segments; i++) {
      const th = t0 + ((t1 - t0) * i) / segments;
      ringPoint(rings[j], th, p, grow);
      pos.push(p.x, p.y, p.z);
      uv.push((i / segments) * uScale, vAcc / pl);
    }
  }
  const asc = rings[0].y < rings[rings.length - 1].y;
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Outward-facing winding.
      if (asc) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const capRing = (j: number, dir: number) => {
    const r = rings[j];
    const base = pos.length / 3;
    // Two inner rings + pole for a soft dome.
    const steps = [0.66, 0.3];
    let prevStart = j * cols;
    for (let k = 0; k < steps.length; k++) {
      const s = steps[k];
      const inner: Ring = { ...r, rx: r.rx * s, rz: r.rz * s, rzb: (r.rzb ?? r.rz) * s, y: r.y + dir * Math.min(r.rx, r.rz) * (1 - s) * 0.55 };
      const start = pos.length / 3;
      for (let i = 0; i <= segments; i++) {
        ringPoint(inner, t0 + ((t1 - t0) * i) / segments, p, grow * s);
        pos.push(p.x, p.y, p.z);
        uv.push((i / segments) * uScale, (vAcc + (k + 1) * 0.02) / pl);
      }
      for (let i = 0; i < segments; i++) {
        const a = prevStart + i;
        const b = a + 1;
        const c = start + i;
        const d = c + 1;
        if ((dir > 0) === asc) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
      prevStart = start;
    }
    const pole = pos.length / 3;
    pos.push(r.cx ?? 0, r.y + dir * Math.min(r.rx, r.rz) * 0.42, r.cz ?? 0);
    uv.push(0.5 * uScale, (vAcc + 0.06) / pl);
    for (let i = 0; i < segments; i++) {
      const a = prevStart + i;
      if ((dir > 0) === asc) idx.push(a, pole, a + 1);
      else idx.push(a, a + 1, pole);
    }
    return base;
  };
  if (opts.capStart) capRing(0, asc ? -1 : 1);
  if (opts.capEnd) capRing(rings.length - 1, asc ? 1 : -1);

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (full) weldSeamNormals(g);
  return g;
}

/** Average normals of vertices that share a position (fixes the seam of wrapped tubes). */
export function weldSeamNormals(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const map = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  }
  const n = new Vector3();
  for (const list of map.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of list) n.add(new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)));
    n.normalize();
    for (const i of list) nor.setXYZ(i, n.x, n.y, n.z);
  }
}

export interface ShellOptions {
  /** Outward offset of the plate from the ring surface (m). */
  offset: number;
  /** Plate thickness (m). */
  thick: number;
  panelWidth?: number;
}

/**
 * A hard-shell plate that follows a ring tube over an angular range and a y range: an outer
 * surface with rounded edges plus a rim that gives it visible thickness. Adds an `edge`
 * attribute (1 at the rim, fading inward) used for paint wear.
 */
export function shellPlate(rings: Ring[], theta0: number, theta1: number, segments: number, opts: ShellOptions): BufferGeometry {
  const rows = rings.length;
  const cols = segments + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const asc = rings[0].y < rings[rows - 1].y;
  const bevel = Math.min(opts.thick * 0.55, 0.006);
  const pw = opts.panelWidth ?? 0.25;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const th = theta0 + ((theta1 - theta0) * i) / segments;
      const bi = Math.min(i, segments - i);
      const bj = Math.min(j, rows - 1 - j);
      const b = Math.min(bi, bj);
      const inset = b === 0 ? bevel : b === 1 ? bevel * 0.12 : 0;
      ringPoint(rings[j], th, p, opts.offset - inset);
      pos.push(p.x, p.y, p.z);
      uv.push((th * 0.16) / pw, p.y / pw);
      edge.push(b === 0 ? 1 : b === 1 ? 0.55 : b === 2 ? 0.15 : 0);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (asc) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const outer = new BufferGeometry();
  outer.setAttribute('position', new Float32BufferAttribute(pos, 3));
  outer.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  outer.setAttribute('edge', new Float32BufferAttribute(edge, 1));
  outer.setIndex(idx);
  outer.computeVertexNormals();

  // Rim: walk the boundary loop and drop a strip inward to the plate's underside.
  const loop: [number, number][] = [];
  for (let i = 0; i < cols; i++) loop.push([0, i]);
  for (let j = 1; j < rows; j++) loop.push([j, cols - 1]);
  for (let i = cols - 2; i >= 0; i--) loop.push([rows - 1, i]);
  for (let j = rows - 2; j > 0; j--) loop.push([j, 0]);
  const rp: number[] = [];
  const ruv: number[] = [];
  const re: number[] = [];
  const ri: number[] = [];
  let len = 0;
  const prev = new Vector3();
  for (let k = 0; k <= loop.length; k++) {
    const [j, i] = loop[k % loop.length];
    const th = theta0 + ((theta1 - theta0) * i) / segments;
    ringPoint(rings[j], th, p, opts.offset - bevel);
    if (k > 0) len += p.distanceTo(prev);
    prev.copy(p);
    rp.push(p.x, p.y, p.z);
    ringPoint(rings[j], th, p, opts.offset - opts.thick);
    rp.push(p.x, p.y, p.z);
    ruv.push(len / pw, 0, len / pw, opts.thick / pw);
    re.push(1, 1);
  }
  // Orientation: loop runs clockwise or counter-clockwise depending on ring order and theta sign.
  const flip = (asc ? 1 : -1) * Math.sign(theta1 - theta0) < 0;
  for (let k = 0; k < loop.length; k++) {
    const a = k * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    if (flip) ri.push(a, b, c, c, b, d);
    else ri.push(a, c, b, c, d, b);
  }
  const rim = new BufferGeometry();
  rim.setAttribute('position', new Float32BufferAttribute(rp, 3));
  rim.setAttribute('uv', new Float32BufferAttribute(ruv, 2));
  rim.setAttribute('edge', new Float32BufferAttribute(re, 1));
  rim.setIndex(ri);
  rim.computeVertexNormals();
  return mergeSimple([outer, rim]);
}

/**
 * Lathe around Y from (radius, y) pairs. The profile may be given in either direction: it is
 * ordered bottom-to-top so faces point outward.
 */
export function lathe(profile: [number, number][], segments: number, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  return new LatheGeometry(
    pts.map(([r, y]) => new Vector2(Math.max(r, 0), y)),
    segments,
    phiStart,
    phiLength,
  );
}

/**
 * Bearing ring around Y: a band from rInner to rOuter, `h` tall, with chamfered edges and a
 * groove around the middle (two stacked races).
 */
export function bearingRing(rInner: number, rOuter: number, h: number, segments: number, groove = true): BufferGeometry {
  const c = Math.min(0.004, h * 0.18);
  const g = Math.min(0.003, h * 0.12);
  const hh = h / 2;
  const prof: [number, number][] = groove
    ? [
        [rInner, -hh],
        [rOuter - c, -hh],
        [rOuter, -hh + c],
        [rOuter - g, 0],
        [rOuter, hh - c],
        [rOuter - c, hh],
        [rInner, hh],
      ]
    : [
        [rInner, -hh],
        [rOuter - c, -hh],
        [rOuter, -hh + c],
        [rOuter, hh - c],
        [rOuter - c, hh],
        [rInner, hh],
      ];
  return lathe(prof, segments);
}

/** Concatenate indexed geometries that share position/normal/uv (+ optional `edge`). */
export function mergeSimple(list: BufferGeometry[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const anyEdge = list.some((g) => g.getAttribute('edge'));
  for (const g of list) {
    const gp = g.getAttribute('position');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const gn = g.getAttribute('normal');
    const gu = g.getAttribute('uv');
    const ge = g.getAttribute('edge');
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i), gp.getY(i), gp.getZ(i));
      nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      uv.push(gu ? gu.getX(i) : 0, gu ? gu.getY(i) : 0);
      if (anyEdge) edge.push(ge ? ge.getX(i) : 0);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
    else for (let i = 0; i < gp.count; i++) idx.push(i + base);
    base += gp.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  if (anyEdge) out.setAttribute('edge', new Float32BufferAttribute(edge, 1));
  out.setIndex(idx);
  return out;
}

/** Tiny 3x5 pixel font for stencilled name tapes. */
const FONT: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  N: ['#.#', '###', '###', '#.#', '#.#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  ' ': ['...', '...', '...', '...', '...'],
};

/**
 * Flat stencil text in the XY plane facing +Z, centred on the origin. `px` is the pixel size.
 * Horizontal pixel runs are merged into single quads.
 */
export function stencilText(text: string, px: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const width = text.length * 4 - 1;
  const x0 = (-width * px) / 2;
  const y0 = (5 * px) / 2;
  let cursor = 0;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 5; row++) {
      let col = 0;
      while (col < 3) {
        if (glyph[row][col] !== '#') {
          col++;
          continue;
        }
        let end = col;
        while (end + 1 < 3 && glyph[row][end + 1] === '#') end++;
        const xa = x0 + (cursor + col) * px;
        const xb = x0 + (cursor + end + 1) * px;
        const ya = y0 - row * px;
        const yb = ya - px;
        const b = pos.length / 3;
        pos.push(xa, ya, 0, xb, ya, 0, xa, yb, 0, xb, yb, 0);
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        col = end + 1;
      }
    }
    cursor += 4;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  return g;
}
