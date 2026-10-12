import { Color, Vector3 } from 'three';

// World layout for Chapter 1 ("Vigil"). Metres; +Y up; -Z is north.
// Shared by terrain, props, lighting and gameplay so everything lines up.

/** Direction toward the red giant (the key light comes from here). ~11° elevation, west-north-west. */
export const SUN_DIR = new Vector3(-0.85, 0.2, -0.48).normalize();
/** Direction toward the gas giant Orrin in the sky. East-north-east, ~25° up. */
export const PLANET_DIR = new Vector3(0.78, 0.42, -0.46).normalize();

export const SUN_COLOR = new Color('#ffb27a');
export const DUST_COLOR = new Color('#7d7368');

/** The outpost sits on flat ground: terrain height is exactly 0 within this radius of the origin. */
export const OUTPOST_FLAT_RADIUS = 38;
/** Terrain blends from flat back to natural ground between FLAT_RADIUS and this radius. */
export const OUTPOST_BLEND_RADIUS = 75;

/** Where players may walk (soft circular boundary around the origin). */
export const PLAY_RADIUS = 150;

/** Landing pad (centre on the ground) where the players' dropship stands. */
export const LANDING_PAD = { x: 12, z: 6, radius: 13 };
/** Players spawn near the dropship's ramp. */
export const SPAWN_POINTS = [new Vector3(4.5, 0, 16), new Vector3(7.5, 0, 17.5)];

/**
 * The crashed Meridian. Its bow points along `yaw` (radians around +Y, 0 = facing -Z/north).
 * Terrain digs a crater under it and a ploughed trench behind it; props place the hull.
 */
export const WRECK = {
  x: -70,
  z: -560,
  yaw: 2.35, // bow toward the south-west, i.e. roughly toward the outpost
  length: 420,
  /** The hull is sunk this far below the local ground at its centre line. */
  burial: 14,
  craterRadius: 140,
  craterDepth: 9,
};
/** The trench the Meridian ploughed as it came in from the north-east: from start to the wreck's stern. */
export const TRENCH = { start: new Vector3(260, 0, -1020), end: new Vector3(80, 0, -700), width: 55, depth: 7 };

/** Keep the view from the outpost to the wreck open: terrain stays low inside this corridor. */
export const VISTA_CORRIDOR = { from: new Vector3(0, 0, -40), to: new Vector3(-70, 0, -480), width: 120, maxHeight: 6 };

/** Distant mountains start rising beyond this radius. */
export const MOUNTAIN_START_RADIUS = 420;
