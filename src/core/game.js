/**
 * game.js
 * ─────────────────────────────────────────────────────────────────────────────
 * High-level game-flow logic: launching, finishing throws, round management,
 * and full-game reset. Coordinates between state, entities, UI, and audio
 * without containing any raw physics maths.
 *
 * Circular-dependency note:
 *   game.js  →  audio, state, constants, entities
 *   hud.js   →  game.js (for getActivePhysicsConfig, countStandingPins)
 *   input.js →  game.js (for launchBall, resetGame, ...)
 *
 *   To avoid a cycle, game.js does NOT import hud.js.
 *   Instead, UI update callbacks (updateRoundLogUI, updateRoundSummary,
 *   updatePowerUI) are registered from main.js via registerHudCallbacks().
 */

import * as THREE from "three";
import {
  BALL_RADIUS,
  BALL_START,
  CHARGE_RATE,
  MAX_AIM_ANGLE,
  AIM_SPEED,
  LAUNCH_MODES,
  BALL_TYPES,
  SURFACE_TYPES,
} from "./constants.js";
import { GAME_STATE, session, aim, selection, keys, roundLogEntries } from "./state.js";
import { ball }                from "../entities/Ball.js";
import { pins }                from "../entities/Pins.js";
import { environmentVisuals }  from "../entities/Lane.js";
import { scene }               from "./engine.js";
import {
  playLaunchSfx,
  playRoundResultSfx,
  playTone,
  ensureAudioReady,
  audioState,
  speakAnnouncement,
} from "../audio/audioEngine.js";

// ── Utility ───────────────────────────────────────────────────────────────────
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ── HUD callback registry  (populated by main.js to break the circular dep) ──
let _cbUpdateRoundLog   = () => {};
let _cbUpdateRoundSum   = () => {};
let _cbUpdatePowerUI    = () => {};

/**
 * Call once from main.js after all modules are loaded.
 * @param {{ roundLog: Function, roundSummary: Function, powerUI: Function }} cbs
 */
export function registerHudCallbacks(cbs) {
  _cbUpdateRoundLog = cbs.roundLog    ?? _cbUpdateRoundLog;
  _cbUpdateRoundSum = cbs.roundSummary ?? _cbUpdateRoundSum;
  _cbUpdatePowerUI  = cbs.powerUI     ?? _cbUpdatePowerUI;
}

// ── Physics-config aggregator ─────────────────────────────────────────────────
export function getActivePhysicsConfig() {
  const launchMode  = LAUNCH_MODES[selection.launchMode]   ?? LAUNCH_MODES.normal;
  const surfaceType = SURFACE_TYPES[selection.surfaceType] ?? SURFACE_TYPES.normal;
  const ballType    = BALL_TYPES[selection.ballType]       ?? BALL_TYPES.normal;

  const rollingFriction =
    surfaceType.rollingFriction *
    launchMode.frictionMultiplier *
    ballType.rollingFrictionMultiplier;

  const airDragCoeff =
    surfaceType.airDrag *
    launchMode.airDragMultiplier *
    ballType.dragMultiplier;

  const groundRebound = clamp(
    surfaceType.rebound * launchMode.reboundMultiplier * ballType.reboundMultiplier,
    0,
    0.88
  );

  return {
    launchMode,
    surfaceType,
    ballType,
    rollingFriction,
    airDragCoeff,
    groundRebound,
    launchSpeedMultiplier:  ballType.launchSpeedMultiplier,
    impactMultiplier:       ballType.impactMultiplier,
  };
}

// ── Convenience predicates ────────────────────────────────────────────────────
export function canAim() {
  return (
    session.gameState === GAME_STATE.AIMING ||
    session.gameState === GAME_STATE.CHARGING
  );
}

// ── Pin utilities ─────────────────────────────────────────────────────────────
export function countStandingPins() {
  let count = 0;
  for (const pin of pins) {
    if (pin.active && !pin.knocked) count++;
  }
  return count;
}

