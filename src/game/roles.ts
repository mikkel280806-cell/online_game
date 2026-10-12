import { Color } from 'three';

export type RoleId = 'vanguard' | 'tether';

/** The two crew roles. `color` is an HDR emissive accent; `css` is for UI text. */
export const ROLES: Record<RoleId, { name: string; color: Color; accent: Color; css: string }> = {
  vanguard: { name: 'Vanguard', color: new Color(2.6, 1.05, 0.25), accent: new Color('#ff7a1a'), css: '#ffae5c' },
  tether: { name: 'Tether', color: new Color(0.3, 1.5, 2.6), accent: new Color('#29d3ff'), css: '#6fe3ff' },
};
