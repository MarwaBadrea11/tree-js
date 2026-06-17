/**
 * main.js  –  Entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Bowling Lab | Three.js + Custom Physics (No external physics library)
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  COORDINATE REFERENCE SYSTEM  (from the analytical physics report)      │
 * │                                                                         │
 * │  LANE_START_Z =  0.0 m  →  approach / start edge (CRS origin on Z)     │
 * │  BALL_START   = (0, 0.33, −1.1)  →  launch position                    │
 * │  PIN_HEAD_Z   = −34.0 m  →  head-pin centre                            │
 * │  LANE_END_Z   = −37.9 m  →  physical rear end of lane                  │
 * │                                                                         │
 * │  Ball always travels in the −Z direction.                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Module map
 * ──────────
 *  src/core/engine.js          Three.js renderer, scene, camera, clock, lights
 *  src/core/constants.js       All immutable physics & geometry constants
 *  src/core/state.js           Mutable runtime state (FSM, counters, flags)
 *  src/core/game.js            Game-flow (launch, reset, finishThrow, aim step)
 *  src/entities/Lane.js        Lane mesh + gutters + pin-deck
 *  src/entities/Ball.js        Ball mesh + physics body
 *  src/entities/Pins.js        10-pin rack mesh + physics bodies
 *  src/physics/physicsEngine.js  Semi-implicit Euler integration (ball + pins)
 *  src/physics/collisions.js   Impulse collision resolution (sphere–sphere)
 *  src/ui/hud.js               DOM refs, telemetry sidebar, power bar
 *  src/ui/input.js             Keyboard / slider / button event bindings
 *  src/ui/camera.js            Smooth camera follow controller
 *  src/audio/audioEngine.js    Procedural Web Audio synthesis & sequencer
 */

// ── Three.js ──────────────────────────────────────────────────────────────────
import * as THREE from "three";

// ── Core engine ───────────────────────────────────────────────────────────────
import { clock, renderer, scene, camera } from "./src/core/engine.js";

// ── Constants ─────────────────────────────────────────────────────────────────
import {
  FIXED_DT,
  BALL_RADIUS,
  LANE_END_Z,
  LANE_HALF_WIDTH,
  PIN_HEAD_Z,
  MAX_ROLL_TIME,
} from "./src/core/constants.js";

// ── Runtime state ─────────────────────────────────────────────────────────────
import { session, GAME_STATE, roundLogEntries } from "./src/core/state.js";

// ── Game-flow ─────────────────────────────────────────────────────────────────
import {
  resetGame,
  updateAimAndCharge,
  finishThrow,
  registerHudCallbacks,
  registerStatusElement,
  registerSliderElements,
  registerDropdownElements,
} from "./src/core/game.js";

// ── Entities ──────────────────────────────────────────────────────────────────
import { createLane }        from "./src/entities/Lane.js";
import { ball }              from "./src/entities/Ball.js";   // also adds ball mesh to scene
import { pins, createPins }  from "./src/entities/Pins.js";

// ── Physics ───────────────────────────────────────────────────────────────────
import {
  integrateBall,
  integratePins,
  pinsSleeping,
} from "./src/physics/physicsEngine.js";
import {
  solveBallWallCollision,
  solveBallPinCollisions,
  solvePinPinCollisions,
  markKnockedPins,
} from "./src/physics/collisions.js";

// ── UI ────────────────────────────────────────────────────────────────────────
import {
  hud,
  updatePowerUI,
  updateRoundSummary,
  updateRoundLogUI,
  updatePhysicsSidebar,
  updateConfigControlsLock,
} from "./src/ui/hud.js";
import { setupInput }   from "./src/ui/input.js";
import { updateCamera } from "./src/ui/camera.js";

// ── Audio ─────────────────────────────────────────────────────────────────────
import {
  scheduleMusic,
  updateRollingSfx,
  updateAudioButtons,
  audioState,
} from "./src/audio/audioEngine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Register DOM element references into game.js to break circular dependencies
// ─────────────────────────────────────────────────────────────────────────────
registerStatusElement(hud.status);
registerSliderElements(hud.aimSlider, hud.powerSlider);
registerDropdownElements(hud.launchModeSelect, hud.surfaceTypeSelect, hud.ballTypeSelect);

