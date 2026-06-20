/**
 * state.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised mutable runtime state. No logic lives here – it is a plain data
 * store that every module can read/write through explicit imports.
 */

// ── FSM state names ───────────────────────────────────────────────────────────
export const GAME_STATE = {
  AIMING:   "aiming",
  CHARGING: "charging",
  ROLLING:  "rolling",
  SETTLING: "settling",
  GAMEOVER: "gameover",
};

// ── Game session counters ─────────────────────────────────────────────────────
export const session = {
  gameState:         GAME_STATE.AIMING,
  round:             1,
  throwInRound:      1,
  firstThrowPins:    null,   // pins knocked on throw 1 of the current frame
  totalPinfall:      0,
  strikes:           0,
  spares:            0,
  standingBeforeThrow: 10,
  lastThrowPins:     0,
  launchSpeed:       0,
  rollingTimer:      0,
  settleTimer:       0,
  ballPassedPins:    false,  // true once per throw after ball crosses PIN_BACK_Z
};

// ── Aim / charge transient values ─────────────────────────────────────────────
export const aim = {
  angle:        0,   // rad, positive = left
  chargePower:  0,   // 0..1
};

// ── Selection state (UI dropdowns) ────────────────────────────────────────────
export const selection = {
  launchMode:  "normal",
  surfaceType: "normal",
  ballType:    "normal",
};

// ── Input key flags ────────────────────────────────────────────────────────────
export const keys = {
  left:  false,
  right: false,
  space: false,
};

// ── Round log (array of strings, newest at tail) ──────────────────────────────
export const roundLogEntries = [];

// ── Misc timing ───────────────────────────────────────────────────────────────
export let lastImpactSfxTime = 0;
export function setLastImpactSfxTime(t) { lastImpactSfxTime = t; }
