/**
 * hud.js
 * ─────────────────────────────────────────────────────────────────────────────
 * DOM element registry and per-frame HUD update functions.
 *
 * Imports from game.js: getActivePhysicsConfig, countStandingPins
 * Does NOT import resetGame / launchBall to avoid cycles –
 * those are wired directly in input.js and main.js.
 */

import * as THREE from "three";
import { BALL_RADIUS, GRAVITY }                  from "../core/constants.js";
import { session, aim }                          from "../core/state.js";
import { ball }                                  from "../entities/Ball.js";
import { getActivePhysicsConfig, countStandingPins } from "../core/game.js";

// ── DOM references ─────────────────────────────────────────────────────────────
export const hud = {
  status:            document.querySelector("#status-text"),
  launchModeSelect:  document.querySelector("#launch-mode-select"),
  surfaceTypeSelect: document.querySelector("#surface-type-select"),
  ballTypeSelect:    document.querySelector("#ball-type-select"),
  musicToggleBtn:    document.querySelector("#music-toggle-btn"),
  sfxToggleBtn:      document.querySelector("#sfx-toggle-btn"),
  powerFill:         document.querySelector("#power-fill"),
  powerText:         document.querySelector("#power-text"),
  resetBtn:          document.querySelector("#reset-btn"),
  aimSlider:         document.querySelector("#aim-slider"),
  powerSlider:       document.querySelector("#power-slider"),
  rollBtn:           document.querySelector("#roll-btn"),
  roundNumber:       document.querySelector("#round-number"),
  throwNumber:       document.querySelector("#throw-number"),
  totalPinfall:      document.querySelector("#total-pinfall"),
  strikesCount:      document.querySelector("#strikes-count"),
  sparesCount:       document.querySelector("#spares-count"),
  roundLog:          document.querySelector("#round-log"),
  stats: {
    dt:              document.querySelector("#stat-dt"),
    speed:           document.querySelector("#stat-speed"),
    horizontalSpeed: document.querySelector("#stat-horizontal-speed"),
    kinetic:         document.querySelector("#stat-kinetic"),
    momentum:        document.querySelector("#stat-momentum"),
    friction:        document.querySelector("#stat-friction"),
    airDrag:         document.querySelector("#stat-air-drag"),
    gravity:         document.querySelector("#stat-gravity"),
    rebound:         document.querySelector("#stat-rebound"),
    angle:           document.querySelector("#stat-angle"),
    launchSpeed:     document.querySelector("#stat-launch-speed"),
    mass:            document.querySelector("#stat-mass"),
    ballPos:         document.querySelector("#stat-ballpos"),
    standing:        document.querySelector("#stat-standing"),
  },
};

// ── Power bar ─────────────────────────────────────────────────────────────────
export function updatePowerUI() {
  const pct = Math.round(aim.chargePower * 100);
  hud.powerFill.style.height = `${pct}%`;
  hud.powerText.textContent = `${pct}%`;
}

// ── Round summary ──────────────────────────────────────────────────────────────
export function updateRoundSummary() {
  const shown = Math.min(session.round, 10);
  hud.roundNumber.textContent  = `${shown} / 10`;
  hud.throwNumber.textContent  = session.gameState === "gameover" ? "-" : `${session.throwInRound}`;
  hud.totalPinfall.textContent = `${session.totalPinfall}`;
  hud.strikesCount.textContent = `${session.strikes}`;
  hud.sparesCount.textContent  = `${session.spares}`;
}

// ── Round log ─────────────────────────────────────────────────────────────────
export function updateRoundLogUI(roundLogEntries) {
  hud.roundLog.innerHTML = "";
  for (let i = roundLogEntries.length - 1; i >= 0; i--) {
    const item = document.createElement("li");
    item.textContent = roundLogEntries[i];
    hud.roundLog.appendChild(item);
  }
}

// ── Config controls lock ───────────────────────────────────────────────────────
export function updateConfigControlsLock(isAimingFn) {
  const locked = !isAimingFn();
  hud.launchModeSelect.disabled  = locked;
  hud.surfaceTypeSelect.disabled = locked;
  hud.ballTypeSelect.disabled    = locked;
}

// ── Physics telemetry sidebar ──────────────────────────────────────────────────
/**
 * @param {number} dt  raw render-frame delta (s)
 */
export function updatePhysicsSidebar(dt) {
  const config          = getActivePhysicsConfig();
  const speed           = ball.velocity.length();
  const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
  const kinetic         = 0.5 * ball.mass * speed * speed;
  const momentum        = ball.mass * speed;

  const onGround     = ball.mesh.position.y <= BALL_RADIUS + 0.0001;
  const frictionForce = onGround ? config.rollingFriction * ball.mass * GRAVITY : 0;
  const gravityForce  = ball.mass * GRAVITY;
  const airDragForce  = config.airDragCoeff * speed * speed;

  const s = hud.stats;
  s.dt.textContent              = `${(dt * 1000).toFixed(2)} ms`;
  s.speed.textContent           = `${speed.toFixed(2)} m/s`;
  s.horizontalSpeed.textContent = `${horizontalSpeed.toFixed(2)} m/s`;
  s.kinetic.textContent         = `${kinetic.toFixed(2)} J`;
  s.momentum.textContent        = `${momentum.toFixed(2)} kg m/s`;
  s.friction.textContent        = `${frictionForce.toFixed(2)} N`;
  s.airDrag.textContent         = `${airDragForce.toFixed(2)} N`;
  s.gravity.textContent         = `${gravityForce.toFixed(2)} N`;
  s.rebound.textContent         = `${config.groundRebound.toFixed(2)}`;
  s.angle.textContent           = `${THREE.MathUtils.radToDeg(aim.angle).toFixed(1)} deg`;
  s.launchSpeed.textContent     = `${session.launchSpeed.toFixed(2)} m/s`;
  s.mass.textContent            = `${ball.mass.toFixed(2)} kg`;
  s.ballPos.textContent         = `${ball.mesh.position.x.toFixed(2)}, ${ball.mesh.position.y.toFixed(2)}, ${ball.mesh.position.z.toFixed(2)}`;
  s.standing.textContent        = `${countStandingPins()} / 10`;
}
