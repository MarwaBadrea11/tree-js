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

const PIN_VERTICAL_AIR_DRAG = 0.08;

export function integratePins(dt) {
  const horizDecay   = Math.pow(PIN_LINEAR_DAMPING,  dt * 60);
  const angularDecay = Math.pow(PIN_ANGULAR_DAMPING, dt * 60);

  for (const pin of pins) {
    if (!pin.active) continue;

    pin.velocity.y -= GRAVITY * dt;

    const vySign = pin.velocity.y >= 0 ? 1 : -1;
    const vyDrag = PIN_VERTICAL_AIR_DRAG * pin.velocity.y * pin.velocity.y * vySign;
    pin.velocity.y -= vyDrag * dt;

    pin.velocity.x *= horizDecay;
    pin.velocity.z *= horizDecay;

    pin.mesh.position.addScaledVector(pin.velocity, dt);

    const angSpeed = pin.angularVelocity.length();
    if (angSpeed > 0) {
      _axis.copy(pin.angularVelocity).normalize();
      _quat.setFromAxisAngle(_axis, angSpeed * dt);
      pin.mesh.quaternion.premultiply(_quat).normalize();
    }
    pin.angularVelocity.multiplyScalar(angularDecay);

    _up.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const bottomHeight = (PIN_CAP_RADIUS + PIN_HALF_SEGMENT) * Math.abs(_up.y);

    if (pin.mesh.position.y < bottomHeight) {
      pin.mesh.position.y = bottomHeight;

      if (pin.velocity.y < 0) {
        pin.velocity.y *= -0.18;
        if (Math.abs(pin.velocity.y) < 0.12) pin.velocity.y = 0;
      }

      pin.velocity.x *= 0.80;
      pin.velocity.z *= 0.80;
    }

    if (pin.mesh.position.y > 6.0 || Math.abs(pin.mesh.position.z) > 60.0 || Math.abs(pin.mesh.position.x) > 10.0) {
      pin.active = false;
      pin.mesh.visible = false;
    }
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