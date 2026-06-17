/**
 * audioEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedural Web Audio API sound synthesis:
 *   • Oscillator-based music sequencer (triangle lead + sine bass)
 *   • Rolling noise (sawtooth → low-pass → gain envelope)
 *   • Impact / bounce / wall-hit SFX spikes
 *   • Speech synthesis announcements (Strike! / Spare!)
 *
 * All synthesis is procedural – no audio files required.
 */

import { MUSIC_LEAD_NOTES, MUSIC_BASS_NOTES, BALL_RADIUS } from "../core/constants.js";
import { clamp } from "../core/game.js";
import {
  lastImpactSfxTime,
  setLastImpactSfxTime,
  session,
  GAME_STATE,
} from "../core/state.js";
import { ball } from "../entities/Ball.js";

// ── Audio context state ───────────────────────────────────────────────────────
export const audioState = {
  enabledMusic:     true,
  enabledSfx:       true,
  initialized:      false,
  context:          null,
  masterGain:       null,
  musicGain:        null,
  sfxGain:          null,
  rollingOscillator: null,
  rollingNoiseGain: null,
  rollingFilter:    null,
  nextNoteTime:     0,
  stepIndex:        0,
};

// ── Context bootstrap ─────────────────────────────────────────────────────────
/**
 * Lazily creates (and resumes) the AudioContext on first user gesture.
 * Idempotent – safe to call every frame.
 * @returns {boolean} true if context is ready
 */
export function ensureAudioReady() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;

  if (!audioState.initialized) {
    const ctx         = new Ctx();
    const masterGain  = ctx.createGain();
    const musicGain   = ctx.createGain();
    const sfxGain     = ctx.createGain();

    masterGain.gain.value = 0.82;
    musicGain.gain.value  = 0.25;
    sfxGain.gain.value    = 0.62;

    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    // ── Continuous rolling oscillator ──────────────────────────────────────
    const rollingOscillator = ctx.createOscillator();
    const rollingFilter     = ctx.createBiquadFilter();
    const rollingNoiseGain  = ctx.createGain();

    rollingOscillator.type           = "sawtooth";
    rollingOscillator.frequency.value = 38;
    rollingFilter.type               = "lowpass";
    rollingFilter.frequency.value    = 150;
    rollingNoiseGain.gain.value      = 0.0001;

    rollingOscillator.connect(rollingFilter);
    rollingFilter.connect(rollingNoiseGain);
    rollingNoiseGain.connect(sfxGain);
    rollingOscillator.start();

    audioState.context           = ctx;
    audioState.masterGain        = masterGain;
    audioState.musicGain         = musicGain;
    audioState.sfxGain           = sfxGain;
    audioState.rollingOscillator = rollingOscillator;
    audioState.rollingNoiseGain  = rollingNoiseGain;
    audioState.rollingFilter     = rollingFilter;
    audioState.nextNoteTime      = ctx.currentTime + 0.05;
    audioState.stepIndex         = 0;
    audioState.initialized       = true;
  }

  if (audioState.context.state === "suspended") {
    audioState.context.resume();
  }

  return true;
}

// ── Low-level tone emitter ─────────────────────────────────────────────────────
/**
 * Schedules a single oscillator tone.
 * @param {GainNode} targetGain
 * @param {{ frequency, waveform, startTime, duration, volume, attack, release }} opts
 */
export function playTone(targetGain, {
  frequency,
  waveform  = "sine",
  startTime,
  duration  = 0.14,
  volume    = 0.18,
  attack    = 0.01,
  release   = 0.12,
}) {
  if (!audioState.initialized || !targetGain) return;

  const ctx  = audioState.context;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = waveform;
  osc.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + release);

  osc.connect(gain);
  gain.connect(targetGain);

  osc.start(startTime);
  osc.stop(startTime + duration + release + 0.02);
}

// ── Music sequencer ────────────────────────────────────────────────────────────
/**
 * Called every frame to advance the music sequencer.
 * Schedules notes into the near future (look-ahead = 0.35 s).
 * BPM = 104, subdivided to 16th-note steps.
 */
export function scheduleMusic() {
  if (!audioState.initialized || !audioState.enabledMusic) return;

  const ctx          = audioState.context;
  const stepDuration = 60 / 104 / 4;   // 16th note at 104 BPM
  const horizon      = ctx.currentTime + 0.35;

  while (audioState.nextNoteTime < horizon) {
    const step = audioState.stepIndex;
    const lead = MUSIC_LEAD_NOTES[step % MUSIC_LEAD_NOTES.length];
    const bass = MUSIC_BASS_NOTES[Math.floor(step / 4) % MUSIC_BASS_NOTES.length];

    // Lead melody (triangle wave)
    playTone(audioState.musicGain, {
      frequency: lead,
      waveform:  "triangle",
      startTime: audioState.nextNoteTime,
      duration:  0.1,
      volume:    0.12,
      attack:    0.008,
      release:   0.08,
    });

    // Bass line (sine, every 4 steps)
    if (step % 4 === 0) {
      playTone(audioState.musicGain, {
        frequency: bass,
        waveform:  "sine",
        startTime: audioState.nextNoteTime,
        duration:  0.2,
        volume:    0.16,
        attack:    0.01,
        release:   0.12,
      });
    }

    audioState.nextNoteTime += stepDuration;
    audioState.stepIndex    += 1;
  }
}

// ── Rolling SFX ────────────────────────────────────────────────────────────────
/**
 * Continuously modulates the rolling oscillator's gain and filter cutoff
 * based on ball speed and ground contact. Called each render frame.
 */
