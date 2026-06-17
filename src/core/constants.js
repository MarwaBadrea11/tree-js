/**
 * constants.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All immutable game & physics constants.
 *
 * COORDINATE REFERENCE SYSTEM (from the analytical physics report)
 * ─────────────────────────────────────────────────────────────────
 *  • The World Coordinate origin is translated so the effective lane STARTS
 *    at Z = 0.0 m and the ball travels in the NEGATIVE Z direction.
 *  • LANE_START_Z  =   0.0  m  →  entry / approach edge
 *  • BALL_START    = (0, 0.33, -1.1)  →  launch position behind start line
 *  • PIN_HEAD_Z    = -34.0  m  →  head-pin apex
 *  • LANE_END_Z    = -37.9  m  →  absolute rear end of playing area
 */

import * as THREE from "three";

// ── Simulation timestep ──────────────────────────────────────────────────────
export const FIXED_DT = 1 / 120;       // 120 Hz fixed physics step

// ── Physical constants ───────────────────────────────────────────────────────
export const GRAVITY = 9.81;            // m/s²  (standard gravitational acceleration)

// ── Lane geometry (CRS-aligned) ──────────────────────────────────────────────
export const LANE_HALF_WIDTH = 1.08;    // m  half-width of the playing lane
export const LANE_START_Z    = 0.0;     // m  start edge  (CRS origin on Z)
export const LANE_END_Z      = -37.9;   // m  rear end of lane
export const PIN_HEAD_Z      = -34.0;   // m  head-pin centre Z

// ── Ball geometry & dynamics ─────────────────────────────────────────────────
export const BALL_RADIUS       = 0.33;  // m
export const DEFAULT_BALL_MASS = 7.0;   // kg
/** Launch position: approach area just behind the start line */
export const BALL_START = new THREE.Vector3(0, BALL_RADIUS, -1.1);
export const BALL_DAMPING     = 0.998;  // per-step residual linear damping
export const WALL_RESTITUTION = 0.4;    // side-gutter coefficient of restitution

// ── Pin geometry & dynamics ───────────────────────────────────────────────────
export const PIN_MASS             = 1.5;   // kg
export const PIN_COLLIDER_RADIUS  = 0.12;  // m  sphere-approx radius for collision
export const PIN_CAP_RADIUS       = 0.06;  // m  top-cap radius
export const PIN_HALF_SEGMENT     = 0.40;  // m  half the pin body height
export const PIN_LINEAR_DAMPING   = 0.994; // per-step coefficient
export const PIN_ANGULAR_DAMPING  = 0.992; // per-step coefficient

/** Tipping angle (rad) beyond which a pin is declared knocked down */
export const KNOCK_ANGLE = THREE.MathUtils.degToRad(15);

// ── Collision coefficients of restitution ────────────────────────────────────
export const BALL_PIN_RESTITUTION = 0.18;
export const PIN_PIN_RESTITUTION  = 0.14;
export const CONTACT_FRICTION     = 0.34;

// ── Aiming & charging ────────────────────────────────────────────────────────
export const MIN_LAUNCH_SPEED = 5.0;    // m/s
export const MAX_LAUNCH_SPEED = 18.0;   // m/s
export const CHARGE_RATE      = 0.62;   // power/s when holding Space
export const AIM_SPEED        = THREE.MathUtils.degToRad(58); // rad/s
export const MAX_AIM_ANGLE    = THREE.MathUtils.degToRad(20); // rad

// ── Throw lifecycle timing ────────────────────────────────────────────────────
export const MAX_ROLL_TIME = 8.5;       // s  max time before forcing settle

// ── Camera anchor for aim phase (CRS-aligned) ────────────────────────────────
/** Camera rests here during AIMING / CHARGING state. */
export const AIM_CAM_POS = new THREE.Vector3(0, 1.68, 1.6);

// ── Launch mode presets ───────────────────────────────────────────────────────
export const LAUNCH_MODES = {
  normal: {
    key: "normal",
    label: "Normal Roll",
    minSpeed: MIN_LAUNCH_SPEED,
    maxSpeed: MAX_LAUNCH_SPEED,
    powerExponent: 1,
    launchAngleDeg: 2,
    spawnHeight: 0,
    frictionMultiplier: 1,
    airDragMultiplier: 1,
    reboundMultiplier: 1,
    strengthMultiplier: 1,
  },
  slingshot: {
    key: "slingshot",
    label: "Slingshot Arc",
    minSpeed: 6.3,
    maxSpeed: 22.2,
    powerExponent: 0.84,
    launchAngleDeg: 8,
    spawnHeight: 0.08,
    frictionMultiplier: 1.04,
    airDragMultiplier: 1.08,
    reboundMultiplier: 1.08,
    strengthMultiplier: 2,
  },
  cannon: {
    key: "cannon",
    label: "Cannon Shot",
    minSpeed: 7.8,
    maxSpeed: 20.6,
    powerExponent: 1.02,
    launchAngleDeg: 17,
    spawnHeight: 0.34,
    frictionMultiplier: 0.96,
    airDragMultiplier: 2.2,
    reboundMultiplier: 0.92,
    strengthMultiplier: 2,
  },
};

// ── Surface type presets ──────────────────────────────────────────────────────
export const SURFACE_TYPES = {
  normal: {
    key: "normal",
    label: "Normal Ground",
    rollingFriction: 0.11,
    airDrag: 0.018,
    rebound: 0.28,
    groundDamping: 1,
    laneColor: 0xba8958,
    roomColor: 0x7ca18f,
  },
  water: {
    key: "water",
    label: "Water Ground",
    rollingFriction: 0.33,
    airDrag: 0.034,
    rebound: 0.09,
    groundDamping: 0.986,
    laneColor: 0x4b7a9e,
    roomColor: 0x6a95a3,
  },
  "dense-air": {
    key: "dense-air",
    label: "Strong Air Resistance",
    rollingFriction: 0.14,
    airDrag: 0.12,
    rebound: 0.24,
    groundDamping: 0.994,
    laneColor: 0x8f7f6a,
    roomColor: 0x738f87,
  },
};

// ── Ball type presets ─────────────────────────────────────────────────────────
export const BALL_TYPES = {
  light: {
    key: "light",
    label: "Light Ball",
    mass: 4.2,
    color: 0x3a8ed4,
    dragMultiplier: 1.45,
    reboundMultiplier: 1.14,
    launchSpeedMultiplier: 1.08,
    rollingFrictionMultiplier: 0.9,
    impactMultiplier: 0.8,
  },
  normal: {
    key: "normal",
    label: "Normal Ball",
    mass: DEFAULT_BALL_MASS,
    color: 0x1d5f8f,
    dragMultiplier: 1,
    reboundMultiplier: 1,
    launchSpeedMultiplier: 1,
    rollingFrictionMultiplier: 1,
    impactMultiplier: 1,
  },
  heavy: {
    key: "heavy",
    label: "Heavy Ball",
    mass: 12.4,
    color: 0x153b58,
    dragMultiplier: 0.66,
    reboundMultiplier: 0.78,
    launchSpeedMultiplier: 0.92,
    rollingFrictionMultiplier: 1.12,
    impactMultiplier: 1.34,
  },
};

// ── Music note sequences ──────────────────────────────────────────────────────
export const MUSIC_LEAD_NOTES = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 392.0];
export const MUSIC_BASS_NOTES = [130.81, 146.83, 164.81, 146.83];
