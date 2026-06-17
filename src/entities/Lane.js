/**
 * Lane.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedurally builds the bowling lane, gutters, approach area, pin-deck
 * highlight, and room floor and adds them to the scene.
 *
 * CRS note: lane runs from LANE_START_Z = 0.0 m  →  LANE_END_Z = -37.9 m
 *           along the negative Z axis.
 */

import * as THREE from "three";
import {
  LANE_HALF_WIDTH,
  LANE_START_Z,
  LANE_END_Z,
  PIN_HEAD_Z,
  SURFACE_TYPES,
} from "../core/constants.js";
import { scene } from "../core/engine.js";

/** References to meshes whose materials are swapped on surface-type changes. */
export const environmentVisuals = {
  lane:      null,
  roomFloor: null,
};

export function createLane() {
  const laneLength  = LANE_START_Z - LANE_END_Z;          // positive scalar
  const laneCenterZ = (LANE_START_Z + LANE_END_Z) * 0.5;  // ≈ -18.95

  // ── Main lane surface ────────────────────────────────────────────────────
  const laneMaterial = new THREE.MeshStandardMaterial({
    color:     SURFACE_TYPES.normal.laneColor,
    roughness: 0.4,
    metalness: 0.07,
  });

  const lane = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_HALF_WIDTH * 2, 0.08, laneLength),
    laneMaterial
  );
  lane.position.set(0, -0.04, laneCenterZ);
  lane.receiveShadow = true;
  scene.add(lane);
  environmentVisuals.lane = lane;

  // ── Approach area (sits behind the start line, i.e. at positive Z) ───────
  // Approach is placed at Z = LANE_START_Z + 2.5 = 2.5 m in front of origin
  const approach = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.08, 6),
    new THREE.MeshStandardMaterial({
      color:     0x9f764c,
      roughness: 0.45,
      metalness: 0.04,
    })
  );
  approach.position.set(0, -0.04, LANE_START_Z + 2.5);
  approach.receiveShadow = true;
  scene.add(approach);

  // ── Side gutters ──────────────────────────────────────────────────────────
  const sideMaterial = new THREE.MeshStandardMaterial({
    color:     0x373d45,
    roughness: 0.0,
    metalness: 0.15,
  });

  for (const side of [-1, 1]) {
    const gutter = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, laneLength),
      sideMaterial
    );
    gutter.position.set(side * (LANE_HALF_WIDTH + 0.24), -0.08, laneCenterZ);
    gutter.receiveShadow = true;
    scene.add(gutter);
  }

  // ── Pin-deck highlight ─────────────────────────────────────────────────────
  const pinDeck = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.08, 2.2),
    new THREE.MeshStandardMaterial({
      color:     0xc79a67,
      roughness: 0.18,
      metalness: 0.06,
    })
  );
  // PIN_HEAD_Z = -34.0  →  centre at PIN_HEAD_Z + 0.6 = -33.4
  pinDeck.position.set(0, -0.04, PIN_HEAD_Z + 0.6);
  pinDeck.receiveShadow = true;
  scene.add(pinDeck);

  // ── Room floor ────────────────────────────────────────────────────────────
  const roomFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      color:     SURFACE_TYPES.normal.roomColor,
      roughness: 1,
      metalness: 0,
    })
  );
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.position.y = -0.09;
  roomFloor.receiveShadow = true;
  scene.add(roomFloor);
  environmentVisuals.roomFloor = roomFloor;
}
