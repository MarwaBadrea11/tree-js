
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


const _up    = new THREE.Vector3();
const _axis  = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _spin  = new THREE.Quaternion();


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
      const newSpeed  = Math.max(0, horizSpeed - speedDrop);
      const scale     = newSpeed / horizSpeed;
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


// Dedicated vertical air-drag coefficient for airborne pins.
// Distinct from horizontal damping so gravity is never suppressed by lateral
// friction forces.  A value of ~0.08 gives a realistic terminal-velocity feel
// without making pins float.
const PIN_VERTICAL_AIR_DRAG = 0.08;   // (m/s²)/(m/s) – applied only while airborne

export function integratePins(dt) {
  // Horizontal damping only – applied to X/Z, never to Y so gravity works freely.
  const horizDecay   = Math.pow(PIN_LINEAR_DAMPING,  dt * 60);
  const angularDecay = Math.pow(PIN_ANGULAR_DAMPING, dt * 60);

  for (const pin of pins) {
    if (!pin.active) continue;

    // ── 1. Gravity (always, unconditionally) ─────────────────────────────────
    // Must be accumulated BEFORE positional integration so the floor check
    // below sees the post-gravity velocity.
    pin.velocity.y -= GRAVITY * dt;

    // ── 2. Vertical air resistance (airborne only) ────────────────────────────
    // Proportional drag opposing the current Y direction.  This slows an
    // upward-moving pin naturally and prevents indefinite floating, while
    // NOT fighting gravity on the way down (the drag term is smaller than
    // the gravity term at any realistic speed, so pins always settle).
    const vySign = pin.velocity.y >= 0 ? 1 : -1;
    const vyDrag = PIN_VERTICAL_AIR_DRAG * pin.velocity.y * pin.velocity.y * vySign;
    pin.velocity.y -= vyDrag * dt;

    // ── 3. Horizontal (XZ) damping – kept independent of Y ───────────────────
    pin.velocity.x *= horizDecay;
    pin.velocity.z *= horizDecay;

    // ── 4. Integrate position ─────────────────────────────────────────────────
    pin.mesh.position.addScaledVector(pin.velocity, dt);

    // ── 5. Angular integration ────────────────────────────────────────────────
    const angSpeed = pin.angularVelocity.length();
    if (angSpeed > 0) {
      _axis.copy(pin.angularVelocity).normalize();
      _quat.setFromAxisAngle(_axis, angSpeed * dt);
      pin.mesh.quaternion.premultiply(_quat).normalize();
    }
    pin.angularVelocity.multiplyScalar(angularDecay);

    // ── 6. Side-wall boundary ─────────────────────────────────────────────────
    if (pin.mesh.position.x >  LANE_HALF_WIDTH + 0.35) {
      pin.mesh.position.x = LANE_HALF_WIDTH + 0.35;
      pin.velocity.x *= -0.2;
    }
    if (pin.mesh.position.x < -(LANE_HALF_WIDTH + 0.35)) {
      pin.mesh.position.x = -(LANE_HALF_WIDTH + 0.35);
      pin.velocity.x *= -0.2;
    }

    // ── 7. Floor collision ────────────────────────────────────────────────────
    // bottomHeight tracks the pin's lowest contact point as it tips over.
    _up.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const bottomHeight = (PIN_CAP_RADIUS + PIN_HALF_SEGMENT) * Math.abs(_up.y);

    if (pin.mesh.position.y < bottomHeight) {
      pin.mesh.position.y = bottomHeight;

      if (pin.velocity.y < 0) {
        // Low restitution (0.18) – bowling pins are heavy and don't bounce high.
        // A threshold of 0.12 m/s kills micro-bounces that would look floaty.
        pin.velocity.y *= -0.18;
        if (Math.abs(pin.velocity.y) < 0.12) pin.velocity.y = 0;
      }

      // Lateral friction on ground contact (sliding/rolling resistance).
      pin.velocity.x *= 0.80;
      pin.velocity.z *= 0.80;
    }

    // ── 8. Sleep threshold ────────────────────────────────────────────────────
    if (pin.velocity.lengthSq()        < 0.00008) pin.velocity.set(0, 0, 0);
    if (pin.angularVelocity.lengthSq() < 0.001)   pin.angularVelocity.set(0, 0, 0);
  }
}


export function pinsSleeping() {
  for (const pin of pins) {
    if (!pin.active) continue;
    if (pin.velocity.lengthSq() > 0.0012) return false;
    if (pin.angularVelocity.lengthSq() > 0.02) return false;
  }
  return true;
}
