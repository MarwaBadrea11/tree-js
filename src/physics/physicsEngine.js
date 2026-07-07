/**
 * ═════════════════════════════════════════════════════════════════════════════
 * PHYSICS ENGINE - Custom Rigid Body Simulation for Bowling Pins
 * ═════════════════════════════════════════════════════════════════════════════
 * 
 * NUMERICAL INTEGRATION: Semi-implicit Euler method
 *   - Update velocity first: v(t+dt) = v(t) + a(t) × dt
 *   - Update position second: x(t+dt) = x(t) + v(t+dt) × dt
 *   - Fixed timestep: dt = 1/120 seconds (0.00833s)
 * 
 * PIN SPECIFICATIONS:
 *   - Mass: 1.5 kg
 *   - Collision radius: 0.20 m
 *   - Linear damping: 0.987 per frame
 *   - Angular damping: 0.977 per frame
 *   - Knockdown angle: 28° (tilt threshold)
 * 
 * OUT-OF-BOUNDS DETECTION:
 *   - Y > 6.0 m (flying too high)
 *   - |Z| > 60.0 m (beyond lane bounds)
 *   - |X| > 10.0 m (laterally out of bounds)
 */

import * as THREE from "three";
import {
  GRAVITY,
  BALL_RADIUS,
  BALL_DAMPING,
  PIN_LINEAR_DAMPING,
  PIN_ANGULAR_DAMPING,
  PIN_CAP_RADIUS,
  PIN_HALF_SEGMENT,
} from "../core/constants.js";
import { ball } from "../entities/Ball.js";
import { pins } from "../entities/Pins.js";
import { getActivePhysicsConfig } from "../core/game.js";
import { playBounceSfx } from "../audio/audioEngine.js";

// ── Reusable vectors for physics calculations (avoid allocations) ─────────
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _spin = new THREE.Quaternion();

export function integrateBall(dt) {
  const config = getActivePhysicsConfig();

  const speed = ball.velocity.length();
  if (speed > 0.0001) {
    const dragAccelScale = (config.airDragCoeff * speed) / ball.mass;
    ball.velocity.addScaledVector(ball.velocity, -dragAccelScale * dt);
  }

  const ySpeedBeforeGravity = ball.velocity.y;
  ball.velocity.y -= GRAVITY * dt;

  ball.mesh.position.addScaledVector(ball.velocity, dt);

  if (ball.mesh.position.y < BALL_RADIUS) {
    ball.mesh.position.y = BALL_RADIUS;

    if (ball.velocity.y < 0) {
      const impactSpeed = Math.abs(ySpeedBeforeGravity);
      ball.velocity.y *= -config.groundRebound;

      if (impactSpeed > 0.55) playBounceSfx(impactSpeed);

      if (Math.abs(ball.velocity.y) < 0.18) ball.velocity.y = 0;
    }

    const horizSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (horizSpeed > 0) {
      const speedDrop = config.rollingFriction * GRAVITY * dt;
      const newSpeed = Math.max(0, horizSpeed - speedDrop);
      const scale = newSpeed / horizSpeed;
      ball.velocity.x *= scale * config.surfaceType.groundDamping;
      ball.velocity.z *= scale * config.surfaceType.groundDamping;
    }
  }

  ball.velocity.x *= BALL_DAMPING;
  ball.velocity.z *= BALL_DAMPING;
  if (Math.abs(ball.velocity.y) < 0.0005) ball.velocity.y = 0;

  const horizSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
  if (horizSpeed > 0.0001) {
    const rollAngle = (horizSpeed * dt) / BALL_RADIUS;
    _axis.set(ball.velocity.z, 0, -ball.velocity.x).normalize();
    _spin.setFromAxisAngle(_axis, rollAngle);
    ball.mesh.quaternion.premultiply(_spin).normalize();
  }
}

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * PIN PHYSICS INTEGRATION - Semi-implicit Euler Method
 * ═════════════════════════════════════════════════════════════════════════════
 * Implements the Semi-implicit Euler integration scheme for numerical stability:
 *   1. Update velocity: v(t+dt) = v(t) + a(t) × dt
 *   2. Update position: x(t+dt) = x(t) + v(t+dt) × dt
 * 
 * This ordering prevents tunneling and accumulating numerical errors.
 * 
 * @param {number} dt - Fixed timestep (1/120 seconds = 0.00833s)
 */
