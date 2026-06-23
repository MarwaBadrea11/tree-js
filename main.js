import * as THREE from "three";
import { clock, renderer, scene, camera } from "./src/core/engine.js";
import {
  FIXED_DT,
  BALL_RADIUS,
  LANE_END_Z,
  LANE_HALF_WIDTH,
  PIN_HEAD_Z,
  PIN_BACK_Z,
  MAX_ROLL_TIME,
} from "./src/core/constants.js";
import { session, GAME_STATE, roundLogEntries } from "./src/core/state.js";
import {
  resetGame,
  updateAimAndCharge,
  finishThrow,
  gutterThrow,
  resetBallForAim,
  notifyBallPastPins,
  registerHudCallbacks,
  registerStatusElement,
  registerSliderElements,
  registerDropdownElements,
} from "./src/core/game.js";
import { createLane }        from "./src/entities/Lane.js";
import { ball }              from "./src/entities/Ball.js";   
import { pins, createPins }  from "./src/entities/Pins.js";
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
import {
  scheduleMusic,
  updateRollingSfx,
  updateAudioButtons,
  audioState,
} from "./src/audio/audioEngine.js";

const GUTTER_ENTRY = LANE_HALF_WIDTH + 0.07;
const GUTTER_CENTER_X = LANE_HALF_WIDTH + 0.24;
const GUTTER_OUTER_X = LANE_HALF_WIDTH + 0.41;

let _gutterPending = false;

registerStatusElement(hud.status);
registerSliderElements(hud.aimSlider, hud.powerSlider);
registerDropdownElements(hud.launchModeSelect, hud.surfaceTypeSelect, hud.ballTypeSelect);

registerHudCallbacks({
  roundLog: () => updateRoundLogUI(roundLogEntries),
  roundSummary: () => updateRoundSummary(),
  powerUI: () => updatePowerUI(),
});

createLane();
createPins();
setupInput();

function checkThrowLifecycle(dt) {
  if (session.gameState !== GAME_STATE.ROLLING && session.gameState !== GAME_STATE.SETTLING) {
    _gutterPending = false;
    session.inGutter = false;
    return;
  }

  if (session.gameState === GAME_STATE.ROLLING) {
    session.rollingTimer += dt;

    const absX = Math.abs(ball.mesh.position.x);
    const speed = ball.velocity.length();
    const airborne = ball.mesh.position.y > BALL_RADIUS + 0.08;
    const pastPins = ball.mesh.position.z < PIN_HEAD_Z - 1.8;

    if (!session.inGutter && absX > GUTTER_ENTRY) {
      session.inGutter = true;
      const side = Math.sign(ball.mesh.position.x);
      ball.mesh.position.x = side * GUTTER_CENTER_X;
      ball.velocity.x = 0;
      if (ball.mesh.position.y < BALL_RADIUS) ball.mesh.position.y = BALL_RADIUS;
    }

    if (session.inGutter && !_gutterPending) {
      const side = Math.sign(ball.mesh.position.x);
      ball.velocity.x = 0;

      const clampedX = Math.min(absX, GUTTER_OUTER_X - BALL_RADIUS);
      ball.mesh.position.x = side * clampedX;

      if (ball.mesh.position.y < BALL_RADIUS) ball.mesh.position.y = BALL_RADIUS;

      const reachedBack = ball.mesh.position.z < PIN_BACK_Z || ball.mesh.position.z < LANE_END_Z + 1.0;
      const stoppedInGutter = speed < 0.05;

      if (reachedBack || stoppedInGutter) {
        _gutterPending = true;
        ball.velocity.set(0, 0, 0);
        ball.mesh.position.y = BALL_RADIUS;

        session.gameState = GAME_STATE.SETTLING;
        session.settleTimer = 0;

        const overlay = document.getElementById("game-end-overlay");
        if (overlay) {
          overlay.style.animation = "none";
          void overlay.offsetWidth;
          overlay.style.animation = "";
          overlay.classList.add("visible");
          clearTimeout(overlay._hideTimer);
          overlay._hideTimer = setTimeout(() => {
            overlay.classList.remove("visible");
          }, 2500);
        }

        setTimeout(() => {
          _gutterPending = false;
          session.inGutter = false;
          gutterThrow();
          resetBallForAim(true);
        }, 1500);

        return;
      }
      return;
    }

    if (!session.inGutter && ball.mesh.position.z < PIN_BACK_Z) {
      notifyBallPastPins();
      ball.velocity.set(0, 0, 0);
      ball.mesh.position.y = BALL_RADIUS;
      session.gameState = GAME_STATE.SETTLING;
      session.settleTimer = 0;
      return;
    }

    const leftArea = ball.mesh.position.z < LANE_END_Z - 1.2 || absX > LANE_HALF_WIDTH + 1.4;
    const shouldSettle = leftArea ||
      (!airborne && pastPins && speed < 0.25) ||
      (!airborne && speed < 0.22 && session.rollingTimer > 1.4) ||
      (!airborne && session.rollingTimer > MAX_ROLL_TIME) ||
      session.rollingTimer > MAX_ROLL_TIME + 2.4;

    if (shouldSettle) {
      session.gameState = GAME_STATE.SETTLING;
      session.settleTimer = 0;
      ball.velocity.multiplyScalar(0.8);
    }
  }

  if (session.gameState === GAME_STATE.SETTLING) {
    session.settleTimer += dt;
    if (!_gutterPending && session.settleTimer > 0.9 && pinsSleeping()) {
      finishThrow();
    }
  }
}

function stepPhysics(dt) {
  updateAimAndCharge(dt);

  if (session.gameState === GAME_STATE.ROLLING) {
    integrateBall(dt);
    integratePins(dt);
    if (!session.inGutter) {
      solveBallWallCollision();
      solveBallPinCollisions();
      solvePinPinCollisions();
      markKnockedPins();
    }
    checkThrowLifecycle(dt);
  }

  if (session.gameState === GAME_STATE.SETTLING) {
    integratePins(dt);
    checkThrowLifecycle(dt);
  }
}

let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const rawDt = Math.min(clock.getDelta(), 0.05);
  accumulator += rawDt;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < 8) {
    stepPhysics(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }

  updatePowerUI();
  updateRoundSummary();
  updatePhysicsSidebar(rawDt);
  updateConfigControlsLock(() => session.gameState === GAME_STATE.AIMING || session.gameState === GAME_STATE.CHARGING);
  scheduleMusic();
  updateRollingSfx();
  updateCamera();

  renderer.render(scene, camera);
}

updateAudioButtons(hud.musicToggleBtn, hud.sfxToggleBtn);
resetGame();
animate();