function setupFreshRack() {
  for (const pin of pins) {
    pin.active   = true;
    pin.knocked  = false;
    pin.mesh.visible = true;
    pin.mesh.position.copy(pin.spawnPosition);
    pin.mesh.quaternion.identity();
    pin.velocity.set(0, 0, 0);
    pin.angularVelocity.set(0, 0, 0);
  }
}

const _identQuat = new THREE.Quaternion();
const _upVec     = new THREE.Vector3();

function clearKnockedPins() {
  for (const pin of pins) {
    if (pin.knocked) {
      pin.active = false;
      pin.mesh.visible = false;
      pin.velocity.set(0, 0, 0);
      pin.angularVelocity.set(0, 0, 0);
      continue;
    }

    pin.velocity.multiplyScalar(0.3);
    pin.angularVelocity.multiplyScalar(0.3);

    _upVec.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    // Restore y-position based on tilt (PIN_CAP_RADIUS=0.06, PIN_HALF_SEGMENT=0.40)
    pin.mesh.position.y = (0.06 + 0.40) * Math.abs(_upVec.y);

    if (pin.mesh.quaternion.angleTo(_identQuat) < THREE.MathUtils.degToRad(8)) {
      pin.mesh.quaternion.slerp(_identQuat, 0.5);
    }
  }
}

// ── Ball reset ────────────────────────────────────────────────────────────────
/**
 * @param {boolean} [keepOverlay=false]
 *   Pass true when calling from a gutter-end or ball-past-pins sequence so the
 *   "the game end" overlay is NOT immediately dismissed.  The overlay's own
 *   auto-hide timer will remove it after its full display duration.
 */
export function resetBallForAim(keepOverlay = false) {
  // Snap position and rotation back to the approach area
  ball.mesh.position.set(BALL_START.x, BALL_START.y, BALL_START.z);
  ball.mesh.quaternion.identity();
  // Hard-zero all motion so there is no residual velocity from the previous throw
  ball.velocity.set(0, 0, 0);
  session.launchSpeed    = 0;
  session.rollingTimer   = 0;
  session.settleTimer    = 0;
  session.ballPassedPins = false;  // reset one-shot flag for next throw
  session.inGutter       = false;  // ball is back on the lane
  keys.space             = false;

  // Only dismiss the overlay immediately when starting a fresh aim cycle.
  // When called after a gutter/past-pins sequence the overlay should stay
  // visible for its full auto-hide duration so the player can read it.
  if (!keepOverlay) {
    const overlay = document.getElementById("game-end-overlay");
    if (overlay) {
      clearTimeout(overlay._hideTimer);
      overlay.classList.remove("visible");
    }
  }

  if (session.gameState !== GAME_STATE.GAMEOVER) {
    session.gameState = GAME_STATE.AIMING;
  }
}

// ── Apply ball type ───────────────────────────────────────────────────────────
export function applyBallType(ballTypeKey) {
  const config = BALL_TYPES[ballTypeKey] ?? BALL_TYPES.normal;
  selection.ballType = config.key;
  ball.mass    = config.mass;
  ball.invMass = 1 / config.mass;
  ball.bodyMesh.material.color.setHex(config.color);
}

// ── Apply surface visuals ─────────────────────────────────────────────────────
export function applySurfaceVisuals(surfaceKey) {
  const config = SURFACE_TYPES[surfaceKey] ?? SURFACE_TYPES.normal;
  selection.surfaceType = config.key;

  if (environmentVisuals.lane) {
    environmentVisuals.lane.material.color.setHex(config.laneColor);
  }
  if (environmentVisuals.roomFloor) {
    environmentVisuals.roomFloor.material.color.setHex(config.roomColor);
  }

  if (config.key === "dense-air") {
    scene.fog = new THREE.Fog(0xd3ccb8, 12, 42);
  } else if (config.key === "water") {
    scene.fog = new THREE.Fog(0xcbe0db, 18, 52);
  } else {
    scene.fog = new THREE.Fog(0xe8dcc0, 20, 60);
  }
}

// ── Apply all selections from dropdowns ──────────────────────────────────────
export function applySelectionSettings(launchModeSelectEl, surfaceSelectEl, ballSelectEl) {
  selection.launchMode = launchModeSelectEl.value;
  applySurfaceVisuals(surfaceSelectEl.value);
  applyBallType(ballSelectEl.value);
}

