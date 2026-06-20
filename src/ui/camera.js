/**
 * camera.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Smooth camera controller with side-view support.
 *
 * CRS alignment:
 *   Aim-phase target looks toward PIN_HEAD_Z = -34.0 m.
 *   The follow camera trails the ball down the negative Z axis.
 *
 * Camera modes (toggle with keys 1 / 2 / 3):
 *   DEFAULT    – rear-follow camera (original behaviour)
 *   SIDE_LEFT  – camera on the left side of the lane, tracking the ball
 *   SIDE_RIGHT – camera on the right side of the lane, tracking the ball
 */

import * as THREE from "three";
import { AIM_CAM_POS, PIN_HEAD_Z } from "../core/constants.js";
import { session, aim, GAME_STATE } from "../core/state.js";
import { ball }   from "../entities/Ball.js";
import { camera } from "../core/engine.js";
import { getActivePhysicsConfig } from "../core/game.js";

// ── Camera mode constants ─────────────────────────────────────────────────────
export const CAMERA_MODES = Object.freeze({
  DEFAULT:    "default",
  SIDE_LEFT:  "left",
  SIDE_RIGHT: "right",
});

/** Currently active camera mode. Updated by input.js. */
export let currentCameraMode = CAMERA_MODES.DEFAULT;

/** Call from input.js to switch modes at runtime. */
export function setCameraMode(mode) {
  if (Object.values(CAMERA_MODES).includes(mode)) {
    currentCameraMode = mode;
  }
}

// ── Side-view configuration ───────────────────────────────────────────────────
// Distance from the lane centre-line to the side cameras (X axis).
const SIDE_CAM_X       =  9.0;   // metres to either side
const SIDE_CAM_Y       =  3.2;   // height above the lane floor
// How tightly the side camera lerps to the new position each frame.
const SIDE_LERP_ALPHA  =  0.10;

// ── Persistent follow direction (updated only while ball is moving) ───────────
const followDir = new THREE.Vector3(0, 0, -1);

const _camTarget  = new THREE.Vector3();
const _camPos     = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export function updateCamera() {
  // ── AIMING / CHARGING ──────────────────────────────────────────────────────
  // Side-view doesn't apply during aim; always use the default aim camera.
  if (
    session.gameState === GAME_STATE.AIMING ||
    session.gameState === GAME_STATE.CHARGING
  ) {
    const config  = getActivePhysicsConfig();
    const targetX = Math.sin(aim.angle) * 8;
    _camTarget.set(targetX, 0.55 + config.launchMode.spawnHeight * 0.1, PIN_HEAD_Z + 1.2);

    _camPos.copy(AIM_CAM_POS);
    _camPos.y += config.launchMode.spawnHeight * 0.32;

    camera.position.lerp(_camPos, 0.1);
    camera.lookAt(_camTarget);
    return;
  }

  // ── ROLLING / SETTLING ─────────────────────────────────────────────────────
  if (
    session.gameState === GAME_STATE.ROLLING ||
    session.gameState === GAME_STATE.SETTLING
  ) {
    const horizSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);

    // Update follow direction only when ball is moving appreciably.
    if (horizSpeed > 0.1) {
      followDir.set(ball.velocity.x, 0, ball.velocity.z).normalize();
    }

    if (currentCameraMode === CAMERA_MODES.SIDE_LEFT) {
      // ── LEFT side-view ──────────────────────────────────────────────────────
      // Camera sits to the left of the lane (negative X) and tracks the ball's
      // Z position so it stays abreast of the ball as it rolls down the lane.
      _camPos.set(
        -SIDE_CAM_X,
        SIDE_CAM_Y,
        ball.mesh.position.z   // stay alongside the ball on Z
      );
      camera.position.lerp(_camPos, SIDE_LERP_ALPHA);
      camera.lookAt(ball.mesh.position);
      return;
    }

    if (currentCameraMode === CAMERA_MODES.SIDE_RIGHT) {
      // ── RIGHT side-view ─────────────────────────────────────────────────────
      // Mirror of SIDE_LEFT — camera sits to the right (positive X).
      _camPos.set(
        SIDE_CAM_X,
        SIDE_CAM_Y,
        ball.mesh.position.z
      );
      camera.position.lerp(_camPos, SIDE_LERP_ALPHA);
      camera.lookAt(ball.mesh.position);
      return;
    }

    // ── DEFAULT rear-follow view ────────────────────────────────────────────
    _camPos.copy(followDir).multiplyScalar(-5.3);
    _camPos.y  = ball.mesh.position.y + 2;
    _camPos.add(ball.mesh.position);

    camera.position.lerp(_camPos, 0.08);

    _lookTarget.copy(ball.mesh.position);
    _lookTarget.addScaledVector(followDir, 2.2);
    _lookTarget.y += 0.55;
    camera.lookAt(_lookTarget);
    return;
  }

  // ── GAMEOVER / default ─────────────────────────────────────────────────────
  _camPos.copy(AIM_CAM_POS);
  _camPos.y += 1.2;
  camera.position.lerp(_camPos, 0.05);
  camera.lookAt(0, 0, -8);
}