// Register HUD update callbacks that game.js calls after each round event
registerHudCallbacks({
  roundLog:     () => updateRoundLogUI(roundLogEntries),
  roundSummary: ()  => updateRoundSummary(),
  powerUI:      ()  => updatePowerUI(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Scene initialisation
// ─────────────────────────────────────────────────────────────────────────────
createLane();
createPins();

// ─────────────────────────────────────────────────────────────────────────────
// Input bindings
// ─────────────────────────────────────────────────────────────────────────────
setupInput();

// ─────────────────────────────────────────────────────────────────────────────
// Throw lifecycle evaluator
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Drives ROLLING → SETTLING → finishThrow transitions.
 * Runs every physics tick.
 *
 * @param {number} dt  FIXED_DT (s)
 */
function checkThrowLifecycle(dt) {
  if (session.gameState === GAME_STATE.ROLLING) {
    session.rollingTimer += dt;

    const speed    = ball.velocity.length();
    const airborne = ball.mesh.position.y > BALL_RADIUS + 0.08;
    const pastPins = ball.mesh.position.z < PIN_HEAD_Z - 1.8;
    const leftArea =
      ball.mesh.position.z < LANE_END_Z - 1.2 ||
      Math.abs(ball.mesh.position.x) > LANE_HALF_WIDTH + 1.4;

    const shouldSettle =
      leftArea ||
      (!airborne && pastPins  && speed < 0.25) ||
      (!airborne && speed < 0.22 && session.rollingTimer > 1.4) ||
      (!airborne && session.rollingTimer > MAX_ROLL_TIME) ||
      session.rollingTimer > MAX_ROLL_TIME + 2.4;

    if (shouldSettle) {
      session.gameState   = GAME_STATE.SETTLING;
      session.settleTimer = 0;
      ball.velocity.multiplyScalar(0.8);
    }
  }

  if (session.gameState === GAME_STATE.SETTLING) {
    session.settleTimer += dt;
    if (session.settleTimer > 0.9 && pinsSleeping()) {
      finishThrow();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-timestep physics step  (120 Hz)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * One discrete physics tick:
 *   1. Advance aim angle / charge power (AIMING / CHARGING states)
 *   2. Integrate ball & pins under forces (ROLLING / SETTLING states)
 *   3. Resolve all sphere contacts
 *   4. Evaluate knocked pins
 *   5. Check throw lifecycle transitions
 *
 * @param {number} dt  FIXED_DT = 1/120 s
 */
function stepPhysics(dt) {
  updateAimAndCharge(dt);

  if (
    session.gameState === GAME_STATE.ROLLING ||
    session.gameState === GAME_STATE.SETTLING
  ) {
    integrateBall(dt);
    integratePins(dt);
    solveBallWallCollision();
    solveBallPinCollisions();
    solvePinPinCollisions();
    markKnockedPins();
    checkThrowLifecycle(dt);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render / game loop  (variable render rate, fixed physics rate)
// ─────────────────────────────────────────────────────────────────────────────
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  // Cap raw delta to prevent spiral of death after tab regains focus
  const rawDt = Math.min(clock.getDelta(), 0.05);
  accumulator += rawDt;

  // Drain accumulator with fixed-size physics ticks (cap at 8 per frame)
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < 8) {
    stepPhysics(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }

  // Render-rate updates (visual only – no physics maths)
  updatePowerUI();
  updateRoundSummary();
  updatePhysicsSidebar(rawDt);
  updateConfigControlsLock(
    () =>
      session.gameState === GAME_STATE.AIMING ||
      session.gameState === GAME_STATE.CHARGING
  );
  scheduleMusic();
  updateRollingSfx();
  updateCamera();

  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
updateAudioButtons(hud.musicToggleBtn, hud.sfxToggleBtn);
resetGame();
animate();
