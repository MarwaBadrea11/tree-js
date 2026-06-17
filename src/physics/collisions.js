/**
 * collisions.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All collision detection and impulse resolution routines.
 *
 * Physics model:
 *   Sphere–sphere contact resolved by the generalised impulse law:
 *
 *     j  = -(1 + e) * (v_rel · n̂)
 *          ────────────────────────
 *              1/m_A + 1/m_B
 *
 *   where  e   = coefficient of restitution
 *          n̂  = contact normal (unit)
 *          v_rel = v_B − v_A
 *
 *   Tangential (friction) impulse is clamped by Coulomb's law:
 *     |j_t| ≤ μ * |j_n|
 *
 *   Angular velocity change from contact (tipping torque):
 *     Δω = (j / I) * (r̂ × n̂)
 *   For a solid sphere  I = (2/5) * m * r²,  but we fold this into the
 *   empirical tipStrength coefficients to keep the simulation tunable.
 */

import * as THREE from "three";
import {
  LANE_HALF_WIDTH,
  LANE_START_Z,
  WALL_RESTITUTION,
  BALL_PIN_RESTITUTION,
  PIN_PIN_RESTITUTION,
  CONTACT_FRICTION,
  KNOCK_ANGLE,
} from "../core/constants.js";
import { ball }                   from "../entities/Ball.js";
import { pins }                   from "../entities/Pins.js";
import { getActivePhysicsConfig } from "../core/game.js";
import { playImpactSfx, playWallHitSfx } from "../audio/audioEngine.js";
import { clamp }                  from "../core/game.js";

// ── Reusable temporaries ──────────────────────────────────────────────────────
const _n   = new THREE.Vector3();  // contact normal
const _vr  = new THREE.Vector3();  // relative velocity
const _t   = new THREE.Vector3();  // tangent direction
const _imp = new THREE.Vector3();  // impulse vector
const _hN  = new THREE.Vector3();  // horizontal normal
const _ax  = new THREE.Vector3();  // tipping axis

// ── Generic sphere–sphere contact resolver ─────────────────────────────────────
/**
 * Resolves a sphere–sphere contact in-place, modifying positions and velocities.
 *
 * @param {THREE.Vector3} posA
 * @param {THREE.Vector3} velA
 * @param {number} invMassA
 * @param {number} radiusA
 * @param {THREE.Vector3} posB
 * @param {THREE.Vector3} velB
 * @param {number} invMassB
 * @param {number} radiusB
 * @param {number} restitution  - e (coefficient of restitution)
 * @param {number} friction     - μ (Coulomb friction coefficient)
 * @returns {{ normal: THREE.Vector3, impulse: number } | null}
 */
export function resolveSphereContact(
  posA, velA, invMassA, radiusA,
  posB, velB, invMassB, radiusB,
  restitution,
  friction
) {
  _n.subVectors(posB, posA);
  let dist = _n.length();
  const minDist = radiusA + radiusB;

  if (dist >= minDist) return null;  // no overlap → no collision

  // Handle degenerate zero-distance case
  if (dist < 1e-5) { _n.set(1, 0, 0); dist = 1; }

  // Contact normal  n̂  (A → B)
  _n.multiplyScalar(1 / dist);

  const penetration = minDist - dist;
  const invMassSum  = invMassA + invMassB;
  if (invMassSum <= 0) return null;

  // ── Positional correction (Baumgarte-style projection) ──────────────────
  const correction = penetration / invMassSum;
  posA.addScaledVector(_n, -correction * invMassA);
  posB.addScaledVector(_n,  correction * invMassB);

  // ── Normal impulse ────────────────────────────────────────────────────────
  _vr.subVectors(velB, velA);
  const normalSpeed = _vr.dot(_n);

  let jNormal = 0;
  if (normalSpeed < 0) {
    //   j = -(1 + e) * (v_rel · n̂) / (1/m_A + 1/m_B)
    jNormal = (-(1 + restitution) * normalSpeed) / invMassSum;

    _imp.copy(_n).multiplyScalar(jNormal);
    velA.addScaledVector(_imp, -invMassA);
    velB.addScaledVector(_imp,  invMassB);

    // ── Friction (Coulomb-clamped tangential impulse) ─────────────────────
    _t.copy(_vr).addScaledVector(_n, -normalSpeed);  // tangential component of v_rel
    const tangentLen = _t.length();
    if (tangentLen > 1e-5) {
      _t.multiplyScalar(1 / tangentLen);
      let jTangent = -_vr.dot(_t) / invMassSum;
      jTangent = clamp(jTangent, -jNormal * friction, jNormal * friction);

      _imp.copy(_t).multiplyScalar(jTangent);
      velA.addScaledVector(_imp, -invMassA);
      velB.addScaledVector(_imp,  invMassB);
    }
  }

  return { normal: _n.clone(), impulse: jNormal };
}

