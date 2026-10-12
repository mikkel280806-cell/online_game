import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { mulberry32 } from './random';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function tiled(c: HTMLCanvasElement, repeatX: number, repeatY: number, srgb: boolean, anisotropy: number): Texture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

export interface DeckTextures {
  map: Texture;
  roughnessMap: Texture;
  bumpMap: Texture;
}

/**
 * Deck plating: one texture tile = 4 m x 4 m, four 2 m panels with seams, bolts,
 * wear and the odd replaced panel. Colour, roughness and bump are drawn from the same
 * layout so they line up.
 */
export function deckTextures(repeatX: number, repeatY: number, anisotropy: number): DeckTextures {
  const S = 1024;
  const rand = mulberry32(42);
  const [colorC, col] = canvas(S);
  const [roughC, rough] = canvas(S);
  const [bumpC, bump] = canvas(S);

  col.fillStyle = '#31353d';
  col.fillRect(0, 0, S, S);
  rough.fillStyle = '#8a8a8a';
  rough.fillRect(0, 0, S, S);
  bump.fillStyle = '#c0c0c0';
  bump.fillRect(0, 0, S, S);

  const half = S / 2;
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x0 = px * half;
      const y0 = py * half;
      // Per-panel tint and roughness so the floor isn't a flat colour.
      const shade = 44 + Math.floor(rand() * 14);
      const replaced = rand() < 0.25;
      col.fillStyle = replaced ? `rgb(${shade + 6},${shade + 4},${shade})` : `rgb(${shade},${shade + 3},${shade + 9})`;
      col.fillRect(x0 + 6, y0 + 6, half - 12, half - 12);
      const r = 110 + Math.floor(rand() * 60);
      rough.fillStyle = `rgb(${r},${r},${r})`;
      rough.fillRect(x0 + 6, y0 + 6, half - 12, half - 12);

      // Raised tread pattern on alternate panels.
      if ((px + py) % 2 === 0) {
        for (let i = 0; i < 14; i++) {
          for (let j = 0; j < 14; j++) {
            const cx = x0 + 34 + i * 32;
            const cy = y0 + 34 + j * 32;
            const horizontal = (i + j) % 2 === 0;
            bump.fillStyle = '#e8e8e8';
            if (horizontal) bump.fillRect(cx - 9, cy - 2, 18, 4);
            else bump.fillRect(cx - 2, cy - 9, 4, 18);
            col.fillStyle = 'rgba(255,255,255,0.035)';
            if (horizontal) col.fillRect(cx - 9, cy - 2, 18, 4);
            else col.fillRect(cx - 2, cy - 9, 4, 18);
          }
        }
      }

      // Bolts in each corner.
      for (const [bx, by] of [
        [x0 + 20, y0 + 20],
        [x0 + half - 20, y0 + 20],
        [x0 + 20, y0 + half - 20],
        [x0 + half - 20, y0 + half - 20],
      ]) {
        col.fillStyle = '#5b6068';
        col.beginPath();
        col.arc(bx, by, 6, 0, Math.PI * 2);
        col.fill();
        bump.fillStyle = '#ffffff';
        bump.beginPath();
        bump.arc(bx, by, 6, 0, Math.PI * 2);
        bump.fill();
      }
    }
  }

  // Seams.
  for (const ctx of [col, rough, bump]) {
    ctx.strokeStyle = ctx === col ? '#14161a' : ctx === rough ? '#f0f0f0' : '#202020';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, S);
    ctx.moveTo(0, half);
    ctx.lineTo(S, half);
    ctx.stroke();
    ctx.strokeRect(0, 0, S, S);
  }

  // Scuffs and grime: darker, rougher blotches.
  for (let i = 0; i < 260; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rad = 4 + rand() * 40;
    const g = col.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(10,10,12,${0.05 + rand() * 0.12})`);
    g.addColorStop(1, 'rgba(10,10,12,0)');
    col.fillStyle = g;
    col.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const gr = rough.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(230,230,230,${0.1 + rand() * 0.2})`);
    gr.addColorStop(1, 'rgba(230,230,230,0)');
    rough.fillStyle = gr;
    rough.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Fine scratches, shiny in the roughness map.
  for (let i = 0; i < 120; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI;
    const len = 10 + rand() * 60;
    col.strokeStyle = 'rgba(160,165,175,0.12)';
    rough.strokeStyle = 'rgba(40,40,40,0.5)';
    for (const ctx of [col, rough]) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
  }

  return {
    map: tiled(colorC, repeatX, repeatY, true, anisotropy),
    roughnessMap: tiled(roughC, repeatX, repeatY, false, anisotropy),
    bumpMap: tiled(bumpC, repeatX, repeatY, false, anisotropy),
  };
}

/** Painted ring and markings around the holotable; drawn on a transparent decal. */
export function emblemTexture(): Texture {
  const S = 1024;
  const [c, g] = canvas(S);
  const mid = S / 2;
  g.strokeStyle = 'rgba(214,170,90,0.55)';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(mid, mid, mid - 30, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.arc(mid, mid, mid - 70, 0, Math.PI * 2);
  g.stroke();
  // Compass ticks.
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 6 === 0;
    const r0 = mid - 70;
    const r1 = r0 - (long ? 50 : 22);
    g.lineWidth = long ? 6 : 3;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0);
    g.lineTo(mid + Math.cos(a) * r1, mid + Math.sin(a) * r1);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Yellow/black hazard stripes for edges and the gangway. */
export function hazardTexture(repeat: number): Texture {
  const [c, g] = canvas(256);
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c9a227';
  for (let i = -256; i < 512; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 0);
    g.lineTo(i + 32 + 256, 256);
    g.lineTo(i + 256, 256);
    g.closePath();
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, 1);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Alpha mask for force fields: bright edges and scanlines, fading toward the top. */
export function forceFieldTexture(): Texture {
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const fade = g.createLinearGradient(0, H, 0, 0);
  fade.addColorStop(0, 'rgb(90,90,90)');
  fade.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(255,255,255,0.9)');
  edge.addColorStop(0.06, 'rgba(255,255,255,0)');
  edge.addColorStop(0.94, 'rgba(255,255,255,0)');
  edge.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, H - 4, W, 4);
  return new CanvasTexture(c);
}
