/**
 * Pins.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the 10 bowling pins in a standard triangular rack.
 *
 * CRS layout:
 *   Row 0 (head pin) → z = PIN_HEAD_Z = -34.0 m
 *   Each successive row is +spacingZ further in -Z.
 */

import * as THREE from "three";
import {
  PIN_HEAD_Z,
  PIN_MASS,
  PIN_COLLIDER_RADIUS,
  PIN_CAP_RADIUS,
  PIN_HALF_SEGMENT,
} from "../core/constants.js";
import { scene } from "../core/engine.js";

// ── Shared pin materials ──────────────────────────────────────────────────────
const pinBodyMaterial = new THREE.MeshStandardMaterial({
  color:     0xf5f5f0,
  roughness: 0.35,
  metalness: 0.15,
});

const pinStripeMaterial = new THREE.MeshStandardMaterial({
  color:     0xcd3b2f,
  roughness: 0.45,
  metalness: 0.1,
});

// ── Pin visual factory ────────────────────────────────────────────────────────
function makePinMesh() {
  const group = new THREE.Group();
  group.scale.setScalar(0.72);

  // Lathe profile for the classic bowling-pin silhouette
  const points = [
    new THREE.Vector2(0.00, -0.55),
    new THREE.Vector2(0.11, -0.52),
    new THREE.Vector2(0.16, -0.42),
    new THREE.Vector2(0.18, -0.25),
    new THREE.Vector2(0.14, -0.05),
    new THREE.Vector2(0.10,  0.15),
    new THREE.Vector2(0.12,  0.32),
    new THREE.Vector2(0.09,  0.48),
    new THREE.Vector2(0.06,  0.62),
    new THREE.Vector2(0.07,  0.78),
    new THREE.Vector2(0.05,  0.90),
    new THREE.Vector2(0.00,  0.95),
  ];

  const body = new THREE.Mesh(
    new THREE.LatheGeometry(points, 32),
    pinBodyMaterial
  );
  body.castShadow   = true;
  body.receiveShadow = true;
  group.add(body);

  const stripe1 = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.018, 12, 32),
    pinStripeMaterial
  );
  stripe1.rotation.x = Math.PI / 2;
  stripe1.position.y = 0.28;
  group.add(stripe1);

  const stripe2 = stripe1.clone();
  stripe2.position.y = 0.18;
  group.add(stripe2);

  return group;
}

// ── Pin rack creation ─────────────────────────────────────────────────────────
/** @type {Array<PinBody>} */
export const pins = [];

export function createPins() {
  const spacingX = 0.58;
  const spacingZ = 0.62;   // positive offset per row (each row further in -Z)
  let   idCounter = 1;

  // 4-row standard rack (1-2-3-4 arrangement)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col <= row; col++) {
      const x = (col - row * 0.5) * spacingX;
      const z = PIN_HEAD_Z - row * spacingZ;  // each row deeper in -Z
      const y = 0.48;                          // resting height above lane

      const mesh = makePinMesh();
      mesh.position.set(x, y, z);
      scene.add(mesh);

      pins.push({
        id:            idCounter,
        mesh,
        velocity:       new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        mass:           PIN_MASS,
        invMass:        1 / PIN_MASS,
        radius:         PIN_COLLIDER_RADIUS,
        knocked:        false,
        active:         true,
        spawnPosition:  new THREE.Vector3(x, y, z),
      });

      idCounter++;
    }
  }
}

/**
 * @typedef {Object} PinBody
 * @property {number}        id
 * @property {THREE.Group}   mesh
 * @property {THREE.Vector3} velocity
 * @property {THREE.Vector3} angularVelocity
 * @property {number}        mass
 * @property {number}        invMass
 * @property {number}        radius
 * @property {boolean}       knocked
 * @property {boolean}       active
 * @property {THREE.Vector3} spawnPosition
 */