// ── Ball-past-pins notification (one-shot per throw) ─────────────────────────
/**
 * Called from main.js checkThrowLifecycle when the ball crosses PIN_BACK_Z.
 * Guards itself with session.ballPassedPins so it fires exactly once per throw.
 *
 * Shows the #game-end-overlay defined in index.html.
 * The overlay is a separate DOM element – finishThrow()'s setStatus() calls
 * cannot touch it, so the message is guaranteed to appear.
 */
export function notifyBallPastPins() {
  if (session.ballPassedPins) return;
  session.ballPassedPins = true;

  // Show the full-screen overlay (toggled via CSS class).
  const overlay = document.getElementById("game-end-overlay");
  if (overlay) {
    // Re-trigger the CSS animation on repeat throws.
    overlay.style.animation = "none";
    // Force reflow so the browser re-registers the animation.
    void overlay.offsetWidth;
    overlay.style.animation = "";
    overlay.classList.add("visible");

    // Auto-hide after 2.5 s so it clears before the next throw UI appears.
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => {
      overlay.classList.remove("visible");
    }, 2500);
  }

  console.log("the game end");
}

// ── Game-over ─────────────────────────────────────────────────────────────────
let _statusEl = null;

/** Register the status DOM element (called from main.js). */
export function registerStatusElement(el) {
  _statusEl = el;
}

function setStatus(msg) {
  if (_statusEl) _statusEl.textContent = msg;
}

function endGame() {
  session.gameState = GAME_STATE.GAMEOVER;
  ball.velocity.set(0, 0, 0);

  // Snap ball back to the approach area immediately so it doesn't sit
  // frozen at the pin deck while the Game Over screen is visible.
  ball.mesh.position.set(BALL_START.x, BALL_START.y, BALL_START.z);
  ball.mesh.quaternion.identity();

  setStatus(`Game over. Total pinfall: ${session.totalPinfall}. Press R to restart.`);

  if (ensureAudioReady()) {
    playTone(audioState.sfxGain, {
      frequency: 210,
      waveform:  "triangle",
      startTime: audioState.context.currentTime,
      duration:  0.16,
      volume:    0.16,
      attack:    0.01,
      release:   0.12,
    });
  }
  speakAnnouncement("Game over");
}

// ── Gutter throw (called from main.js when ball leaves the lane laterally) ────
/**
 * Handles the state transition for a gutter ball — zero pins are added for
 * this throw, then we advance to throw 2 (or the next frame if it was throw 2).
 *
 * The overlay and ball freeze are already handled in main.js before this is
 * called, so this function only drives game-flow.
 */
export function gutterThrow() {
  if (
    session.gameState !== GAME_STATE.SETTLING &&
    session.gameState !== GAME_STATE.ROLLING
  ) return;

  // A gutter ball scores 0 knocked pins for this throw.
  session.lastThrowPins = 0;

  if (session.throwInRound === 1) {
    // First throw gutter → give the player throw 2 with all pins still up.
    session.firstThrowPins = 0;
    session.throwInRound   = 2;
    clearKnockedPins(); // standing pins stay, knocked ones cleared
    // resetBallForAim() is called by main.js immediately after gutterThrow().
    setStatus(`Gutter! Throw 2. ${countStandingPins()} pins still standing.`);
    playRoundResultSfx(false, false, 0);
    _cbUpdateRoundLog();
    _cbUpdateRoundSum();
  } else {
    // Second throw gutter → record frame (first + 0) and advance round.
    const first      = session.firstThrowPins ?? 0;
    const frameTotal = first + 0;

    if (frameTotal === 10) {
      // Spare via first throw + gutter (unlikely but possible if 10-pin was left)
      session.spares++;
      roundLogEntries.push(`Round ${session.round}: ${first} /`);
    } else {
      roundLogEntries.push(`Round ${session.round}: ${first}, 0`);
    }

    session.round++;
    session.throwInRound   = 1;
    session.firstThrowPins = null;

    if (session.round <= 10) {
      setupFreshRack();
      // resetBallForAim() is called by main.js immediately after gutterThrow().
      setStatus(`Gutter! Round ${session.round}. Aim with A/D, then roll.`);
    } else {
      _cbUpdateRoundLog();
      _cbUpdateRoundSum();
      endGame();
      return;
    }

    playRoundResultSfx(false, false, 0);
    _cbUpdateRoundLog();
    _cbUpdateRoundSum();
  }
}

