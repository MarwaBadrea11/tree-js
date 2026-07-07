import * as THREE from "three";
import {
  LANE_START_Z,
  BALL_PIN_RESTITUTION,
  PIN_PIN_RESTITUTION,
  CONTACT_FRICTION,
  KNOCK_ANGLE,
} from "../core/constants.js";
import { ball } from "../entities/Ball.js";
import { pins } from "../entities/Pins.js";
import { getActivePhysicsConfig } from "../core/game.js";
import { playImpactSfx, playWallHitSfx } from "../audio/audioEngine.js";
import { clamp } from "../core/game.js";
import { session } from "../core/state.js";

const _n = new THREE.Vector3();
const _vr = new THREE.Vector3();
const _t = new THREE.Vector3();
const _imp = new THREE.Vector3();
const _hN = new THREE.Vector3();
const _ax = new THREE.Vector3();

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * SPHERE COLLISION RESOLUTION - Conservation of Linear Momentum
 * ═════════════════════════════════════════════════════════════════════════════
 * Implements strict physics-based collision response with:
 * - Conservation of momentum along collision normal
 * - Restitution coefficient for energy loss modeling
 * - Coulomb friction model for tangential forces
 * - Position correction to prevent tunneling
 * 
 * @param {THREE.Vector3} posA - Position of body A
 * @param {THREE.Vector3} velA - Velocity of body A
 * @param {number} invMassA - Inverse mass of body A (1/mass)
 * @param {number} radiusA - Collision radius of body A
 * @param {THREE.Vector3} posB - Position of body B
 * @param {THREE.Vector3} velB - Velocity of body B
 * @param {number} invMassB - Inverse mass of body B (1/mass)
 * @param {number} radiusB - Collision radius of body B
 * @param {number} restitution - Coefficient of restitution (0-1)
 * @param {number} friction - Friction coefficient for tangential forces
 * @returns {{normal: THREE.Vector3, impulse: number}|null}
 */
export function resolveSphereContact(
  posA, velA, invMassA, radiusA,
  posB, velB, invMassB, radiusB,
  restitution,
  friction
) {
  // ── Step 1: Compute collision normal and check for contact ────────────────
  _n.subVectors(posB, posA);
  let dist = _n.length();
  const minDist = radiusA + radiusB;
  const collisionMargin = 0.01;  // Tight margin for precise detection

  // Early exit if spheres are not in contact
  if (dist >= minDist + collisionMargin) return null;

  // Handle degenerate case (overlapping centers)
  if (dist < 1e-6) { 
    _n.set(1, 0, 0); 
    dist = 1e-6; 
  }

  // Normalize collision normal
  _n.multiplyScalar(1 / dist);

  const penetration = minDist - dist;
  const invMassSum = invMassA + invMassB;
  if (invMassSum <= 0) return null;  // Immovable collision

  // ── Step 2: Compute relative velocity and normal impulse ──────────────────
  _vr.subVectors(velB, velA);
  const normalSpeed = _vr.dot(_n);

  let jNormal = 0;
  
  // Only resolve if objects are approaching (normalSpeed < 0)
  if (normalSpeed < -0.001) {
    // Conservation of momentum with restitution:
    // j = -(1 + e) * v_rel · n / (1/m_A + 1/m_B)
    jNormal = (-(1 + restitution) * normalSpeed) / invMassSum;

    // Apply normal impulse (velocity update)
    _imp.copy(_n).multiplyScalar(jNormal);
    velA.addScaledVector(_imp, -invMassA);
    velB.addScaledVector(_imp, invMassB);

    // ── Step 3: Friction (Tangential force) ─────────────────────────────────
    // Compute tangent direction (perpendicular to normal in velocity plane)
    _t.copy(_vr).addScaledVector(_n, -normalSpeed);
    const tangentLen = _t.length();
    
    if (tangentLen > 1e-6) {
      _t.multiplyScalar(1 / tangentLen);
      
      // Coulomb friction model: F_friction = μ * F_normal
      // For Pin-to-Pin collisions, model friction via damping coefficient
      let jTangent = -_vr.dot(_t) / invMassSum;
      
      // Clamp tangential impulse by friction cone
      jTangent = clamp(jTangent, -jNormal * friction, jNormal * friction);

      _imp.copy(_t).multiplyScalar(jTangent);
      velA.addScaledVector(_imp, -invMassA);
      velB.addScaledVector(_imp, invMassB);
    }
  }

  // ── Step 4: Position correction (prevent tunneling) ───────────────────────
  // Baumgarte stabilization to resolve penetration
  const CORRECTION_PERCENT = 0.4;  // Aggressive correction for stability
  const SLOP = 0.001;  // Small penetration tolerance
  const correctionMag = Math.max(penetration - SLOP, 0) * CORRECTION_PERCENT / invMassSum;
  
  posA.addScaledVector(_n, -correctionMag * invMassA);
  posB.addScaledVector(_n, correctionMag * invMassB);

  return { normal: _n.clone(), impulse: jNormal };
}

export function solveBallWallCollision() {
  if (ball.mesh.position.z > LANE_START_Z + 0.8) {
    const hitSpeed = Math.abs(ball.velocity.z);
    ball.mesh.position.z = LANE_START_Z + 0.8;
    if (ball.velocity.z > 0) {
      ball.velocity.z *= -0.2;
      if (hitSpeed > 0.7) playWallHitSfx(hitSpeed);
    }
  }
}

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * BALL-TO-PIN COLLISION SOLVER
 * ═════════════════════════════════════════════════════════════════════════════
 * Resolves collisions between the bowling ball and pins using:
 * - Restitution coefficient: 0.22 (Ball-to-Pin energy retention)
 * - Angular impulse transfer for realistic tipping motion
 * - Contact point torque calculation
 */