export function integratePins(dt) {
  // Frame-rate independent damping calculation
  // Power function ensures smooth decay regardless of frame rate
  const horizDecay = Math.pow(PIN_LINEAR_DAMPING, dt * 60);   // 0.987 per frame
  const angularDecay = Math.pow(PIN_ANGULAR_DAMPING, dt * 60); // 0.977 per frame

  for (const pin of pins) {
    if (!pin.active) continue;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: UPDATE VELOCITY (Semi-implicit Euler - velocity first)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Apply gravity acceleration
    pin.velocity.y -= GRAVITY * dt;

    // Apply linear damping to horizontal velocity (gradual slowdown)
    pin.velocity.x *= horizDecay;
    pin.velocity.z *= horizDecay;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: UPDATE POSITION (using updated velocity)
    // ═══════════════════════════════════════════════════════════════════════
    
    pin.mesh.position.addScaledVector(pin.velocity, dt);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: UPDATE ROTATION (Angular velocity integration)
    // ═══════════════════════════════════════════════════════════════════════
    
    const angSpeed = pin.angularVelocity.length();
    if (angSpeed > 1e-6) {
      // Compute rotation axis from angular velocity vector
      _axis.copy(pin.angularVelocity).normalize();
      
      // Create incremental rotation quaternion: Δθ = ω × dt
      _quat.setFromAxisAngle(_axis, angSpeed * dt);
      
      // Apply rotation to current orientation (pre-multiply for world-space rotation)
      pin.mesh.quaternion.premultiply(_quat).normalize();
    }
    
    // Apply angular damping (rotational slowdown)
    pin.angularVelocity.multiplyScalar(angularDecay);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: GROUND COLLISION (Calculate bottom height dynamically)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Apply quaternion to up vector [0, 1, 0] to get pin's current orientation
    _up.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    
    // Calculate bottom height based on pin orientation
    // For upright pin: bottom = PIN_HALF_SEGMENT × |up_y| + PIN_CAP_RADIUS
    let bottomHeight = PIN_HALF_SEGMENT * Math.abs(_up.y) + PIN_CAP_RADIUS;
    
    // For knocked/tilted pins, clamp to collision radius to prevent floating
    if (pin.knocked || Math.abs(_up.y) < 0.85) {
      bottomHeight = Math.min(bottomHeight, pin.radius || PIN_CAP_RADIUS);
    }

    // Ground collision resolution
    if (pin.mesh.position.y < bottomHeight) {
      pin.mesh.position.y = bottomHeight;

      // Bounce response (restitution from ground impact)
      if (pin.velocity.y < 0) {
        const impactSpeed = Math.abs(pin.velocity.y);
        
        // Variable restitution based on impact speed (softer for harder hits)
        const bounceFactor = Math.min(0.35, 0.08 + impactSpeed * 0.04);
        pin.velocity.y *= -bounceFactor;
        
        // Stop vertical motion if bounce is negligible
        if (Math.abs(pin.velocity.y) < 0.04) pin.velocity.y = 0;
      }

      // ── Ground friction (prevent infinite sliding) ──────────────────────
      // Knocked pins experience higher friction
      const groundFriction = pin.knocked ? 0.85 : 0.92;
      pin.velocity.x *= groundFriction;
      pin.velocity.z *= groundFriction;
      
      // Angular ground friction (prevent infinite rolling)
      const angularGroundFriction = pin.knocked ? 0.82 : 0.92;
      pin.angularVelocity.multiplyScalar(angularGroundFriction);
      
      // ── Sleeping threshold (complete stop for very low velocities) ──────
      if (pin.velocity.lengthSq() < 0.0003) {
        pin.velocity.set(0, 0, 0);
      }
      
      if (pin.angularVelocity.lengthSq() < 0.0006) {
        pin.angularVelocity.set(0, 0, 0);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: OUT-OF-BOUNDS OPTIMIZATION
    // ═══════════════════════════════════════════════════════════════════════
    // Immediately deactivate pins that fly out of the playable area
    // Boundaries: Y > 6.0, |Z| > 60.0, |X| > 10.0
    
    if (pin.mesh.position.y > 6.0 || 
        Math.abs(pin.mesh.position.z) > 60.0 || 
        Math.abs(pin.mesh.position.x) > 10.0) {
      pin.active = false;
      pin.mesh.visible = false;  // Hide mesh to save rendering costs
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: REAL-TIME PHYSICS-TO-GRAPHICS BINDING
    // ═══════════════════════════════════════════════════════════════════════
    // Position and quaternion are already directly updated on pin.mesh
    // No additional synchronization needed - Three.js automatically renders
    // the updated transform in the next frame
  }
}

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * PIN SLEEPING DETECTION
 * ═════════════════════════════════════════════════════════════════════════════
 * Determines if all pins have settled (stopped moving and rotating).
 * Used to detect when the physics simulation can be paused or when scoring
 * can be calculated.
 * 
 * @returns {boolean} True if all active pins are at rest
 */
export function pinsSleeping() {
  for (const pin of pins) {
    if (!pin.active) continue;
    
    // Check linear velocity threshold
    if (pin.velocity.lengthSq() > 0.0012) return false;
    
    // Check angular velocity threshold
    if (pin.angularVelocity.lengthSq() > 0.005) return false;
  }
  return true;
}