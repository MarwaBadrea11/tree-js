/**
 * Ball.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the bowling-ball Three.js Group, its visual sub-meshes, and exports
 * the physics body descriptor that the engine operates on.
 *
 * The ball spawns at BALL_START = (0, 0.33, -1.1) which places it at the
 * approach area just behind the CRS origin (LANE_START_Z = 0.0).
 */

import * as THREE from "three";
import {
  BALL_RADIUS,
  BALL_START,
  DEFAULT_BALL_MASS,
} from "../core/constants.js";
import { scene } from "../core/engine.js";

// ── Visual geometry ───────────────────────────────────────────────────────────
const ballGroup = new THREE.Group();

export const ballBodyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_RADIUS, 48, 36),
  new THREE.MeshStandardMaterial({
    color:     0x1d5f8f,
    roughness: 0.2,
    metalness: 0.3,
  })
);
ballBodyMesh.castShadow = true;
ballGroup.add(ballBodyMesh);

const ballStripeMaterial = new THREE.MeshStandardMaterial({
  color:     0x000000,
  roughness: 0.32,
  metalness: 0.98,
});

const equatorStripe = new THREE.Mesh(
  new THREE.TorusGeometry(BALL_RADIUS * 0.82, 0.022, 14, 64),
  ballStripeMaterial
);
equatorStripe.rotation.x = Math.PI / 2;
ballGroup.add(equatorStripe);

const meridianStripe = equatorStripe.clone();
meridianStripe.rotation.set(0, 0, Math.PI / 2);
ballGroup.add(meridianStripe);

const fingerHoleMaterial = new THREE.MeshStandardMaterial({
  color:     0x0f1720,
  roughness: 0.9,
  metalness: 0.02,
});

for (const offset of [-0.06, 0.06, 0.18]) {
  const hole = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 8),
    fingerHoleMaterial
  );
  hole.position.set(offset, BALL_RADIUS * 0.36, BALL_RADIUS * 0.79);
  ballGroup.add(hole);
}

ballGroup.position.copy(BALL_START);
scene.add(ballGroup);

// ── Physics body ──────────────────────────────────────────────────────────────
/**
 * @typedef {Object} BallBody
 * @property {THREE.Group}   mesh      - Three.js group (transform source of truth)
 * @property {THREE.Mesh}    bodyMesh  - The main sphere mesh (for material swaps)
 * @property {THREE.Vector3} velocity  - Linear velocity  (m/s)
 * @property {number}        mass      - Current mass (kg)
 * @property {number}        invMass   - 1 / mass
 * @property {number}        radius    - Collision radius (m)
 */
export const ball = {
  mesh:     ballGroup,
  bodyMesh: ballBodyMesh,
  velocity: new THREE.Vector3(),
  mass:     DEFAULT_BALL_MASS,
  invMass:  1 / DEFAULT_BALL_MASS,
  radius:   BALL_RADIUS,
};