// ── Finish throw (called after pins settle) ───────────────────────────────────
export function finishThrow() {
  const standingAfter   = countStandingPins();
  session.lastThrowPins = Math.max(0, session.standingBeforeThrow - standingAfter);
  session.totalPinfall += session.lastThrowPins;

  let isStrike = false;
  let isSpare  = false;

  if (session.throwInRound === 1) {
    session.firstThrowPins = session.lastThrowPins;

    if (standingAfter === 0) {
      isStrike = true;
      session.strikes++;
      roundLogEntries.push(`Round ${session.round}: X`);
      session.round++;
      session.throwInRound   = 1;
      session.firstThrowPins = null;

      if (session.round <= 10) {
        setupFreshRack();
        resetBallForAim(true);  // overlay may still be showing from notifyBallPastPins
        setStatus(`Strike! Round ${session.round}. Aim your next throw.`);
      } else {
        _cbUpdateRoundLog();
        _cbUpdateRoundSum();
        endGame();
        return;
      }
    } else {
      session.throwInRound = 2;
      clearKnockedPins();
      resetBallForAim(true);  // overlay may still be showing from notifyBallPastPins
      setStatus(`Throw 2. ${standingAfter} pins still standing.`);
    }
  } else {
    const second     = session.lastThrowPins;
    const first      = session.firstThrowPins ?? 0;
    const frameTotal = first + second;

    if (frameTotal === 10) {
      isSpare = true;
      session.spares++;
      roundLogEntries.push(`Round ${session.round}: ${first} /`);
    } else {
      roundLogEntries.push(`Round ${session.round}: ${first}, ${second}`);
    }

    session.round++;
    session.throwInRound   = 1;
    session.firstThrowPins = null;

    if (session.round <= 10) {
      setupFreshRack();
      resetBallForAim(true);  // overlay may still be showing from notifyBallPastPins
      setStatus(`Round ${session.round}. Aim with A/D, then roll.`);
    } else {
      _cbUpdateRoundLog();
      _cbUpdateRoundSum();
      endGame();
      return;
    }
  }

  playRoundResultSfx(isStrike, isSpare, session.lastThrowPins);
  _cbUpdateRoundLog();
  _cbUpdateRoundSum();
}

// ── Launch ball ───────────────────────────────────────────────────────────────
export function launchBall(powerOverride = null) {
  if (session.gameState === GAME_STATE.GAMEOVER) return;
  if (
    session.gameState !== GAME_STATE.AIMING &&
    session.gameState !== GAME_STATE.CHARGING
  ) return;

  const power   = clamp(powerOverride ?? aim.chargePower, 0.02, 1);
  const config  = getActivePhysicsConfig();
  const profile = config.launchMode;

  aim.chargePower = power;

  // ── Compute launch speed from power curve ──────────────────────────────────
  const curvedPower = Math.pow(power, profile.powerExponent);
  let ls =
    profile.minSpeed +
    (profile.maxSpeed - profile.minSpeed) * curvedPower;
  ls *= profile.strengthMultiplier;
  ls *= config.launchSpeedMultiplier;
  session.launchSpeed = ls;

  // ── Decompose velocity (Newton 2nd law initial conditions) ─────────────────
  // θ  = launch elevation angle
  // vx =  v * cos(θ) * sin(aimAngle)
  // vz = -v * cos(θ) * cos(aimAngle)   [negative → toward pins in −Z]
  // vy =  v * sin(θ)
  const launchAngle      = THREE.MathUtils.degToRad(profile.launchAngleDeg);
  const horizontalFactor = Math.cos(launchAngle);
  const verticalSpeed    = Math.sin(launchAngle) * ls;

  ball.velocity.set(
    Math.sin(aim.angle) * ls * horizontalFactor,
    verticalSpeed,
    -Math.cos(aim.angle) * ls * horizontalFactor   // always −Z
  );
  ball.mesh.position.y = BALL_RADIUS + profile.spawnHeight;

  session.standingBeforeThrow = countStandingPins();
  session.rollingTimer        = 0;
  session.settleTimer         = 0;
  session.gameState           = GAME_STATE.ROLLING;

  playLaunchSfx();
  setStatus(`${profile.label} fired. Watch free-fall, rebound, and collision response.`);
}

