

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


const _n   = new THREE.Vector3();  
const _vr  = new THREE.Vector3(); 
const _t   = new THREE.Vector3();  
const _imp = new THREE.Vector3();  
const _hN  = new THREE.Vector3();  
const _ax  = new THREE.Vector3();  


export function resolveSphereContact(
  posA, velA, invMassA, radiusA,
  posB, velB, invMassB, radiusB,
  restitution,
  friction
) {
  _n.subVectors(posB, posA);
  let dist = _n.length();
  const minDist = radiusA + radiusB;

  if (dist >= minDist) return null;  

 
  if (dist < 1e-5) { _n.set(1, 0, 0); dist = 1; }


  _n.multiplyScalar(1 / dist);

  const penetration = minDist - dist;
  const invMassSum  = invMassA + invMassB;
  if (invMassSum <= 0) return null;

  // ── 1. Impulse resolution (must happen BEFORE positional correction) ───────
  _vr.subVectors(velB, velA);
  const normalSpeed = _vr.dot(_n);

  let jNormal = 0;
  // Resolve even when bodies are just touching (normalSpeed <= 0) to avoid
  // repeated micro-penetrations that drain velocity every frame.
  if (normalSpeed <= 0.01) {
    jNormal = (-(1 + restitution) * normalSpeed) / invMassSum;

    // ── Vertical Y-impulse cap ──────────────────────────────────────────────
    // Prevent exaggerated upward pop-ups by limiting how much of the impulse
    // is allowed to act along the Y-axis.  The horizontal components are left
    // untouched so lateral pin scatter still looks realistic.
    // The cap is derived from the impulse magnitude: the Y component of the
    // collision normal is scaled back to at most 30 % of the total impulse.
    // This reflects the weight/inertia of a real bowling pin (1.5 kg) that
    // won't fly vertically like a feather when struck.
    const Y_NORMAL_CAP = 0.30;
    const cappedN = _n.clone();
    if (Math.abs(cappedN.y) > Y_NORMAL_CAP) {
      cappedN.y = Math.sign(cappedN.y) * Y_NORMAL_CAP;
      cappedN.normalize();
    }

    _imp.copy(cappedN).multiplyScalar(jNormal);
    velA.addScaledVector(_imp, -invMassA);
    velB.addScaledVector(_imp,  invMassB);

    // Friction (tangential) impulse – clamped to Coulomb cone
    _t.copy(_vr).addScaledVector(_n, -normalSpeed);
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

  // ── 2. Positional correction – push apart by a small fraction only ─────────
  // Using ~30 % of penetration prevents objects from sinking while avoiding
  // the "jitter sink" where full correction repeatedly re-triggers collisions.
  const CORRECTION_PERCENT = 0.3;
  const SLOP = 0.002; // ignore sub-mm penetrations to reduce jitter
  const correctionMag = Math.max(penetration - SLOP, 0) * CORRECTION_PERCENT / invMassSum;
  posA.addScaledVector(_n, -correctionMag * invMassA);
  posB.addScaledVector(_n,  correctionMag * invMassB);

  return { normal: _n.clone(), impulse: jNormal };
}


export function solveBallWallCollision() {
  const limit = LANE_HALF_WIDTH - ball.radius;


  if (ball.mesh.position.x > limit) {
    const hitSpeed = Math.abs(ball.velocity.x);
    ball.mesh.position.x = limit;
    if (ball.velocity.x > 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
      if (hitSpeed > 0.4) playWallHitSfx(hitSpeed);
    }
  }

 
  if (ball.mesh.position.x < -limit) {
    const hitSpeed = Math.abs(ball.velocity.x);
    ball.mesh.position.x = -limit;
    if (ball.velocity.x < 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
      if (hitSpeed > 0.4) playWallHitSfx(hitSpeed);
    }
  }


  if (ball.mesh.position.z > LANE_START_Z + 0.8) {
    const hitSpeed = Math.abs(ball.velocity.z);
    ball.mesh.position.z = LANE_START_Z + 0.8;
    if (ball.velocity.z > 0) {
      ball.velocity.z *= -0.2;
      if (hitSpeed > 0.7) playWallHitSfx(hitSpeed);
    }
  }
}


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

export function markKnockedPins() {
  const _upVec = new THREE.Vector3();

  for (const pin of pins) {
    if (!pin.active || pin.knocked) continue;

    _upVec.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const tilt = Math.acos(clamp(_upVec.y, -1, 1));

    if (tilt > KNOCK_ANGLE) pin.knocked = true;
  }
}