export function solveBallPinCollisions() {
  const config = getActivePhysicsConfig();

  for (const pin of pins) {
    if (!pin.active) continue;

    const result = resolveSphereContact(
      ball.mesh.position, ball.velocity, ball.invMass, ball.radius,
      pin.mesh.position, pin.velocity, pin.invMass, pin.radius,
      BALL_PIN_RESTITUTION,  // e = 0.22 for Ball-to-Pin
      CONTACT_FRICTION
    );

    if (!result) continue;

    if (!session.ballContactedPins) {
      session.ballContactedPins = true;
    }

    playImpactSfx(result.impulse * 0.08);

    // ── Angular impulse transfer (torque from impact) ─────────────────────
    // Compute horizontal component of collision normal for tipping
    _hN.copy(result.normal);
    _hN.y = 0;
    
    if (_hN.lengthSq() > 1e-8) {
      _hN.normalize();
      
      // Torque axis: perpendicular to horizontal normal (cross product with Y)
      // τ = r × F, where r is contact point offset
      const tipAxis = _ax.set(_hN.z, 0, -_hN.x).normalize();
      
      // Torque magnitude proportional to impulse and impact multiplier
      const torqueFactor = 0.75;
      const tipStrength = result.impulse * torqueFactor * config.impactMultiplier * pin.invMass;
      
      pin.angularVelocity.addScaledVector(tipAxis, tipStrength);
      
      // Add slight random tumble for natural variation
      pin.angularVelocity.y += (Math.random() - 0.5) * 0.25;
      pin.angularVelocity.x += (Math.random() - 0.5) * 0.12;
    }
    
    // ── Low-impulse contact handling (grazing collisions) ─────────────────
    const minImpulseThreshold = 0.05;
    if (result.impulse < minImpulseThreshold) {
      const staticBreak = 0.25;
      pin.velocity.addScaledVector(result.normal, staticBreak);
      
      if (pin.angularVelocity.length() < 0.05) {
        pin.angularVelocity.y += (Math.random() - 0.5) * 0.15;
      }
    }
  }
}

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * PIN-TO-PIN COLLISION SOLVER (Chain Reactions)
 * ═════════════════════════════════════════════════════════════════════════════
 * Resolves collisions between pins using:
 * - Restitution coefficient: 0.18 (Pin-to-Pin energy retention)
 * - Friction modeling via damping against relative velocity
 * - Mutual angular impulse transfer for realistic tumbling
 * 
 * Friction force approximation:
 *   F_friction = c_damping × v_relative
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
        PIN_PIN_RESTITUTION,  // e = 0.18 for Pin-to-Pin
        CONTACT_FRICTION
      );

      if (!result) continue;

      // ── Angular impulse transfer (mutual torque) ──────────────────────────
      _hN.copy(result.normal);
      _hN.y = 0;
      
      if (_hN.lengthSq() > 1e-8) {
        _hN.normalize();
        
        // Torque axis perpendicular to collision plane
        const axisA = _ax.set(_hN.z, 0, -_hN.x).normalize();
        
        // Torque magnitude scaled by impulse
        const torqueFactor = 0.6;
        const tipStrengthA = result.impulse * torqueFactor * a.invMass;
        const tipStrengthB = result.impulse * torqueFactor * b.invMass;
        
        // Apply opposite angular impulses (Newton's third law)
        a.angularVelocity.addScaledVector(axisA, tipStrengthA);
        b.angularVelocity.addScaledVector(axisA, -tipStrengthB);
        
        // ── Friction modeling via damping coefficient ───────────────────────
        // F_friction = c_damping × v_relative
        // Applied when impulse is low (grazing contact)
        const minPinImpulse = 0.05;
        if (result.impulse < minPinImpulse) {
          const frictionDamping = PIN_LINEAR_DAMPING;
          
          if (a.velocity.length() < 0.1) {
            a.velocity.addScaledVector(result.normal, 0.15 * frictionDamping);
          }
          if (b.velocity.length() < 0.1) {
            b.velocity.addScaledVector(result.normal, -0.15 * frictionDamping);
          }
        }
      }
    }
  }
}

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * ACCURATE KNOCKDOWN LOGIC (Settling Phase)
 * ═════════════════════════════════════════════════════════════════════════════
 * Determines if a pin is knocked down by calculating the true spatial angular
 * deviation using the pin's 3D rotation quaternion.
 * 
 * Algorithm:
 *   1. Apply quaternion rotation to world up vector [0, 1, 0]
 *   2. Extract Y component of rotated up vector (up_y)
 *   3. Calculate tilt angle: θ = arccos(up_y)
 *   4. Pin is knocked if: θ > 28°
 * 
 * Mathematical formula:
 *   tilt = arccos(up_y)
 *   knocked = (tilt > 28°)
 */
export function markKnockedPins() {
  const _upVec = new THREE.Vector3();

  for (const pin of pins) {
    if (!pin.active || pin.knocked) continue;

    // Apply pin's quaternion rotation to world up vector [0, 1, 0]
    _upVec.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    
    // Calculate tilt angle: θ = arccos(up_y)
    // Clamp to [-1, 1] to handle numerical precision errors
    const tilt = Math.acos(clamp(_upVec.y, -1, 1));

    // Pin is knocked down if tilt exceeds 28° (0.4887 radians)
    if (tilt > KNOCK_ANGLE) {
      pin.knocked = true;
    }
  }
}