// ── Aim & charge step ─────────────────────────────────────────────────────────
export function updateAimAndCharge(dt) {
  if (!canAim()) return;

  const turnDir = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  if (turnDir !== 0) {
    aim.angle = clamp(aim.angle + turnDir * AIM_SPEED * dt, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
    // Sync slider – grab element via registered reference
    if (_aimSliderEl) _aimSliderEl.value = `${Math.round(THREE.MathUtils.radToDeg(aim.angle))}`;
  }

  if (session.gameState === GAME_STATE.CHARGING && keys.space) {
    aim.chargePower = clamp(aim.chargePower + CHARGE_RATE * dt, 0, 1);
    if (_powerSliderEl) _powerSliderEl.value = `${Math.round(aim.chargePower * 100)}`;
  }

  if (session.gameState === GAME_STATE.AIMING && !keys.space) {
    const sliderPower = _powerSliderEl ? Number(_powerSliderEl.value) / 100 : 0;
    aim.chargePower   = clamp(sliderPower, 0, 1);
  }
}

// DOM slider references (registered from main.js to avoid circular imports)
let _aimSliderEl   = null;
let _powerSliderEl = null;

export function registerSliderElements(aimEl, powerEl) {
  _aimSliderEl   = aimEl;
  _powerSliderEl = powerEl;
}

// ── Full game reset ────────────────────────────────────────────────────────────
export function resetGame() {
  session.gameState            = GAME_STATE.AIMING;
  session.round                = 1;
  session.throwInRound         = 1;
  session.firstThrowPins       = null;
  session.totalPinfall         = 0;
  session.strikes              = 0;
  session.spares               = 0;
  session.standingBeforeThrow  = 10;
  session.lastThrowPins        = 0;
  session.launchSpeed          = 0;
  session.rollingTimer         = 0;
  session.settleTimer          = 0;
  session.inGutter             = false;
  aim.angle      = 0;
  aim.chargePower = 0;

  roundLogEntries.length = 0;

  if (_aimSliderEl)   _aimSliderEl.value   = "0";
  if (_powerSliderEl) _powerSliderEl.value = "0";

  // Re-apply dropdown selections (elements registered below)
  if (_launchSelectEl && _surfaceSelectEl && _ballSelectEl) {
    applySelectionSettings(_launchSelectEl, _surfaceSelectEl, _ballSelectEl);
  }

  setupFreshRack();
  resetBallForAim();

  const config = getActivePhysicsConfig();
  setStatus(
    `${config.launchMode.label} + ${config.surfaceType.label} + ` +
    `${config.ballType.label} ready. Aim with A/D, hold Space, release to roll.`
  );

  if (ensureAudioReady()) {
    playTone(audioState.sfxGain, {
      frequency: 420,
      waveform:  "sine",
      startTime: audioState.context.currentTime,
      duration:  0.06,
      volume:    0.1,
      attack:    0.004,
      release:   0.06,
    });
  }

  _cbUpdateRoundLog();
  _cbUpdateRoundSum();
  _cbUpdatePowerUI();
}

// Dropdown element references
let _launchSelectEl  = null;
let _surfaceSelectEl = null;
let _ballSelectEl    = null;

export function registerDropdownElements(launchEl, surfaceEl, ballEl) {
  _launchSelectEl  = launchEl;
  _surfaceSelectEl = surfaceEl;
  _ballSelectEl    = ballEl;
}
