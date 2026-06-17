/**
 * input.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Keyboard, mobile slider, and button event bindings.
 * All high-level actions are delegated to game.js.
 */

import * as THREE from "three";
import { keys, aim, session, selection, GAME_STATE } from "../core/state.js";
import {
  launchBall,
  resetGame,
  applyBallType,
  applySurfaceVisuals,
  canAim,
  getActivePhysicsConfig,
  clamp,
} from "../core/game.js";
import { hud }                       from "./hud.js";
import {
  ensureAudioReady,
  audioState,
  updateAudioButtons,
} from "../audio/audioEngine.js";
import { ball } from "../entities/Ball.js";

// ── Keyboard ──────────────────────────────────────────────────────────────────
function onKeyDown(event) {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === "KeyR") { resetGame(); return; }

  if (event.code === "Enter" && session.gameState === GAME_STATE.GAMEOVER) {
    resetGame(); return;
  }

  if (event.code === "ArrowLeft"  || event.code === "KeyA") keys.left  = true;
  if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = true;

  if (event.code === "Space" && !keys.space) {
    keys.space = true;
    if (session.gameState === GAME_STATE.AIMING) {
      session.gameState = GAME_STATE.CHARGING;
      aim.chargePower   = 0;
    }
  }
}

function onKeyUp(event) {
  if (event.code === "ArrowLeft"  || event.code === "KeyA") keys.left  = false;
  if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = false;

  if (event.code === "Space") {
    keys.space = false;
    if (session.gameState === GAME_STATE.CHARGING) {
      launchBall(aim.chargePower);
    }
  }
}

// ── Dropdown changes ──────────────────────────────────────────────────────────
function onLaunchModeChange() {
  selection.launchMode = hud.launchModeSelect.value;
  const config = getActivePhysicsConfig();
  hud.status.textContent = `${config.launchMode.label} selected. Launch angle ${config.launchMode.launchAngleDeg.toFixed(0)} deg.`;
}

function onSurfaceTypeChange() {
  applySurfaceVisuals(hud.surfaceTypeSelect.value);
  const config = getActivePhysicsConfig();
  hud.status.textContent = `${config.surfaceType.label} selected. Friction and drag updated for next roll.`;
}

function onBallTypeChange() {
  applyBallType(hud.ballTypeSelect.value);
  const config = getActivePhysicsConfig();
  hud.status.textContent = `${config.ballType.label} selected. Mass is now ${ball.mass.toFixed(1)} kg.`;
}

// ── Mobile sliders ────────────────────────────────────────────────────────────
function onAimSliderInput() {
  if (!canAim()) return;
  aim.angle = THREE.MathUtils.degToRad(clamp(Number(hud.aimSlider.value), -20, 20));
}

function onPowerSliderInput() {
  if (!canAim()) return;
  aim.chargePower = clamp(Number(hud.powerSlider.value) / 100, 0, 1);
  hud.powerFill.style.width = `${Math.round(aim.chargePower * 100)}%`;
  hud.powerText.textContent = `${Math.round(aim.chargePower * 100)}%`;
}

function onRollBtnClick() {
  launchBall(Number(hud.powerSlider.value) / 100);
}

// ── Audio toggles ─────────────────────────────────────────────────────────────
function onMusicToggle() {
  ensureAudioReady();
  audioState.enabledMusic = !audioState.enabledMusic;
  updateAudioButtons(hud.musicToggleBtn, hud.sfxToggleBtn);
}

function onSfxToggle() {
  ensureAudioReady();
  audioState.enabledSfx = !audioState.enabledSfx;
  updateAudioButtons(hud.musicToggleBtn, hud.sfxToggleBtn);
}

// ── First-gesture audio unlock ────────────────────────────────────────────────
function activateAudioOnFirstGesture() {
  ensureAudioReady();
  window.removeEventListener("pointerdown", activateAudioOnFirstGesture);
  window.removeEventListener("keydown",     activateAudioOnFirstGesture);
  window.removeEventListener("touchstart",  activateAudioOnFirstGesture);
}

// ── Public: register all listeners ────────────────────────────────────────────
export function setupInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup",   onKeyUp);

  hud.launchModeSelect.addEventListener("change", onLaunchModeChange);
  hud.surfaceTypeSelect.addEventListener("change", onSurfaceTypeChange);
  hud.ballTypeSelect.addEventListener("change",    onBallTypeChange);

  hud.aimSlider.addEventListener("input",   onAimSliderInput);
  hud.powerSlider.addEventListener("input", onPowerSliderInput);
  hud.rollBtn.addEventListener("click",     onRollBtnClick);

  hud.musicToggleBtn.addEventListener("click", onMusicToggle);
  hud.sfxToggleBtn.addEventListener("click",   onSfxToggle);
  hud.resetBtn.addEventListener("click",       resetGame);

  window.addEventListener("pointerdown", activateAudioOnFirstGesture, { passive: true });
  window.addEventListener("keydown",     activateAudioOnFirstGesture);
  window.addEventListener("touchstart",  activateAudioOnFirstGesture, { passive: true });
}
