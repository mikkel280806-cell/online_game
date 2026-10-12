// Canvas textures: painted stencils and labels (one atlas), landing-pad markings, solar cells.

import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, SRGBColorSpace, type Texture } from 'three';
import { mulberry32 } from '../../game/random';

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Width / height of the drawn content. */
  aspect: number;
}

const FONT = '"DIN Condensed", "Roboto Condensed", "Arial Narrow", Inter, "Helvetica Neue", Arial, sans-serif';

/** Letters whose closed counters get a stencil bridge, and where (fraction of glyph width). */
const BRIDGES: Record<string, number> = { O: 0.5, Q: 0.5, '0': 0.5, '8': 0.5, '6': 0.5, '9': 0.5, D: 0.36, B: 0.36, P: 0.36, R: 0.36, A: 0.5 };

function drawText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { weight?: number; stencil?: boolean; spacing?: number; align?: 'left' | 'center' } = {},
): void {
  const size = h * 0.92;
  g.save();
  g.font = `${opts.weight ?? 800} ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  const spacing = (opts.spacing ?? 0.06) * size;
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const natural = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  const sx = Math.min(1, w / natural);
  const total = natural * sx;
  let cx = opts.align === 'left' ? x : x + (w - total) / 2;
  const cy = y + h / 2;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    g.save();
    g.translate(cx, cy);
    g.scale(sx, 1);
    g.fillStyle = '#fff';
    g.fillText(ch, 0, 0);
    if (opts.stencil && BRIDGES[ch] !== undefined) {
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(widths[i] * BRIDGES[ch] - size * 0.035, -size, size * 0.07, size * 2);
    }
    g.restore();
    cx += (widths[i] + spacing) * sx;
  }
  g.restore();
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

const ATLAS_ITEMS: Record<string, { w: number; h: number; paint: Painter }> = {
  WREN: { w: 900, h: 240, paint: (g, w, h) => drawText(g, 'WREN', 0, 0, w, h, { stencil: true, spacing: 0.12 }) },
  REG: { w: 900, h: 90, paint: (g, w, h) => drawText(g, 'VSR-0417  KESTREL SURVEY WING', 0, 0, w, h, { weight: 600, spacing: 0.08 }) },
  N07: { w: 300, h: 220, paint: (g, w, h) => drawText(g, '07', 0, 0, w, h, { stencil: true }) },
  NOSTEP: { w: 300, h: 70, paint: (g, w, h) => drawText(g, 'NO STEP', 0, 0, w, h, { weight: 700 }) },
  RESCUE: {
    w: 420,
    h: 110,
    paint: (g, w, h) => {
      drawText(g, 'RESCUE', 0, 0, w * 0.72, h * 0.7, { weight: 800 });
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(w * 0.78, h * 0.1);
      g.lineTo(w * 0.98, h * 0.35);
      g.lineTo(w * 0.78, h * 0.6);
      g.closePath();
      g.fill();
      drawText(g, 'CUT HERE IN EMERGENCY', 0, h * 0.72, w, h * 0.26, { weight: 600 });
    },
  },
  SIGN: {
    w: 1400,
    h: 420,
    paint: (g, w, h) => {
      g.fillStyle = '#fff';
      const b = 14;
      g.fillRect(0, 0, w, b);
      g.fillRect(0, h - b, w, b);
      g.fillRect(0, 0, b, h);
      g.fillRect(w - b, 0, b, h);
      drawText(g, 'KESTREL-7', 40, 30, w - 80, 190, { weight: 900, spacing: 0.1 });
      drawText(g, 'SURVEY OUTPOST', 40, 225, w - 80, 95, { weight: 700, spacing: 0.22 });
      drawText(g, 'ORRIN DEEP SURVEY AUTHORITY   //   VIGIL STATION 7   //   EST. 2291', 40, 335, w - 80, 48, { weight: 600, spacing: 0.1 });
    },
  },
  HAZARD: {
    w: 512,
    h: 64,
    paint: (g, w, h) => {
      g.fillStyle = '#fff';
      for (let x = -h; x < w + h; x += 64) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 32, h);
        g.lineTo(x + 32 + h, 0);
        g.lineTo(x + h, 0);
        g.closePath();
        g.fill();
      }
    },
  },
  ORRIN: { w: 700, h: 110, paint: (g, w, h) => drawText(g, 'ORRIN SURVEY', 0, 0, w, h, { stencil: true, spacing: 0.1 }) },
  GROSS: {
    w: 520,
    h: 150,
    paint: (g, w, h) => {
      drawText(g, 'MAX GROSS  30 480 KG', 0, 0, w, h * 0.3, { weight: 600, align: 'left' });
      drawText(g, 'TARE        2 260 KG', 0, h * 0.34, w, h * 0.3, { weight: 600, align: 'left' });
      drawText(g, 'CU.CAP.    33.2 CU.M', 0, h * 0.68, w, h * 0.3, { weight: 600, align: 'left' });
    },
  },
  'KS7-03': { w: 520, h: 120, paint: (g, w, h) => drawText(g, 'KS7-03', 0, 0, w, h, { stencil: true }) },
  'KS7-07': { w: 520, h: 120, paint: (g, w, h) => drawText(g, 'KS7-07', 0, 0, w, h, { stencil: true }) },
  'KS7-11': { w: 520, h: 120, paint: (g, w, h) => drawText(g, 'KS7-11', 0, 0, w, h, { stencil: true }) },
  'KS7-14': { w: 520, h: 120, paint: (g, w, h) => drawText(g, 'KS7-14', 0, 0, w, h, { stencil: true }) },
  'HAB-1': { w: 420, h: 130, paint: (g, w, h) => drawText(g, 'HAB-1', 0, 0, w, h, { stencil: true }) },
  'LAB-2': { w: 420, h: 130, paint: (g, w, h) => drawText(g, 'LAB-2', 0, 0, w, h, { stencil: true }) },
  'HAB-3': { w: 420, h: 130, paint: (g, w, h) => drawText(g, 'HAB-3', 0, 0, w, h, { stencil: true }) },
  AIRLOCK: { w: 440, h: 80, paint: (g, w, h) => drawText(g, 'AIRLOCK', 0, 0, w, h, { weight: 700, spacing: 0.2 }) },
  LOX: { w: 300, h: 130, paint: (g, w, h) => drawText(g, 'LOX', 0, 0, w, h, { stencil: true }) },
  LH2: { w: 300, h: 130, paint: (g, w, h) => drawText(g, 'LH2', 0, 0, w, h, { stencil: true }) },
  FLAMMABLE: { w: 560, h: 80, paint: (g, w, h) => drawText(g, 'FLAMMABLE  CRYOGENIC', 0, 0, w, h, { weight: 700 }) },
  DANGER: {
    w: 620,
    h: 100,
    paint: (g, w, h) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(h * 0.55, 4);
      g.lineTo(h * 0.25, h * 0.55);
      g.lineTo(h * 0.5, h * 0.55);
      g.lineTo(h * 0.35, h - 4);
      g.lineTo(h * 0.8, h * 0.4);
      g.lineTo(h * 0.55, h * 0.4);
      g.lineTo(h * 0.75, 4);
      g.closePath();
      g.fill();
      drawText(g, 'DANGER  HIGH VOLTAGE', h, 0, w - h, h, { weight: 800 });
    },
  },
  ARROW: {
    w: 200,
    h: 120,
    paint: (g, w, h) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(0, h * 0.3);
      g.lineTo(w * 0.55, h * 0.3);
      g.lineTo(w * 0.55, 0);
      g.lineTo(w, h * 0.5);
      g.lineTo(w * 0.55, h);
      g.lineTo(w * 0.55, h * 0.7);
      g.lineTo(0, h * 0.7);
      g.closePath();
      g.fill();
    },
  },
  K7: { w: 260, h: 120, paint: (g, w, h) => drawText(g, 'K-7', 0, 0, w, h, { stencil: true }) },
  PAD07: { w: 420, h: 70, paint: (g, w, h) => drawText(g, 'PAD 07  MAX 40 T', 0, 0, w, h, { weight: 700 }) },
  MERIDIAN: { w: 1600, h: 200, paint: (g, w, h) => drawText(g, 'MERIDIAN', 0, 0, w, h, { weight: 800, spacing: 0.35 }) },
};

export type AtlasKey = keyof typeof ATLAS_ITEMS;

export interface DecalAtlas {
  texture: Texture;
  rect(name: string): AtlasRect;
}

/** All stencils in one white-on-transparent atlas; colour comes from the decal's vertex colour. */
export function createDecalAtlas(maxAnisotropy: number): DecalAtlas {
  const W = 2048;
  const H = 2048;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rects: Record<string, AtlasRect> = {};
  let x = 8;
  let y = 8;
  let rowH = 0;
  const pad = 12;
  for (const [name, item] of Object.entries(ATLAS_ITEMS)) {
    if (x + item.w + pad > W) {
      x = 8;
      y += rowH + pad;
      rowH = 0;
    }
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, item.w, item.h);
    g.clip();
    item.paint(g, item.w, item.h);
    g.restore();
    // Texture v runs bottom-up (flipY).
    rects[name] = { u0: x / W, u1: (x + item.w) / W, v0: 1 - (y + item.h) / H, v1: 1 - y / H, aspect: item.w / item.h };
    x += item.w + pad;
    rowH = Math.max(rowH, item.h);
  }
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  return {
    texture,
    rect(name: string) {
      const r = rects[name];
      if (!r) throw new Error(`props: no atlas entry ${name}`);
      return r;
    },
  };
}

export interface PadMarkSpec {
  /** Radius covered by the texture (metres). */
  radius: number;
  /** Ship axis direction on the pad (unit, x/z) and the ship origin relative to the pad centre. */
  axis: { x: number; z: number };
  shipOffset: { x: number; z: number };
  /** Pad-local points of the ship's lift thrusters and gear (for scorch). */
  scorch: { x: number; z: number; r: number; k: number }[];
  /** Lip of the ramp (pad-local) and the spawn side edge for the walkway. */
  walkFrom: { x: number; z: number };
  walkTo: { x: number; z: number };
}

/**
 * Pad markings as data channels: R = white paint, G = yellow paint, B = scorch.
 * North (-Z) is the top of the canvas, so painted text reads upright from the south.
 */
export function createPadMarks(spec: PadMarkSpec, size = 2048): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const R = spec.radius;
  const s = size / (2 * R);
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.setTransform(s, 0, 0, s, size / 2, size / 2); // metres, origin at pad centre, +y = +z (south)
  g.globalCompositeOperation = 'lighter';
  const W = 'rgb(255,0,0)';
  const Y = 'rgb(0,255,0)';

  const ring = (r0: number, r1: number, col: string) => {
    g.beginPath();
    g.arc(0, 0, r1, 0, Math.PI * 2);
    g.arc(0, 0, r0, 0, Math.PI * 2, true);
    g.fillStyle = col;
    g.fill();
  };
  ring(11.85, 12.3, Y);
  // Dashed white perimeter.
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / 48 * 0.55;
    g.beginPath();
    g.arc(0, 0, 12.7, a0, a1);
    g.arc(0, 0, 12.5, a1, a0, true);
    g.closePath();
    g.fillStyle = W;
    g.fill();
  }
  ring(6.7, 7.05, W);

  // Ship parking centreline (yellow, dashed) with a stop bar for the nose gear.
  const ax = spec.axis.x;
  const az = spec.axis.z;
  const px = -az;
  const pz = ax;
  const o = spec.shipOffset;
  for (let t = -11; t < 6; t += 1.6) {
    const x0 = o.x + ax * t;
    const z0 = o.z + az * t;
    g.beginPath();
    g.moveTo(x0 + px * 0.12, z0 + pz * 0.12);
    g.lineTo(x0 + ax * 0.9 + px * 0.12, z0 + az * 0.9 + pz * 0.12);
    g.lineTo(x0 + ax * 0.9 - px * 0.12, z0 + az * 0.9 - pz * 0.12);
    g.lineTo(x0 - px * 0.12, z0 - pz * 0.12);
    g.closePath();
    g.fillStyle = Y;
    g.fill();
  }
  const bar = (t: number, half: number, thick: number) => {
    const x0 = o.x + ax * t;
    const z0 = o.z + az * t;
    g.beginPath();
    g.moveTo(x0 + px * half, z0 + pz * half);
    g.lineTo(x0 + px * half + ax * thick, z0 + pz * half + az * thick);
    g.lineTo(x0 - px * half + ax * thick, z0 - pz * half + az * thick);
    g.lineTo(x0 - px * half, z0 - pz * half);
    g.closePath();
    g.fillStyle = Y;
    g.fill();
  };
  bar(-8.2, 1.6, 0.3);
  bar(3.4, 5.4, 0.25);
  bar(5.1, 5.4, 0.25);

  // Walkway from the pad edge to the ramp: two white lines and chevrons.
  const wx = spec.walkTo.x - spec.walkFrom.x;
  const wz = spec.walkTo.z - spec.walkFrom.z;
  const wl = Math.hypot(wx, wz);
  const ux = wx / wl;
  const uz = wz / wl;
  for (const side of [-1.7, 1.7]) {
    g.beginPath();
    const sx = -uz * side;
    const sz = ux * side;
    g.moveTo(spec.walkFrom.x + sx - uz * 0.1, spec.walkFrom.z + sz + ux * 0.1);
    g.lineTo(spec.walkTo.x + sx - uz * 0.1, spec.walkTo.z + sz + ux * 0.1);
    g.lineTo(spec.walkTo.x + sx + uz * 0.1, spec.walkTo.z + sz - ux * 0.1);
    g.lineTo(spec.walkFrom.x + sx + uz * 0.1, spec.walkFrom.z + sz - ux * 0.1);
    g.closePath();
    g.fillStyle = W;
    g.fill();
  }
  for (let t = 1.2; t < wl - 0.8; t += 1.8) {
    const cx = spec.walkFrom.x + ux * t;
    const cz = spec.walkFrom.z + uz * t;
    g.beginPath();
    g.moveTo(cx - uz * 1.1 - ux * 0.35, cz + ux * 1.1 - uz * 0.35);
    g.lineTo(cx + ux * 0.35, cz + uz * 0.35);
    g.lineTo(cx + uz * 1.1 - ux * 0.35, cz - ux * 1.1 - uz * 0.35);
    g.lineTo(cx + uz * 1.1 - ux * 0.75, cz - ux * 1.1 - uz * 0.75);
    g.lineTo(cx - ux * 0.05, cz - uz * 0.05);
    g.lineTo(cx - uz * 1.1 - ux * 0.75, cz + ux * 1.1 - uz * 0.75);
    g.closePath();
    g.fillStyle = W;
    g.fill();
  }

  // Pad number on the free west side, readable from the south.
  g.save();
  g.translate(-8.6, 1.2);
  g.font = `900 4.4px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = W;
  g.save();
  g.scale(0.8, 1);
  g.fillText('07', 0, 0);
  g.restore();
  g.font = `700 0.62px ${FONT}`;
  g.fillText('KESTREL-7  //  MAX 40 T', 0, 3.0);
  g.restore();

  // Hazard chevrons at the access steps (west) and ramp (north).
  const chevrons = (cx: number, cz: number, rot: number, n: number) => {
    g.save();
    g.translate(cx, cz);
    g.rotate(rot);
    for (let i = 0; i < n; i++) {
      const x0 = -n * 0.45 + i * 0.9;
      g.beginPath();
      g.moveTo(x0, -0.45);
      g.lineTo(x0 + 0.45, -0.45);
      g.lineTo(x0 + 0.85, 0.45);
      g.lineTo(x0 + 0.4, 0.45);
      g.closePath();
      g.fillStyle = Y;
      g.fill();
    }
    g.restore();
  };
  chevrons(-11.6, 4.5, Math.PI / 2, 4);
  chevrons(-3.5, -11.2, 0.3, 4);

  // Scorch: broad soot from many landings, darker under the lift thrusters, radial blast streaks.
  const soot = (x: number, z: number, r: number, k: number) => {
    const grd = g.createRadialGradient(x, z, 0, x, z, r);
    grd.addColorStop(0, `rgba(0,0,255,${k})`);
    grd.addColorStop(0.45, `rgba(0,0,255,${k * 0.55})`);
    grd.addColorStop(1, 'rgba(0,0,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, z, r, 0, Math.PI * 2);
    g.fill();
  };
  soot(0, 0, 10.5, 0.32);
  soot(o.x, o.z, 7.5, 0.25);
  for (const p of spec.scorch) soot(p.x, p.z, p.r, p.k);
  const rnd = mulberry32(77);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = 1.5 + rnd() * 4;
    const r1 = r0 + 2 + rnd() * 6;
    g.strokeStyle = `rgba(0,0,255,${0.05 + rnd() * 0.09})`;
    g.lineWidth = 0.08 + rnd() * 0.35;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.stroke();
  }

  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

/** Solar cell albedo: left half intact panel, right half the cracked one. */
export function createSolarTexture(): Texture {
  const W = 1024;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(5);
  for (let half = 0; half < 2; half++) {
    const x0 = half * (W / 2);
    g.fillStyle = '#b8bcc0';
    g.fillRect(x0, 0, W / 2, H);
    const cols = 6;
    const rows = 12;
    const cw = (W / 2 - 16) / cols;
    const ch = (H - 16) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const v = 18 + Math.floor(rnd() * 8);
        g.fillStyle = `rgb(${v - 6},${v},${v + 22})`;
        const cx = x0 + 8 + i * cw + 3;
        const cy = 8 + j * ch + 3;
        g.fillRect(cx, cy, cw - 6, ch - 6);
        g.fillStyle = 'rgba(170,175,185,0.55)';
        for (let k = 1; k < 4; k++) g.fillRect(cx + ((cw - 6) * k) / 4, cy, 1.5, ch - 6);
      }
    }
  }
  // Cracks on the right half: impact point with radiating fractures.
  const ix = W * 0.75 + 30;
  const iy = H * 0.42;
  g.strokeStyle = 'rgba(210,215,220,0.85)';
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let a = rnd() * Math.PI * 2;
    let x = ix;
    let y = iy;
    g.lineWidth = 1 + rnd() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    const len = 60 + rnd() * 380;
    for (let s = 0; s < len; s += 14) {
      a += (rnd() - 0.5) * 0.5;
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      if (x < W / 2 + 4 || x > W - 4) break;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const grd = g.createRadialGradient(ix, iy, 0, ix, iy, 70);
  grd.addColorStop(0, 'rgba(200,205,210,0.9)');
  grd.addColorStop(1, 'rgba(200,205,210,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(ix, iy, 70, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
