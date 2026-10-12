// Example look-dev page: the current character on a dusty ground plane.
import { Vector3 } from 'three';
import { Avatar } from '../characters';
import { runLookdev } from './harness';

const a = new Avatar('vanguard');
const b = new Avatar('tether');

void runLookdev({
  ground: true,
  views: {
    front: { position: [0, 1.6, 5], target: [0, 1, 0] },
    side: { position: [5, 2, 0], target: [0, 1, 0] },
  },
  setup({ scene }) {
    scene.add(a.root, b.root);
  },
  update(time) {
    a.animate(new Vector3(-0.8, 0, 0), 0.3, 0, 1 / 60);
    b.animate(new Vector3(0.8, 0, 0), -0.3, 4 + time * 0, 1 / 60);
  },
});