// ── Ball ↔ Wall / Gutter ───────────────────────────────────────────────────────
/**
 * Keeps the ball within lane bounds.
 * Back wall uses a soft pushback (no re-entry past start line + margin).
 */
export function solveBallWallCollision() {
  const limit = LANE_HALF_WIDTH - ball.radius;

  // Left wall
  if (ball.mesh.position.x > limit) {
    const hitSpeed = Math.abs(ball.velocity.x);
    ball.mesh.position.x = limit;
    if (ball.velocity.x > 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
      if (hitSpeed > 0.4) playWallHitSfx(hitSpeed);
    }
  }

  // Right wall
  if (ball.mesh.position.x < -limit) {
    const hitSpeed = Math.abs(ball.velocity.x);
    ball.mesh.position.x = -limit;
    if (ball.velocity.x < 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
      if (hitSpeed > 0.4) playWallHitSfx(hitSpeed);
    }
  }

  // Back wall  (CRS: ball should never travel back past LANE_START_Z + margin)
  if (ball.mesh.position.z > LANE_START_Z + 0.8) {
    const hitSpeed = Math.abs(ball.velocity.z);
    ball.mesh.position.z = LANE_START_Z + 0.8;
    if (ball.velocity.z > 0) {
      ball.velocity.z *= -0.2;
      if (hitSpeed > 0.7) playWallHitSfx(hitSpeed);
    }
  }
}

// ── Ball ↔ Pin ─────────────────────────────────────────────────────────────────
/**
 * Iterates all active pins and resolves sphere–sphere contacts with the ball.
 * After the impulse the pin receives a tipping angular-velocity component:
 *   Δω = tipStrength * (n̂_horiz × ĵ)
 */
export function solveBallPinCollisions() {
  const config = getActivePhysicsConfig();

  for (const pin of pins) {
    if (!pin.active) continue;

    const result = resolveSphereContact(
      ball.mesh.position, ball.velocity, ball.invMass, ball.radius,
      pin.mesh.position,  pin.velocity,  pin.invMass,  pin.radius,
      BALL_PIN_RESTITUTION,
      CONTACT_FRICTION
    );

    if (!result) continue;

    playImpactSfx(result.impulse * 0.08);

    // Tipping torque – rotate pin away from contact
    _hN.copy(result.normal);
    _hN.y = 0;
    if (_hN.lengthSq() > 0.00001) {
      _hN.normalize();
      const tipAxis     = _ax.set(_hN.z, 0, -_hN.x).normalize();
      const tipStrength = result.impulse * 0.9 * config.impactMultiplier;
      pin.angularVelocity.addScaledVector(tipAxis, tipStrength);
      pin.angularVelocity.y += (Math.random() - 0.5) * 0.18;  // slight yaw spin
    }
  }
}

// ── Pin ↔ Pin ─────────────────────────────────────────────────────────────────
/**
 * Resolves all pair-wise pin–pin sphere contacts.
 * The tipping contribution is symmetric: pins exchange angular kicks.
 */
export function solvePinPinCollisions() {
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    if (!a.active) continue;

    for (let j = i + 1; j < pins.length; j++) {
      const b = pins[j];
      if (!b.active) continue;

      const result = resolveSphereContact(
        a.mesh.position, a.velocity, a.invMass, a.radius,
        b.mesh.position, b.velocity, b.invMass, b.radius,
        PIN_PIN_RESTITUTION,
        CONTACT_FRICTION * 0.8
      );

      if (!result) continue;

      _hN.copy(result.normal);
      _hN.y = 0;
      if (_hN.lengthSq() > 0.00001) {
        _hN.normalize();
        const axisA = _ax.set(_hN.z, 0, -_hN.x).normalize();
        const tipStrength = result.impulse * 0.55;
        a.angularVelocity.addScaledVector(axisA,                        tipStrength);
        b.angularVelocity.addScaledVector(axisA.clone().multiplyScalar(-1), tipStrength);
      }
    }
  }
}

// ── Knock-down evaluation ─────────────────────────────────────────────────────
/**
 * Marks a pin as knocked when its tilt exceeds KNOCK_ANGLE (15°).
 * tilt = acos(|up · ĵ|)  where up is the pin's local +Y axis in world space.
 */
export function markKnockedPins() {
  const _upVec = new THREE.Vector3();

  for (const pin of pins) {
    if (!pin.active || pin.knocked) continue;

    _upVec.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const tilt = Math.acos(clamp(_upVec.y, -1, 1));

    if (tilt > KNOCK_ANGLE) pin.knocked = true;
  }
}
