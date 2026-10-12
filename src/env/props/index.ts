import { Group } from 'three';
import type { EnvContext, HeightFn, Props } from '../types';

// PLACEHOLDER: the Props agent replaces this with the outpost, dropship and the Meridian wreck.
export function createProps(_ctx: EnvContext, _heightAt: HeightFn): Props {
  return { group: new Group(), colliders: [], update() {} };
}
