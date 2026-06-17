/**
 * physicsEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Numerical integration for the ball and all pins using a fixed-timestep
 * semi-implicit Euler scheme, aligned with Newton's Laws of Motion.
 *
 * Equations applied each tick (FIXED_DT = 1/120 s):
 *
 *  Ball (translational)
 *  ─────────────────────
 *  a_drag  = -(k / m) * |v| * v_hat          [quadratic drag]
 *  a_grav  = -g * ĵ                           [gravity]
 *  v(t+dt) = v(t) + (a_drag + a_grav) * dt   [semi-implicit Euler]
 *  x(t+dt) = x(t) + v(t+dt) * dt
 *
 *  Ball (rolling constraint – kinematic, not dynamic)
 *  ───────────────────────────────────────────────────
 *  ω = v_horiz / r    [rolling without slipping]
 *  θ += ω * dt
 *
 *  Pin (translational + rotational)
 *  ─────────────────────────────────
 *  v(t+dt) = (v(t) - g*ĵ*dt) * λ_lin         [gravity + linear damping]
 *  ω(t+dt) = ω(t) * λ_ang                     [angular damping]
 *  x(t+dt) = x(t) + v(t+dt) * dt
 *  q(t+dt) = normalise( q(t) * exp(ω*dt) )    [quaternion integration]
 *
 *  Ground / wall response uses coefficient of restitution (see constants).
 */

import * as THREE from "three";
import {
  GRAVITY,
  BALL_RADIUS,
  BALL_DAMPING,
  LANE_HALF_WIDTH,
  LANE_START_Z,
  PIN_LINEAR_DAMPING,
  PIN_ANGULAR_DAMPING,
  PIN_CAP_RADIUS,
  PIN_HALF_SEGMENT,
} from "../core/constants.js";
import { ball }  from "../entities/Ball.js";
import { pins }  from "../entities/Pins.js";
import { getActivePhysicsConfig } from "../core/game.js";
import { playBounceSfx }          from "../audio/audioEngine.js";

// ── Reusable temporaries (avoids GC pressure inside the tight loop) ──────────
const _up    = new THREE.Vector3();
const _axis  = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _spin  = new THREE.Quaternion();

// ── Ball integration ──────────────────────────────────────────────────────────
/**
 * Integrates the ball's position and orientation by one fixed timestep.
 * Forces applied:
 *   • Quadratic air drag:  F_drag = -k * |v| * v
 *   • Gravity:             F_grav = -m * g * ĵ
 *   • Rolling friction:    decelerates horizontal motion while on ground
 *   • Vertical restitution:  ball bounces on ground contact
 */
export function integrateBall(dt) {
  const config = getActivePhysicsConfig();

  // ── Aerodynamic drag  a = -(k/m)|v|v ──────────────────────────────────────
  const speed = ball.velocity.length();
  if (speed > 0.0001) {
    // k  = airDragCoeff (surface × launch-mode × ball-type composite)
    // a  = (k/m) * speed  (magnitude)
    const dragAccelScale = (config.airDragCoeff * speed) / ball.mass;
    ball.velocity.addScaledVector(ball.velocity, -dragAccelScale * dt);
  }

  // ── Gravity ────────────────────────────────────────────────────────────────
  const ySpeedBeforeGravity = ball.velocity.y;
  ball.velocity.y -= GRAVITY * dt;

  // ── Position update ────────────────────────────────────────────────────────
  ball.mesh.position.addScaledVector(ball.velocity, dt);

  // ── Ground collision (y = BALL_RADIUS) ───────────────────────────────────
  if (ball.mesh.position.y < BALL_RADIUS) {
    ball.mesh.position.y = BALL_RADIUS;

    if (ball.velocity.y < 0) {
      const impactSpeed = Math.abs(ySpeedBeforeGravity);
      // v_y_after = -e * v_y_before  (coefficient of restitution)
      ball.velocity.y *= -config.groundRebound;

      if (impactSpeed > 0.55) playBounceSfx(impactSpeed);

      // Damp out micro-bounces
      if (Math.abs(ball.velocity.y) < 0.18) ball.velocity.y = 0;
    }

    // Rolling friction on ground: Δv = -μ * g * dt  per step
    const horizSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (horizSpeed > 0) {
      const speedDrop = config.rollingFriction * GRAVITY * dt;
      const newSpeed  = Math.max(0, horizSpeed - speedDrop);
      const scale     = newSpeed / horizSpeed;
      ball.velocity.x *= scale * config.surfaceType.groundDamping;
      ball.velocity.z *= scale * config.surfaceType.groundDamping;
    }
  }

  // ── Residual linear damping (air + lane resistance) ───────────────────────
  ball.velocity.x *= BALL_DAMPING;
  ball.velocity.z *= BALL_DAMPING;
  if (Math.abs(ball.velocity.y) < 0.0005) ball.velocity.y = 0;

  // ── Rolling rotation (kinematic constraint: ω = v_horiz / r) ─────────────
  const horizSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
  if (horizSpeed > 0.0001) {
    const rollAngle = (horizSpeed * dt) / BALL_RADIUS;
    // Rotation axis is perpendicular to motion in the horizontal plane
    _axis.set(ball.velocity.z, 0, -ball.velocity.x).normalize();
    _spin.setFromAxisAngle(_axis, rollAngle);
    ball.mesh.quaternion.premultiply(_spin).normalize();
  }
}