export function updateRollingSfx() {
  if (!audioState.initialized || !audioState.rollingNoiseGain || !audioState.rollingFilter) return;

  const speed    = Math.hypot(ball.velocity.x, ball.velocity.z);
  const onGround = ball.mesh.position.y <= BALL_RADIUS + 0.02;
  const active   =
    audioState.enabledSfx &&
    (session.gameState === GAME_STATE.ROLLING || session.gameState === GAME_STATE.SETTLING) &&
    onGround &&
    speed > 0.2;

  const targetGain   = active ? clamp(speed * 0.013, 0, 0.22) : 0.0001;
  const targetFilter = active ? 120 + clamp(speed * 42, 0, 720) : 120;

  const now = audioState.context.currentTime;
  audioState.rollingNoiseGain.gain.linearRampToValueAtTime(targetGain,   now + 0.05);
  audioState.rollingFilter.frequency.linearRampToValueAtTime(targetFilter, now + 0.05);
}

// ── Impact SFX (ball–pin) ─────────────────────────────────────────────────────
export function playImpactSfx(intensity = 1) {
  if (!audioState.enabledSfx || !ensureAudioReady()) return;

  const nowMs = performance.now();
  if (nowMs - lastImpactSfxTime < 70) return;   // debounce 70 ms
  setLastImpactSfxTime(nowMs);

  const freq = 210 + Math.random() * 120 * intensity;
  playTone(audioState.sfxGain, {
    frequency: freq,
    waveform:  "triangle",
    startTime: audioState.context.currentTime,
    duration:  0.045,
    volume:    0.24 * clamp(intensity, 0.35, 2.2),
    attack:    0.002,
    release:   0.055,
  });
}

// ── Bounce SFX (ball hits ground) ─────────────────────────────────────────────
export function playBounceSfx(impactSpeed = 1) {
  if (!audioState.enabledSfx || !ensureAudioReady()) return;

  const now  = audioState.context.currentTime;
  const tone = 120 + Math.min(220, impactSpeed * 20);

  playTone(audioState.sfxGain, {
    frequency: tone,
    waveform:  "square",
    startTime: now,
    duration:  0.03,
    volume:    0.18 * clamp(impactSpeed / 8, 0.4, 1.6),
    attack:    0.002,
    release:   0.05,
  });
}

// ── Wall-hit SFX ──────────────────────────────────────────────────────────────
export function playWallHitSfx(impactSpeed = 1) {
  if (!audioState.enabledSfx || !ensureAudioReady()) return;

  const now = audioState.context.currentTime;
  playTone(audioState.sfxGain, {
    frequency: 170 + Math.min(190, impactSpeed * 16),
    waveform:  "sawtooth",
    startTime: now,
    duration:  0.035,
    volume:    0.16 * clamp(impactSpeed / 7, 0.45, 1.5),
    attack:    0.002,
    release:   0.045,
  });
}

// ── Launch SFX ────────────────────────────────────────────────────────────────
export function playLaunchSfx() {
  if (!audioState.enabledSfx || !ensureAudioReady()) return;

  const now = audioState.context.currentTime;
  playTone(audioState.sfxGain, {
    frequency: 180,
    waveform:  "sawtooth",
    startTime: now,
    duration:  0.06,
    volume:    0.22,
    attack:    0.003,
    release:   0.05,
  });
  playTone(audioState.sfxGain, {
    frequency: 250,
    waveform:  "triangle",
    startTime: now + 0.05,
    duration:  0.08,
    volume:    0.16,
    attack:    0.004,
    release:   0.06,
  });
}

// ── Round-result SFX + announcement ──────────────────────────────────────────
export function playRoundResultSfx(isStrike, isSpare, knockedPins) {
  if (!audioState.enabledSfx || !ensureAudioReady()) return;

  const now = audioState.context.currentTime;

  if (isStrike) {
    playTone(audioState.sfxGain, { frequency: 523.25, waveform: "triangle", startTime: now,        duration: 0.12, volume: 0.2 });
    playTone(audioState.sfxGain, { frequency: 659.25, waveform: "triangle", startTime: now + 0.12, duration: 0.12, volume: 0.2 });
    playTone(audioState.sfxGain, { frequency: 783.99, waveform: "triangle", startTime: now + 0.24, duration: 0.15, volume: 0.22 });
    speakAnnouncement("Strike");
    return;
  }

  if (isSpare) {
    playTone(audioState.sfxGain, { frequency: 392.0,  waveform: "triangle", startTime: now,       duration: 0.1,  volume: 0.18 });
    playTone(audioState.sfxGain, { frequency: 523.25, waveform: "triangle", startTime: now + 0.1, duration: 0.12, volume: 0.2 });
    speakAnnouncement("Spare");
    return;
  }

  playTone(audioState.sfxGain, {
    frequency: 300 + knockedPins * 18,
    waveform:  "sine",
    startTime: now,
    duration:  0.08,
    volume:    0.14,
    attack:    0.005,
    release:   0.08,
  });
}

// ── Speech synthesis ──────────────────────────────────────────────────────────
export function speakAnnouncement(text) {
  if (!audioState.enabledSfx || !("speechSynthesis" in window)) return;

  const utterance    = new SpeechSynthesisUtterance(text);
  utterance.rate     = 1;
  utterance.pitch    = 1.02;
  utterance.volume   = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ── UI button state sync ──────────────────────────────────────────────────────
export function updateAudioButtons(musicBtn, sfxBtn) {
  if (musicBtn) {
    musicBtn.textContent = `Music: ${audioState.enabledMusic ? "On" : "Off"}`;
    musicBtn.classList.toggle("off", !audioState.enabledMusic);
  }
  if (sfxBtn) {
    sfxBtn.textContent = `Voice/SFX: ${audioState.enabledSfx ? "On" : "Off"}`;
    sfxBtn.classList.toggle("off", !audioState.enabledSfx);
  }
}
