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
  triggerGameOver,
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

let _gutterPending = false;

registerStatusElement(hud.status);
registerSliderElements(hud.aimSlider, hud.powerSlider);
registerDropdownElements(hud.launchModeSelect, hud.surfaceTypeSelect, hud.ballTypeSelect);

registerHudCallbacks({
  roundLog: () => updateRoundLogUI(roundLogEntries),
  roundSummary: () => updateRoundSummary(),
});

createLane();
createPins();
setupInput();

function resumeAudioContext() {
  if (audioState && audioState.context && audioState.context.state === "suspended") {
    audioState.context.resume().then(() => {
      window.removeEventListener("click", resumeAudioContext);
      window.removeEventListener("keydown", resumeAudioContext);
    });
  }
}

window.addEventListener("click", resumeAudioContext);
window.addEventListener("keydown", resumeAudioContext);

function showGameEndOverlay() {
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
}

function checkThrowLifecycle(dt) {
  if (session.gameState !== GAME_STATE.ROLLING && session.gameState !== GAME_STATE.SETTLING) {
    _gutterPending = false;
    session.inGutter = false;
    return;
  }

  if (session.gameState === GAME_STATE.ROLLING) {
    session.rollingTimer += dt;

    const speed = ball.velocity.length();
    const isStationary = speed < 0.03; 
    const isExpired = session.rollingTimer > MAX_ROLL_TIME + 2.0;

    // حالة وقوف الكرة تماماً قبل الوصول (تعتبر رمية ضائعة أو Gutter)
    if (isStationary || isExpired) {
      _gutterPending = true;
      ball.velocity.set(0, 0, 0);
      session.gameState = GAME_STATE.SETTLING;
      session.settleTimer = 0;
      return;
    }

    // عندما تتجاوز الكرة خط الدبابيس الخلفي (في اتجاه Z السالب)
    if (!session.inGutter && ball.mesh.position.z < PIN_BACK_Z) {
      ball.velocity.set(0, 0, 0);
      ball.mesh.position.y = BALL_RADIUS;
      session.gameState = GAME_STATE.SETTLING;
      session.settleTimer = 0;
      return;
    }
  }

  if (session.gameState === GAME_STATE.SETTLING) {
    session.settleTimer += dt;
    
    // ننتظر حتى تستقر الدبابيس تماماً (الحد الأدنى 1.2 ثانية لتأمين الحركة البصرية)
    if (session.settleTimer > 1.2 && pinsSleeping()) {
      if (_gutterPending) {
        _gutterPending = false;
        session.inGutter = false;
        showGameEndOverlay(); // إظهار الشاشة فقط عند انتهاء الدورة كاملة واستقرارها
        // Execute immediately - no setTimeout delay
        gutterThrow();
        resetBallForAim(true);
      } else {
        // رمية ناجحة وضربت دبابيس ونريد حساب النقاط
        showGameEndOverlay(); // تظهر هلق بعد ما الدبابيس خلصت وقعتها!
        notifyBallPastPins();
        // Execute immediately - no setTimeout delay
        finishThrow();
      }
    }
  }
}

function stepPhysics(dt) {
  updateAimAndCharge(dt);

  if (session.gameState === GAME_STATE.ROLLING) {
    integrateBall(dt);
    integratePins(dt);
    solveBallWallCollision();
    solveBallPinCollisions();
    solvePinPinCollisions();
    markKnockedPins();
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