// ── Pin integration ────────────────────────────────────────────────────────────
/**
 * Integrates each active pin's position and orientation by one fixed timestep.
 * Frame-rate independent damping: λ = base^(dt*60)
 *   • This ensures the damping is independent of the chosen FIXED_DT.
 */
export function integratePins(dt) {
  const linearDecay  = Math.pow(PIN_LINEAR_DAMPING,  dt * 60);
  const angularDecay = Math.pow(PIN_ANGULAR_DAMPING, dt * 60);

  for (const pin of pins) {
    if (!pin.active) continue;

    // ── Gravity ──────────────────────────────────────────────────────────────
    pin.velocity.y -= GRAVITY * dt;

    // ── Position update ───────────────────────────────────────────────────────
    pin.mesh.position.addScaledVector(pin.velocity, dt);

    // ── Linear damping ────────────────────────────────────────────────────────
    pin.velocity.multiplyScalar(linearDecay);

    // ── Rotational integration  q' = normalise(q * exp(ω * dt)) ─────────────
    const angSpeed = pin.angularVelocity.length();
    if (angSpeed > 0) {
      _axis.copy(pin.angularVelocity).normalize();
      _quat.setFromAxisAngle(_axis, angSpeed * dt);
      pin.mesh.quaternion.premultiply(_quat).normalize();
    }

    // ── Angular damping ────────────────────────────────────────────────────────
    pin.angularVelocity.multiplyScalar(angularDecay);

    // ── Lateral boundary (lane gutters) ──────────────────────────────────────
    if (pin.mesh.position.x >  LANE_HALF_WIDTH + 0.35) {
      pin.mesh.position.x = LANE_HALF_WIDTH + 0.35;
      pin.velocity.x *= -0.2;
    }
    if (pin.mesh.position.x < -(LANE_HALF_WIDTH + 0.35)) {
      pin.mesh.position.x = -(LANE_HALF_WIDTH + 0.35);
      pin.velocity.x *= -0.2;
    }

    // ── Ground floor collision ─────────────────────────────────────────────
    // Dynamic resting height depends on tilt angle via the up-vector projection.
    _up.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const bottomHeight = (PIN_CAP_RADIUS + PIN_HALF_SEGMENT) * Math.abs(_up.y);

    if (pin.mesh.position.y < bottomHeight) {
      pin.mesh.position.y = bottomHeight;
      if (pin.velocity.y < 0) {
        pin.velocity.y *= -0.15;
        if (Math.abs(pin.velocity.y) < 0.1) pin.velocity.y = 0;
      }
      pin.velocity.x *= 0.97;
      pin.velocity.z *= 0.97;
    }

    // ── Sleep threshold ───────────────────────────────────────────────────────
    if (pin.velocity.lengthSq()        < 0.00008) pin.velocity.set(0, 0, 0);
    if (pin.angularVelocity.lengthSq() < 0.0001)  pin.angularVelocity.set(0, 0, 0);
  }
}

// ── Throw lifecycle evaluation ────────────────────────────────────────────────
/**
 * Checks whether all active pins have come to rest (all below sleep threshold).
 * @returns {boolean}
 */
export function pinsSleeping() {
  for (const pin of pins) {
    if (!pin.active) continue;
    if (pin.velocity.lengthSq() > 0.0012) return false;
    if (pin.angularVelocity.lengthSq() > 0.02) return false;
  }
  return true;
}
