/**
 * camera.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Smooth camera controller.
 *
 * CRS alignment:
 *   Aim-phase target looks toward PIN_HEAD_Z = -34.0 m.
 *   The follow camera trails the ball down the negative Z axis.
 */

import * as THREE from "three";
import { AIM_CAM_POS, PIN_HEAD_Z } from "../core/constants.js";
import { session, aim, GAME_STATE } from "../core/state.js";
import { ball }   from "../entities/Ball.js";
import { camera } from "../core/engine.js";
import { getActivePhysicsConfig } from "../core/game.js";

// Persistent follow direction (updated only while ball is moving)
const followDir = new THREE.Vector3(0, 0, -1);

const _camTarget  = new THREE.Vector3();
const _camPos     = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export function updateCamera() {
  // ── AIMING / CHARGING ──────────────────────────────────────────────────────
  if (
    session.gameState === GAME_STATE.AIMING ||
    session.gameState === GAME_STATE.CHARGING
  ) {
    const config  = getActivePhysicsConfig();
    // Look-at point shifts horizontally with aim angle
    const targetX = Math.sin(aim.angle) * 8;
    _camTarget.set(targetX, 0.55 + config.launchMode.spawnHeight * 0.1, PIN_HEAD_Z + 1.2);

    // Camera position: anchor from constants, adjusted for launch height
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

    // Update follow direction only when ball is moving appreciably
    if (horizSpeed > 0.1) {
      followDir.set(ball.velocity.x, 0, ball.velocity.z).normalize();
    }

    // Camera trails 5.3 m behind the ball, elevated 2 m above it
    _camPos.copy(followDir).multiplyScalar(-5.3);
    _camPos.y  = ball.mesh.position.y + 2;
    _camPos.add(ball.mesh.position);

    camera.position.lerp(_camPos, 0.08);

    // Look ahead of the ball along travel direction
    _lookTarget.copy(ball.mesh.position);
    _lookTarget.addScaledVector(followDir, 2.2);
    _lookTarget.y += 0.55;
    camera.lookAt(_lookTarget);
    return;
  }

  // ── GAMEOVER / default ─────────────────────────────────────────────────────
  _camPos.set(0, 4.2, 6.5);
  camera.position.lerp(_camPos, 0.03);
  camera.lookAt(0, 0.6, -13);
}
