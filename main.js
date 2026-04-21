import * as THREE from "three";

const GAME_STATE = {
  AIMING: "aiming",
  CHARGING: "charging",
  ROLLING: "rolling",
  SETTLING: "settling",
  GAMEOVER: "gameover",
};

const FIXED_DT = 1 / 120;
const GRAVITY = 9.81;

const LANE_HALF_WIDTH = 1.08;
const LANE_START_Z = 9.4;
const LANE_END_Z = -28.5;
const PIN_HEAD_Z = -24.6;

const BALL_RADIUS = 0.33;
const DEFAULT_BALL_MASS = 7.0;
const BALL_START = new THREE.Vector3(0, BALL_RADIUS, 8.3);
const BALL_DAMPING = 0.998;
const WALL_RESTITUTION = 0.34;

const PIN_MASS = 1.5;
const PIN_COLLIDER_RADIUS = 0.2;
const PIN_CAP_RADIUS = 0.14;
const PIN_HALF_SEGMENT = 0.36;
const PIN_LINEAR_DAMPING = 0.987;
const PIN_ANGULAR_DAMPING = 0.977;
const KNOCK_ANGLE = THREE.MathUtils.degToRad(28);

const BALL_PIN_RESTITUTION = 0.22;
const PIN_PIN_RESTITUTION = 0.18;
const CONTACT_FRICTION = 0.26;

const MIN_LAUNCH_SPEED = 5.0;
const MAX_LAUNCH_SPEED = 18.0;
const CHARGE_RATE = 0.62;
const AIM_SPEED = THREE.MathUtils.degToRad(58);
const MAX_AIM_ANGLE = THREE.MathUtils.degToRad(20);

const MAX_ROLL_TIME = 8.5;

const LAUNCH_MODES = {
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

const SURFACE_TYPES = {
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

const BALL_TYPES = {
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

const appRoot = document.querySelector("#game-root");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8dcc0);
scene.fog = new THREE.Fog(0xe8dcc0, 20, 60);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  120
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appRoot.appendChild(renderer.domElement);

const clock = new THREE.Clock();
let accumulator = 0;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.58);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff0d7, 1.12);
keyLight.position.set(5, 14, 10);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x89ffe7, 0.32);
rimLight.position.set(-7, 5, -20);
scene.add(rimLight);

const environmentVisuals = {
  lane: null,
  roomFloor: null,
};

function createLane() {
  const laneLength = LANE_START_Z - LANE_END_Z;
  const laneCenterZ = (LANE_START_Z + LANE_END_Z) * 0.5;

  const laneMaterial = new THREE.MeshStandardMaterial({
    color: SURFACE_TYPES.normal.laneColor,
    roughness: 0.4,
    metalness: 0.07,
  });

  const lane = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_HALF_WIDTH * 2, 0.08, laneLength),
    laneMaterial
  );
  lane.position.set(0, -0.04, laneCenterZ);
  lane.receiveShadow = true;
  scene.add(lane);
  environmentVisuals.lane = lane;

  const approach = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.08, 6),
    new THREE.MeshStandardMaterial({
      color: 0x9f764c,
      roughness: 0.45,
      metalness: 0.04,
    })
  );
  approach.position.set(0, -0.04, LANE_START_Z + 2.5);
  approach.receiveShadow = true;
  scene.add(approach);

  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x373d45,
    roughness: 0.72,
    metalness: 0.15,
  });

  for (const side of [-1, 1]) {
    const gutter = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.1, laneLength),
      sideMaterial
    );
    gutter.position.set(side * (LANE_HALF_WIDTH + 0.24), -0.08, laneCenterZ);
    gutter.receiveShadow = true;
    scene.add(gutter);
  }

  const pinDeck = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.08, 2.2),
    new THREE.MeshStandardMaterial({
      color: 0xc79a67,
      roughness: 0.38,
      metalness: 0.06,
    })
  );
  pinDeck.position.set(0, -0.04, PIN_HEAD_Z + 0.6);
  pinDeck.receiveShadow = true;
  scene.add(pinDeck);

  const roomFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      color: SURFACE_TYPES.normal.roomColor,
      roughness: 1,
      metalness: 0,
    })
  );
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.position.y = -0.09;
  roomFloor.receiveShadow = true;
  scene.add(roomFloor);
  environmentVisuals.roomFloor = roomFloor;
}

createLane();

const ballGroup = new THREE.Group();

const ballBodyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_RADIUS, 48, 36),
  new THREE.MeshStandardMaterial({
    color: 0x1d5f8f,
    roughness: 0.2,
    metalness: 0.3,
  })
);
ballBodyMesh.castShadow = true;
ballGroup.add(ballBodyMesh);

const ballStripeMaterial = new THREE.MeshStandardMaterial({
  color: 0xe9f1f7,
  roughness: 0.32,
  metalness: 0.08,
});

const equatorStripe = new THREE.Mesh(
  new THREE.TorusGeometry(BALL_RADIUS * 0.82, 0.022, 14, 64),
  ballStripeMaterial
);
equatorStripe.rotation.x = Math.PI / 2;
ballGroup.add(equatorStripe);

const meridianStripe = equatorStripe.clone();
meridianStripe.rotation.set(0, 0, Math.PI / 2);
ballGroup.add(meridianStripe);

const fingerHoleMaterial = new THREE.MeshStandardMaterial({
  color: 0x0f1720,
  roughness: 0.9,
  metalness: 0.02,
});

for (const offset of [-0.06, 0.06, 0.18]) {
  const hole = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 8),
    fingerHoleMaterial
  );
  hole.position.set(offset, BALL_RADIUS * 0.36, BALL_RADIUS * 0.79);
  ballGroup.add(hole);
}

ballGroup.position.copy(BALL_START);
scene.add(ballGroup);

const ball = {
  mesh: ballGroup,
  bodyMesh: ballBodyMesh,
  velocity: new THREE.Vector3(),
  mass: DEFAULT_BALL_MASS,
  invMass: 1 / DEFAULT_BALL_MASS,
  radius: BALL_RADIUS,
};

const pinBodyMaterial = new THREE.MeshStandardMaterial({
  color: 0xf5f5f0,
  roughness: 0.35,
  metalness: 0.15,
});

const pinStripeMaterial = new THREE.MeshStandardMaterial({
  color: 0xcd3b2f,
  roughness: 0.45,
  metalness: 0.1,
});

function makePinMesh() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PIN_CAP_RADIUS, PIN_HALF_SEGMENT * 2, 8, 18),
    pinBodyMaterial
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const stripe1 = new THREE.Mesh(
    new THREE.TorusGeometry(PIN_CAP_RADIUS * 0.82, 0.026, 8, 22),
    pinStripeMaterial
  );
  stripe1.rotation.x = Math.PI / 2;
  stripe1.position.y = 0.08;
  group.add(stripe1);

  const stripe2 = stripe1.clone();
  stripe2.position.y = -0.02;
  group.add(stripe2);

  return group;
}

const pins = [];

function createPins() {
  const spacingX = 0.58;
  const spacingZ = 0.62;
  let idCounter = 1;

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const x = (col - row * 0.5) * spacingX;
      const z = PIN_HEAD_Z + row * spacingZ;
      const y = PIN_CAP_RADIUS + PIN_HALF_SEGMENT;

      const mesh = makePinMesh();
      mesh.position.set(x, y, z);
      scene.add(mesh);

      pins.push({
        id: idCounter,
        mesh,
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        mass: PIN_MASS,
        invMass: 1 / PIN_MASS,
        radius: PIN_COLLIDER_RADIUS,
        knocked: false,
        active: true,
        spawnPosition: new THREE.Vector3(x, y, z),
      });

      idCounter += 1;
    }
  }
}

createPins();

const hud = {
  status: document.querySelector("#status-text"),
  launchModeSelect: document.querySelector("#launch-mode-select"),
  surfaceTypeSelect: document.querySelector("#surface-type-select"),
  ballTypeSelect: document.querySelector("#ball-type-select"),
  musicToggleBtn: document.querySelector("#music-toggle-btn"),
  sfxToggleBtn: document.querySelector("#sfx-toggle-btn"),
  powerFill: document.querySelector("#power-fill"),
  powerText: document.querySelector("#power-text"),
  resetBtn: document.querySelector("#reset-btn"),
  aimSlider: document.querySelector("#aim-slider"),
  powerSlider: document.querySelector("#power-slider"),
  rollBtn: document.querySelector("#roll-btn"),
  roundNumber: document.querySelector("#round-number"),
  throwNumber: document.querySelector("#throw-number"),
  totalPinfall: document.querySelector("#total-pinfall"),
  strikesCount: document.querySelector("#strikes-count"),
  sparesCount: document.querySelector("#spares-count"),
  roundLog: document.querySelector("#round-log"),
  stats: {
    state: document.querySelector("#stat-state"),
    launchMode: document.querySelector("#stat-launch-mode"),
    surface: document.querySelector("#stat-surface"),
    ballType: document.querySelector("#stat-ball-type"),
    dt: document.querySelector("#stat-dt"),
    speed: document.querySelector("#stat-speed"),
    horizontalSpeed: document.querySelector("#stat-horizontal-speed"),
    kinetic: document.querySelector("#stat-kinetic"),
    momentum: document.querySelector("#stat-momentum"),
    friction: document.querySelector("#stat-friction"),
    airDrag: document.querySelector("#stat-air-drag"),
    gravity: document.querySelector("#stat-gravity"),
    rebound: document.querySelector("#stat-rebound"),
    angle: document.querySelector("#stat-angle"),
    launchSpeed: document.querySelector("#stat-launch-speed"),
    mass: document.querySelector("#stat-mass"),
    ballPos: document.querySelector("#stat-ballpos"),
    standing: document.querySelector("#stat-standing"),
  },
};

let gameState = GAME_STATE.AIMING;
let round = 1;
let throwInRound = 1;
let firstThrowPins = null;
let totalPinfall = 0;
let strikes = 0;
let spares = 0;
let standingBeforeThrow = 10;
let lastThrowPins = 0;
let launchSpeed = 0;
let rollingTimer = 0;
let settleTimer = 0;
let aimAngle = 0;
let chargePower = 0;
let selectedLaunchMode = "normal";
let selectedSurfaceType = "normal";
let selectedBallType = "normal";
let lastImpactSfxTime = 0;

const audioState = {
  enabledMusic: true,
  enabledSfx: true,
  initialized: false,
  context: null,
  masterGain: null,
  musicGain: null,
  sfxGain: null,
  rollingOscillator: null,
  rollingNoiseGain: null,
  rollingFilter: null,
  nextNoteTime: 0,
  stepIndex: 0,
};

const roundLogEntries = [];

const keys = {
  left: false,
  right: false,
  space: false,
};

const aimCamPos = new THREE.Vector3(0, 1.68, 11.6);
const followDirection = new THREE.Vector3(0, 0, -1);

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();
const tempD = new THREE.Vector3();
const tempE = new THREE.Vector3();
const tempImpulse = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const tempSpinQuat = new THREE.Quaternion();
const identityQuat = new THREE.Quaternion();

const musicLeadNotes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 392.0];
const musicBassNotes = [130.81, 146.83, 164.81, 146.83];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateAudioButtons() {
  if (hud.musicToggleBtn) {
    hud.musicToggleBtn.textContent = `Music: ${audioState.enabledMusic ? "On" : "Off"}`;
    hud.musicToggleBtn.classList.toggle("off", !audioState.enabledMusic);
  }

  if (hud.sfxToggleBtn) {
    hud.sfxToggleBtn.textContent = `Voice/SFX: ${audioState.enabledSfx ? "On" : "Off"}`;
    hud.sfxToggleBtn.classList.toggle("off", !audioState.enabledSfx);
  }
}

function ensureAudioReady() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return false;
  }

  if (!audioState.initialized) {
    const context = new AudioContextClass();
    const masterGain = context.createGain();
    const musicGain = context.createGain();
    const sfxGain = context.createGain();

    masterGain.gain.value = 0.82;
    musicGain.gain.value = 0.25;
    sfxGain.gain.value = 0.62;

    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(context.destination);

    audioState.context = context;
    audioState.masterGain = masterGain;
    audioState.musicGain = musicGain;
    audioState.sfxGain = sfxGain;

    const rollingOscillator = context.createOscillator();
    const rollingFilter = context.createBiquadFilter();
    const rollingNoiseGain = context.createGain();

    rollingOscillator.type = "sawtooth";
    rollingOscillator.frequency.value = 38;
    rollingFilter.type = "lowpass";
    rollingFilter.frequency.value = 150;
    rollingNoiseGain.gain.value = 0.0001;

    rollingOscillator.connect(rollingFilter);
    rollingFilter.connect(rollingNoiseGain);
    rollingNoiseGain.connect(sfxGain);
    rollingOscillator.start();

    audioState.rollingOscillator = rollingOscillator;
    audioState.rollingNoiseGain = rollingNoiseGain;
    audioState.rollingFilter = rollingFilter;
    audioState.nextNoteTime = context.currentTime + 0.05;
    audioState.stepIndex = 0;
    audioState.initialized = true;
  }

  if (audioState.context.state === "suspended") {
    audioState.context.resume();
  }

  return true;
}

function playTone(targetGain, {
  frequency,
  waveform = "sine",
  startTime,
  duration = 0.14,
  volume = 0.18,
  attack = 0.01,
  release = 0.12,
}) {
  if (!audioState.initialized || !targetGain) {
    return;
  }

  const context = audioState.context;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(volume, startTime + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + release);

  oscillator.connect(gainNode);
  gainNode.connect(targetGain);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + release + 0.02);
}

function scheduleMusic() {
  if (!audioState.initialized || !audioState.enabledMusic) {
    return;
  }

  const context = audioState.context;
  const stepDuration = 60 / 104 / 4;
  const horizon = context.currentTime + 0.35;

  while (audioState.nextNoteTime < horizon) {
    const step = audioState.stepIndex;
    const lead = musicLeadNotes[step % musicLeadNotes.length];
    const bass = musicBassNotes[Math.floor(step / 4) % musicBassNotes.length];

    playTone(audioState.musicGain, {
      frequency: lead,
      waveform: "triangle",
      startTime: audioState.nextNoteTime,
      duration: 0.1,
      volume: 0.12,
      attack: 0.008,
      release: 0.08,
    });

    if (step % 4 === 0) {
      playTone(audioState.musicGain, {
        frequency: bass,
        waveform: "sine",
        startTime: audioState.nextNoteTime,
        duration: 0.2,
        volume: 0.16,
        attack: 0.01,
        release: 0.12,
      });
    }

    audioState.nextNoteTime += stepDuration;
    audioState.stepIndex += 1;
  }
}

function speakAnnouncement(text) {
  if (!audioState.enabledSfx || !("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1.02;
  utterance.volume = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function playLaunchSfx() {
  if (!audioState.enabledSfx || !ensureAudioReady()) {
    return;
  }

  const now = audioState.context.currentTime;
  playTone(audioState.sfxGain, {
    frequency: 180,
    waveform: "sawtooth",
    startTime: now,
    duration: 0.06,
    volume: 0.22,
    attack: 0.003,
    release: 0.05,
  });
  playTone(audioState.sfxGain, {
    frequency: 250,
    waveform: "triangle",
    startTime: now + 0.05,
    duration: 0.08,
    volume: 0.16,
    attack: 0.004,
    release: 0.06,
  });
}

function playImpactSfx(intensity = 1) {
  if (!audioState.enabledSfx || !ensureAudioReady()) {
    return;
  }

  const nowMs = performance.now();
  if (nowMs - lastImpactSfxTime < 70) {
    return;
  }
  lastImpactSfxTime = nowMs;

  const freq = 210 + Math.random() * 120 * intensity;
  playTone(audioState.sfxGain, {
    frequency: freq,
    waveform: "triangle",
    startTime: audioState.context.currentTime,
    duration: 0.045,
    volume: 0.24 * clamp(intensity, 0.35, 2.2),
    attack: 0.002,
    release: 0.055,
  });
}

function playBounceSfx(impactSpeed = 1) {
  if (!audioState.enabledSfx || !ensureAudioReady()) {
    return;
  }

  const now = audioState.context.currentTime;
  const tone = 120 + Math.min(220, impactSpeed * 20);

  playTone(audioState.sfxGain, {
    frequency: tone,
    waveform: "square",
    startTime: now,
    duration: 0.03,
    volume: 0.18 * clamp(impactSpeed / 8, 0.4, 1.6),
    attack: 0.002,
    release: 0.05,
  });
}

function playWallHitSfx(impactSpeed = 1) {
  if (!audioState.enabledSfx || !ensureAudioReady()) {
    return;
  }

  const now = audioState.context.currentTime;
  playTone(audioState.sfxGain, {
    frequency: 170 + Math.min(190, impactSpeed * 16),
    waveform: "sawtooth",
    startTime: now,
    duration: 0.035,
    volume: 0.16 * clamp(impactSpeed / 7, 0.45, 1.5),
    attack: 0.002,
    release: 0.045,
  });
}

function updateRollingSfx() {
  if (!audioState.initialized || !audioState.rollingNoiseGain || !audioState.rollingFilter) {
    return;
  }

  const speed = Math.hypot(ball.velocity.x, ball.velocity.z);
  const onGround = ball.mesh.position.y <= BALL_RADIUS + 0.02;
  const activeRolling =
    audioState.enabledSfx &&
    (gameState === GAME_STATE.ROLLING || gameState === GAME_STATE.SETTLING) &&
    onGround &&
    speed > 0.2;

  const targetGain = activeRolling ? clamp(speed * 0.013, 0, 0.22) : 0.0001;
  const targetFilter = activeRolling ? 120 + clamp(speed * 42, 0, 720) : 120;

  audioState.rollingNoiseGain.gain.linearRampToValueAtTime(
    targetGain,
    audioState.context.currentTime + 0.05
  );
  audioState.rollingFilter.frequency.linearRampToValueAtTime(
    targetFilter,
    audioState.context.currentTime + 0.05
  );
}

function playRoundResultSfx(isStrike, isSpare, knockedPins) {
  if (!audioState.enabledSfx || !ensureAudioReady()) {
    return;
  }

  const now = audioState.context.currentTime;

  if (isStrike) {
    playTone(audioState.sfxGain, { frequency: 523.25, waveform: "triangle", startTime: now, duration: 0.12, volume: 0.2 });
    playTone(audioState.sfxGain, { frequency: 659.25, waveform: "triangle", startTime: now + 0.12, duration: 0.12, volume: 0.2 });
    playTone(audioState.sfxGain, { frequency: 783.99, waveform: "triangle", startTime: now + 0.24, duration: 0.15, volume: 0.22 });
    speakAnnouncement("Strike");
    return;
  }

  if (isSpare) {
    playTone(audioState.sfxGain, { frequency: 392.0, waveform: "triangle", startTime: now, duration: 0.1, volume: 0.18 });
    playTone(audioState.sfxGain, { frequency: 523.25, waveform: "triangle", startTime: now + 0.1, duration: 0.12, volume: 0.2 });
    speakAnnouncement("Spare");
    return;
  }

  playTone(audioState.sfxGain, {
    frequency: 300 + knockedPins * 18,
    waveform: "sine",
    startTime: now,
    duration: 0.08,
    volume: 0.14,
    attack: 0.005,
    release: 0.08,
  });
}

function getActivePhysicsConfig() {
  const launchMode = LAUNCH_MODES[selectedLaunchMode] ?? LAUNCH_MODES.normal;
  const surfaceType = SURFACE_TYPES[selectedSurfaceType] ?? SURFACE_TYPES.normal;
  const ballType = BALL_TYPES[selectedBallType] ?? BALL_TYPES.normal;

  const rollingFriction =
    surfaceType.rollingFriction *
    launchMode.frictionMultiplier *
    ballType.rollingFrictionMultiplier;
  const airDragCoeff = surfaceType.airDrag * launchMode.airDragMultiplier * ballType.dragMultiplier;
  const groundRebound = clamp(
    surfaceType.rebound * launchMode.reboundMultiplier * ballType.reboundMultiplier,
    0,
    0.88
  );
  const launchSpeedMultiplier = ballType.launchSpeedMultiplier;
  const impactMultiplier = ballType.impactMultiplier;

  return {
    launchMode,
    surfaceType,
    ballType,
    rollingFriction,
    airDragCoeff,
    groundRebound,
    launchSpeedMultiplier,
    impactMultiplier,
  };
}

function applyBallType(ballTypeKey) {
  const config = BALL_TYPES[ballTypeKey] ?? BALL_TYPES.normal;
  selectedBallType = config.key;
  ball.mass = config.mass;
  ball.invMass = 1 / config.mass;
  ball.bodyMesh.material.color.setHex(config.color);
}

function applySurfaceVisuals(surfaceKey) {
  const config = SURFACE_TYPES[surfaceKey] ?? SURFACE_TYPES.normal;
  selectedSurfaceType = config.key;

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

function updateConfigControlsLock() {
  const locked = !canAim();
  hud.launchModeSelect.disabled = locked;
  hud.surfaceTypeSelect.disabled = locked;
  hud.ballTypeSelect.disabled = locked;
}

function applySelectionSettings() {
  selectedLaunchMode = hud.launchModeSelect.value;
  applySurfaceVisuals(hud.surfaceTypeSelect.value);
  applyBallType(hud.ballTypeSelect.value);
}

function setStatus(message) {
  hud.status.textContent = message;
}

function countStandingPins() {
  let count = 0;
  for (const pin of pins) {
    if (pin.active && !pin.knocked) {
      count += 1;
    }
  }
  return count;
}

function setupFreshRack() {
  for (const pin of pins) {
    pin.active = true;
    pin.knocked = false;
    pin.mesh.visible = true;
    pin.mesh.position.copy(pin.spawnPosition);
    pin.mesh.quaternion.identity();
    pin.velocity.set(0, 0, 0);
    pin.angularVelocity.set(0, 0, 0);
  }
}

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

    const up = tempA.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const upAbs = Math.abs(up.y);
    pin.mesh.position.y = PIN_CAP_RADIUS + PIN_HALF_SEGMENT * upAbs;

    if (pin.mesh.quaternion.angleTo(identityQuat) < THREE.MathUtils.degToRad(8)) {
      pin.mesh.quaternion.slerp(identityQuat, 0.5);
    }
  }
}

function resetBallForAim() {
  ball.mesh.position.copy(BALL_START);
  ball.mesh.quaternion.identity();
  ball.velocity.set(0, 0, 0);
  launchSpeed = 0;
  keys.space = false;

  if (gameState !== GAME_STATE.GAMEOVER) {
    gameState = GAME_STATE.AIMING;
  }
}

function updateRoundLogUI() {
  hud.roundLog.innerHTML = "";

  for (let i = roundLogEntries.length - 1; i >= 0; i -= 1) {
    const item = document.createElement("li");
    item.textContent = roundLogEntries[i];
    hud.roundLog.appendChild(item);
  }
}

function updatePowerUI() {
  const pct = Math.round(chargePower * 100);
  hud.powerFill.style.width = `${pct}%`;
  hud.powerText.textContent = `${pct}%`;
}

function updateRoundSummary() {
  const shownRound = Math.min(round, 10);
  hud.roundNumber.textContent = `${shownRound} / 10`;
  hud.throwNumber.textContent = gameState === GAME_STATE.GAMEOVER ? "-" : `${throwInRound}`;
  hud.totalPinfall.textContent = `${totalPinfall}`;
  hud.strikesCount.textContent = `${strikes}`;
  hud.sparesCount.textContent = `${spares}`;
}

function updatePhysicsSidebar(dt) {
  const config = getActivePhysicsConfig();
  const speed = ball.velocity.length();
  const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
  const kinetic = 0.5 * ball.mass * speed * speed;
  const momentum = ball.mass * speed;

  const onGround = ball.mesh.position.y <= BALL_RADIUS + 0.0001;
  const frictionForce = onGround ? config.rollingFriction * ball.mass * GRAVITY : 0;
  const gravityForce = ball.mass * GRAVITY;
  const airDragForce = config.airDragCoeff * speed * speed;

  hud.stats.state.textContent = gameState;
  hud.stats.launchMode.textContent = config.launchMode.label;
  hud.stats.surface.textContent = config.surfaceType.label;
  hud.stats.ballType.textContent = config.ballType.label;
  hud.stats.dt.textContent = `${(dt * 1000).toFixed(2)} ms`;
  hud.stats.speed.textContent = `${speed.toFixed(2)} m/s`;
  hud.stats.horizontalSpeed.textContent = `${horizontalSpeed.toFixed(2)} m/s`;
  hud.stats.kinetic.textContent = `${kinetic.toFixed(2)} J`;
  hud.stats.momentum.textContent = `${momentum.toFixed(2)} kg m/s`;
  hud.stats.friction.textContent = `${frictionForce.toFixed(2)} N`;
  hud.stats.airDrag.textContent = `${airDragForce.toFixed(2)} N`;
  hud.stats.gravity.textContent = `${gravityForce.toFixed(2)} N`;
  hud.stats.rebound.textContent = `${config.groundRebound.toFixed(2)}`;
  hud.stats.angle.textContent = `${THREE.MathUtils.radToDeg(aimAngle).toFixed(1)} deg`;
  hud.stats.launchSpeed.textContent = `${launchSpeed.toFixed(2)} m/s`;
  hud.stats.mass.textContent = `${ball.mass.toFixed(2)} kg`;
  hud.stats.ballPos.textContent = `${ball.mesh.position.x.toFixed(2)}, ${ball.mesh.position.y.toFixed(2)}, ${ball.mesh.position.z.toFixed(2)}`;
  hud.stats.standing.textContent = `${countStandingPins()} / 10`;
}

function endGame() {
  gameState = GAME_STATE.GAMEOVER;
  ball.velocity.set(0, 0, 0);
  setStatus(`Game over. Total pinfall: ${totalPinfall}. Press R to restart.`);
  playTone(audioState.sfxGain, {
    frequency: 210,
    waveform: "triangle",
    startTime: ensureAudioReady() ? audioState.context.currentTime : 0,
    duration: 0.16,
    volume: 0.16,
    attack: 0.01,
    release: 0.12,
  });
  speakAnnouncement("Game over");
}

function finishThrow() {
  const standingAfter = countStandingPins();
  lastThrowPins = Math.max(0, standingBeforeThrow - standingAfter);
  totalPinfall += lastThrowPins;
  let isStrike = false;
  let isSpare = false;

  if (throwInRound === 1) {
    firstThrowPins = lastThrowPins;

    if (standingAfter === 0) {
      isStrike = true;
      strikes += 1;
      roundLogEntries.push(`Round ${round}: X`);
      round += 1;
      throwInRound = 1;
      firstThrowPins = null;

      if (round <= 10) {
        setupFreshRack();
        resetBallForAim();
        setStatus(`Strike! Round ${round}. Aim your next throw.`);
      } else {
        updateRoundLogUI();
        updateRoundSummary();
        endGame();
        return;
      }
    } else {
      throwInRound = 2;
      clearKnockedPins();
      resetBallForAim();
      setStatus(`Throw 2. ${standingAfter} pins still standing.`);
    }
  } else {
    const secondThrowPins = lastThrowPins;
    const first = firstThrowPins ?? 0;
    const frameTotal = first + secondThrowPins;

    if (frameTotal === 10) {
      isSpare = true;
      spares += 1;
      roundLogEntries.push(`Round ${round}: ${first} /`);
    } else {
      roundLogEntries.push(`Round ${round}: ${first}, ${secondThrowPins}`);
    }

    round += 1;
    throwInRound = 1;
    firstThrowPins = null;

    if (round <= 10) {
      setupFreshRack();
      resetBallForAim();
      setStatus(`Round ${round}. Aim with A/D, then roll.`);
    } else {
      updateRoundLogUI();
      updateRoundSummary();
      endGame();
      return;
    }
  }

  playRoundResultSfx(isStrike, isSpare, lastThrowPins);

  updateRoundLogUI();
  updateRoundSummary();
}

function launchBall(powerOverride = null) {
  if (gameState === GAME_STATE.GAMEOVER) {
    return;
  }

  if (gameState !== GAME_STATE.AIMING && gameState !== GAME_STATE.CHARGING) {
    return;
  }

  const power = clamp(powerOverride ?? chargePower, 0.02, 1);
  const config = getActivePhysicsConfig();
  const launchProfile = config.launchMode;

  chargePower = power;
  hud.powerSlider.value = `${Math.round(power * 100)}`;

  const curvedPower = Math.pow(power, launchProfile.powerExponent);
  launchSpeed =
    launchProfile.minSpeed +
    (launchProfile.maxSpeed - launchProfile.minSpeed) * curvedPower;
  launchSpeed *= launchProfile.strengthMultiplier;
  launchSpeed *= config.launchSpeedMultiplier;

  const launchAngle = THREE.MathUtils.degToRad(launchProfile.launchAngleDeg);
  const horizontalFactor = Math.cos(launchAngle);
  const verticalSpeed = Math.sin(launchAngle) * launchSpeed;

  tempA.set(Math.sin(aimAngle), 0, -Math.cos(aimAngle)).normalize();
  ball.velocity.set(
    tempA.x * launchSpeed * horizontalFactor,
    verticalSpeed,
    tempA.z * launchSpeed * horizontalFactor
  );
  ball.mesh.position.y = BALL_RADIUS + launchProfile.spawnHeight;

  standingBeforeThrow = countStandingPins();
  rollingTimer = 0;
  settleTimer = 0;

  gameState = GAME_STATE.ROLLING;
  playLaunchSfx();
  setStatus(
    `${launchProfile.label} fired. Watch free-fall, rebound, and collision response.`
  );
}

function resetGame() {
  round = 1;
  throwInRound = 1;
  firstThrowPins = null;
  totalPinfall = 0;
  strikes = 0;
  spares = 0;
  standingBeforeThrow = 10;
  lastThrowPins = 0;
  launchSpeed = 0;
  rollingTimer = 0;
  settleTimer = 0;
  aimAngle = 0;
  chargePower = 0;

  roundLogEntries.length = 0;

  hud.aimSlider.value = "0";
  hud.powerSlider.value = "0";

  applySelectionSettings();

  setupFreshRack();
  resetBallForAim();
  gameState = GAME_STATE.AIMING;

  const config = getActivePhysicsConfig();
  setStatus(
    `${config.launchMode.label} + ${config.surfaceType.label} + ${config.ballType.label} ready. Aim with A/D, hold Space, release to roll.`
  );
  if (audioState.enabledSfx && ensureAudioReady()) {
    playTone(audioState.sfxGain, {
      frequency: 420,
      waveform: "sine",
      startTime: audioState.context.currentTime,
      duration: 0.06,
      volume: 0.1,
      attack: 0.004,
      release: 0.06,
    });
  }
  updateRoundLogUI();
  updateRoundSummary();
  updatePowerUI();
}

function canAim() {
  return gameState === GAME_STATE.AIMING || gameState === GAME_STATE.CHARGING;
}

function onKeyDown(event) {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === "KeyR") {
    resetGame();
    return;
  }

  if (gameState === GAME_STATE.GAMEOVER && event.code === "Enter") {
    resetGame();
    return;
  }

  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    keys.left = true;
  }

  if (event.code === "ArrowRight" || event.code === "KeyD") {
    keys.right = true;
  }

  if (event.code === "Space") {
    if (!keys.space) {
      keys.space = true;
      if (gameState === GAME_STATE.AIMING) {
        gameState = GAME_STATE.CHARGING;
        chargePower = 0;
      }
    }
  }
}

function onKeyUp(event) {
  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    keys.left = false;
  }

  if (event.code === "ArrowRight" || event.code === "KeyD") {
    keys.right = false;
  }

  if (event.code === "Space") {
    keys.space = false;
    if (gameState === GAME_STATE.CHARGING) {
      launchBall(chargePower);
    }
  }
}

hud.launchModeSelect.addEventListener("change", () => {
  selectedLaunchMode = hud.launchModeSelect.value;
  const config = getActivePhysicsConfig();
  setStatus(
    `${config.launchMode.label} selected. Launch angle ${config.launchMode.launchAngleDeg.toFixed(0)} deg.`
  );
});

hud.surfaceTypeSelect.addEventListener("change", () => {
  applySurfaceVisuals(hud.surfaceTypeSelect.value);
  const config = getActivePhysicsConfig();
  setStatus(
    `${config.surfaceType.label} selected. Friction and drag updated for next roll.`
  );
});

hud.ballTypeSelect.addEventListener("change", () => {
  applyBallType(hud.ballTypeSelect.value);
  const config = getActivePhysicsConfig();
  setStatus(
    `${config.ballType.label} selected. Mass is now ${ball.mass.toFixed(1)} kg.`
  );
});

hud.aimSlider.addEventListener("input", () => {
  if (!canAim()) {
    return;
  }

  const deg = Number(hud.aimSlider.value);
  aimAngle = THREE.MathUtils.degToRad(clamp(deg, -20, 20));
});

hud.powerSlider.addEventListener("input", () => {
  if (!canAim()) {
    return;
  }

  const pct = Number(hud.powerSlider.value);
  chargePower = clamp(pct / 100, 0, 1);
  updatePowerUI();
});

hud.rollBtn.addEventListener("click", () => {
  const sliderPower = Number(hud.powerSlider.value) / 100;
  launchBall(sliderPower);
});

hud.musicToggleBtn.addEventListener("click", () => {
  ensureAudioReady();
  audioState.enabledMusic = !audioState.enabledMusic;
  updateAudioButtons();
});

hud.sfxToggleBtn.addEventListener("click", () => {
  ensureAudioReady();
  audioState.enabledSfx = !audioState.enabledSfx;
  updateAudioButtons();
});

hud.resetBtn.addEventListener("click", resetGame);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function activateAudioOnFirstGesture() {
  ensureAudioReady();
  window.removeEventListener("pointerdown", activateAudioOnFirstGesture);
  window.removeEventListener("keydown", activateAudioOnFirstGesture);
  window.removeEventListener("touchstart", activateAudioOnFirstGesture);
}

window.addEventListener("pointerdown", activateAudioOnFirstGesture, { passive: true });
window.addEventListener("keydown", activateAudioOnFirstGesture);
window.addEventListener("touchstart", activateAudioOnFirstGesture, { passive: true });

function updateAimAndCharge(dt) {
  if (!canAim()) {
    return;
  }

  const turnDirection = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
  if (turnDirection !== 0) {
    aimAngle = clamp(aimAngle + turnDirection * AIM_SPEED * dt, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
    hud.aimSlider.value = `${Math.round(THREE.MathUtils.radToDeg(aimAngle))}`;
  }

  if (gameState === GAME_STATE.CHARGING && keys.space) {
    chargePower = clamp(chargePower + CHARGE_RATE * dt, 0, 1);
    hud.powerSlider.value = `${Math.round(chargePower * 100)}`;
  }

  if (gameState === GAME_STATE.AIMING && !keys.space) {
    const sliderPower = Number(hud.powerSlider.value) / 100;
    chargePower = clamp(sliderPower, 0, 1);
  }
}

function integrateBall(dt) {
  const config = getActivePhysicsConfig();
  const ySpeedBeforeStep = ball.velocity.y;

  const speed = ball.velocity.length();
  if (speed > 0.0001) {
    // Drag acceleration model: a_drag = (k / m) * |v| * v.
    const dragAccelerationScale = (config.airDragCoeff * speed) / ball.mass;
    ball.velocity.addScaledVector(ball.velocity, -dragAccelerationScale * dt);
  }

  ball.velocity.y -= GRAVITY * dt;
  ball.mesh.position.addScaledVector(ball.velocity, dt);

  if (ball.mesh.position.y < BALL_RADIUS) {
    ball.mesh.position.y = BALL_RADIUS;

    if (ball.velocity.y < 0) {
      const impactSpeed = Math.abs(ySpeedBeforeStep);
      ball.velocity.y *= -config.groundRebound;
      if (impactSpeed > 0.55) {
        playBounceSfx(impactSpeed);
      }
      if (Math.abs(ball.velocity.y) < 0.18) {
        ball.velocity.y = 0;
      }
    }

    const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (horizontalSpeed > 0) {
      const speedDrop = config.rollingFriction * GRAVITY * dt;
      const newSpeed = Math.max(0, horizontalSpeed - speedDrop);
      const scale = newSpeed / horizontalSpeed;
      ball.velocity.x *= scale;
      ball.velocity.z *= scale;
      ball.velocity.x *= config.surfaceType.groundDamping;
      ball.velocity.z *= config.surfaceType.groundDamping;
    }
  }

  ball.velocity.x *= BALL_DAMPING;
  ball.velocity.z *= BALL_DAMPING;

  if (Math.abs(ball.velocity.y) < 0.0005) {
    ball.velocity.y = 0;
  }

  const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
  if (horizontalSpeed > 0.0001) {
    // Rolling kinematics: angular displacement is linear travel over radius.
    const rollAngle = (horizontalSpeed * dt) / BALL_RADIUS;
    tempE.set(ball.velocity.z, 0, -ball.velocity.x).normalize();
    tempSpinQuat.setFromAxisAngle(tempE, rollAngle);
    ball.mesh.quaternion.premultiply(tempSpinQuat).normalize();
  }
}

function integratePins(dt) {
  const linearDecay = Math.pow(PIN_LINEAR_DAMPING, dt * 60);
  const angularDecay = Math.pow(PIN_ANGULAR_DAMPING, dt * 60);

  for (const pin of pins) {
    if (!pin.active) {
      continue;
    }

    pin.mesh.position.addScaledVector(pin.velocity, dt);
    pin.velocity.multiplyScalar(linearDecay);

    const angularSpeed = pin.angularVelocity.length();
    if (angularSpeed > 0) {
      tempA.copy(pin.angularVelocity).normalize();
      const angle = angularSpeed * dt;
      tempQuat.setFromAxisAngle(tempA, angle);
      pin.mesh.quaternion.premultiply(tempQuat).normalize();
    }

    pin.angularVelocity.multiplyScalar(angularDecay);

    if (pin.mesh.position.x > LANE_HALF_WIDTH + 0.35) {
      pin.mesh.position.x = LANE_HALF_WIDTH + 0.35;
      pin.velocity.x *= -0.2;
    }

    if (pin.mesh.position.x < -LANE_HALF_WIDTH - 0.35) {
      pin.mesh.position.x = -LANE_HALF_WIDTH - 0.35;
      pin.velocity.x *= -0.2;
    }

    const up = tempA.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    pin.mesh.position.y = PIN_CAP_RADIUS + PIN_HALF_SEGMENT * Math.abs(up.y);

    if (pin.velocity.lengthSq() < 0.00008) {
      pin.velocity.set(0, 0, 0);
    }

    if (pin.angularVelocity.lengthSq() < 0.0001) {
      pin.angularVelocity.set(0, 0, 0);
    }
  }
}

function solveBallWallCollision() {
  const limit = LANE_HALF_WIDTH - BALL_RADIUS;

  if (ball.mesh.position.x > limit) {
    const hitSpeed = Math.abs(ball.velocity.x);
    ball.mesh.position.x = limit;
    if (ball.velocity.x > 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
      if (hitSpeed > 0.4) {
        playWallHitSfx(hitSpeed);
      }
    }
  }

  if (ball.mesh.position.x < -limit) {
    const hitSpeed = Math.abs(ball.velocity.x);
    ball.mesh.position.x = -limit;
    if (ball.velocity.x < 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
      if (hitSpeed > 0.4) {
        playWallHitSfx(hitSpeed);
      }
    }
  }

  if (ball.mesh.position.z > LANE_START_Z + 0.8) {
    const hitSpeed = Math.abs(ball.velocity.z);
    ball.mesh.position.z = LANE_START_Z + 0.8;
    if (ball.velocity.z > 0) {
      ball.velocity.z *= -0.2;
      if (hitSpeed > 0.7) {
        playWallHitSfx(hitSpeed);
      }
    }
  }
}

function resolveSphereContact(
  posA,
  velA,
  invMassA,
  radiusA,
  posB,
  velB,
  invMassB,
  radiusB,
  restitution,
  friction
) {
  tempA.subVectors(posB, posA);
  let distance = tempA.length();
  const minDistance = radiusA + radiusB;

  if (distance >= minDistance) {
    return null;
  }

  if (distance < 1e-5) {
    tempA.set(1, 0, 0);
    distance = 1;
  }

  const normal = tempA.multiplyScalar(1 / distance);
  const penetration = minDistance - distance;
  const invMassSum = invMassA + invMassB;

  if (invMassSum <= 0) {
    return null;
  }

  const correction = penetration / invMassSum;
  posA.addScaledVector(normal, -correction * invMassA);
  posB.addScaledVector(normal, correction * invMassB);

  tempB.subVectors(velB, velA);
  const normalSpeed = tempB.dot(normal);

  let impulseValue = 0;

  if (normalSpeed < 0) {
    impulseValue = (-(1 + restitution) * normalSpeed) / invMassSum;
    tempImpulse.copy(normal).multiplyScalar(impulseValue);

    velA.addScaledVector(tempImpulse, -invMassA);
    velB.addScaledVector(tempImpulse, invMassB);

    tempC.copy(tempB).addScaledVector(normal, -normalSpeed);
    const tangentLength = tempC.length();

    if (tangentLength > 1e-5) {
      tempC.multiplyScalar(1 / tangentLength);
      let tangentImpulse = -tempB.dot(tempC) / invMassSum;
      const maxTangent = impulseValue * friction;
      tangentImpulse = clamp(tangentImpulse, -maxTangent, maxTangent);

      tempD.copy(tempC).multiplyScalar(tangentImpulse);
      velA.addScaledVector(tempD, -invMassA);
      velB.addScaledVector(tempD, invMassB);
    }
  }

  return {
    normal: normal.clone(),
    impulse: impulseValue,
  };
}

function solveBallPinCollisions() {
  const config = getActivePhysicsConfig();

  for (const pin of pins) {
    if (!pin.active) {
      continue;
    }

    const result = resolveSphereContact(
      ball.mesh.position,
      ball.velocity,
      ball.invMass,
      ball.radius,
      pin.mesh.position,
      pin.velocity,
      pin.invMass,
      pin.radius,
      BALL_PIN_RESTITUTION,
      CONTACT_FRICTION
    );

    if (!result) {
      continue;
    }

    playImpactSfx(result.impulse * 0.08);

    const horizontalNormal = result.normal.clone();
    horizontalNormal.y = 0;

    if (horizontalNormal.lengthSq() > 0.00001) {
      horizontalNormal.normalize();
      const tipAxis = tempA.set(horizontalNormal.z, 0, -horizontalNormal.x).normalize();
      const tipStrength = result.impulse * 0.36 * config.impactMultiplier;
      pin.angularVelocity.addScaledVector(tipAxis, tipStrength);
      pin.angularVelocity.y += (Math.random() - 0.5) * 0.18;
    }
  }
}

function solvePinPinCollisions() {
  for (let i = 0; i < pins.length; i += 1) {
    const a = pins[i];
    if (!a.active) {
      continue;
    }

    for (let j = i + 1; j < pins.length; j += 1) {
      const b = pins[j];
      if (!b.active) {
        continue;
      }

      const result = resolveSphereContact(
        a.mesh.position,
        a.velocity,
        a.invMass,
        a.radius,
        b.mesh.position,
        b.velocity,
        b.invMass,
        b.radius,
        PIN_PIN_RESTITUTION,
        CONTACT_FRICTION * 0.8
      );

      if (!result) {
        continue;
      }

      const horizontalNormal = result.normal.clone();
      horizontalNormal.y = 0;

      if (horizontalNormal.lengthSq() > 0.00001) {
        horizontalNormal.normalize();
        const axisA = tempA.set(horizontalNormal.z, 0, -horizontalNormal.x).normalize();
        const axisB = axisA.clone().multiplyScalar(-1);
        const tipStrength = result.impulse * 0.2;
        a.angularVelocity.addScaledVector(axisA, tipStrength);
        b.angularVelocity.addScaledVector(axisB, tipStrength);
      }
    }
  }
}

function markKnockedPins() {
  for (const pin of pins) {
    if (!pin.active || pin.knocked) {
      continue;
    }

    const up = tempA.set(0, 1, 0).applyQuaternion(pin.mesh.quaternion);
    const tilt = Math.acos(clamp(up.y, -1, 1));

    if (tilt > KNOCK_ANGLE) {
      pin.knocked = true;
    }
  }
}

function pinsSleeping() {
  for (const pin of pins) {
    if (!pin.active) {
      continue;
    }

    if (pin.velocity.lengthSq() > 0.0012 || pin.angularVelocity.lengthSq() > 0.02) {
      return false;
    }
  }

  return true;
}

function updateThrowLifecycle(dt) {
  if (gameState === GAME_STATE.ROLLING) {
    rollingTimer += dt;

    const speed = ball.velocity.length();
    const airborne = ball.mesh.position.y > BALL_RADIUS + 0.08;
    const pastPinDeck = ball.mesh.position.z < PIN_HEAD_Z - 1.8;
    const leftPlayableArea =
      ball.mesh.position.z < LANE_END_Z - 1.2 ||
      Math.abs(ball.mesh.position.x) > LANE_HALF_WIDTH + 1.4;

    const shouldSettle =
      leftPlayableArea ||
      (!airborne && pastPinDeck && speed < 0.25) ||
      (!airborne && speed < 0.22 && rollingTimer > 1.4) ||
      (!airborne && rollingTimer > MAX_ROLL_TIME) ||
      rollingTimer > MAX_ROLL_TIME + 2.4;

    if (shouldSettle) {
      gameState = GAME_STATE.SETTLING;
      settleTimer = 0;
      ball.velocity.multiplyScalar(0.8);
    }
  }

  if (gameState === GAME_STATE.SETTLING) {
    settleTimer += dt;

    if (settleTimer > 0.9 && pinsSleeping()) {
      finishThrow();
    }
  }
}

function updateCamera() {
  if (gameState === GAME_STATE.AIMING || gameState === GAME_STATE.CHARGING) {
    const config = getActivePhysicsConfig();
    const targetX = Math.sin(aimAngle) * 8;
    tempA.set(targetX, 0.55 + config.launchMode.spawnHeight * 0.1, PIN_HEAD_Z + 1.2);

    tempB.copy(aimCamPos);
    tempB.y += config.launchMode.spawnHeight * 0.32;

    camera.position.lerp(tempB, 0.1);
    camera.lookAt(tempA);
    return;
  }

  if (gameState === GAME_STATE.ROLLING || gameState === GAME_STATE.SETTLING) {
    const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);

    if (horizontalSpeed > 0.1) {
      followDirection.set(ball.velocity.x, 0, ball.velocity.z).normalize();
    }

    tempA.copy(followDirection).multiplyScalar(-5.3);
    tempA.y = ball.mesh.position.y + 2;
    tempA.add(ball.mesh.position);

    camera.position.lerp(tempA, 0.08);

    tempB.copy(ball.mesh.position);
    tempB.addScaledVector(followDirection, 2.2);
    tempB.y += 0.55;
    camera.lookAt(tempB);
    return;
  }

  tempA.set(0, 4.2, 6.5);
  camera.position.lerp(tempA, 0.03);
  camera.lookAt(0, 0.6, -13);
}

function stepPhysics(dt) {
  updateAimAndCharge(dt);

  if (gameState === GAME_STATE.ROLLING || gameState === GAME_STATE.SETTLING) {
    integrateBall(dt);
    integratePins(dt);
    solveBallWallCollision();
    solveBallPinCollisions();
    solvePinPinCollisions();
    markKnockedPins();
    updateThrowLifecycle(dt);
  }
}

function animate() {
  requestAnimationFrame(animate);

  const rawDt = Math.min(clock.getDelta(), 0.05);
  accumulator += rawDt;

  while (accumulator >= FIXED_DT) {
    stepPhysics(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  updatePowerUI();
  updateRoundSummary();
  updatePhysicsSidebar(rawDt);
  updateConfigControlsLock();
  scheduleMusic();
  updateRollingSfx();
  updateCamera();
  renderer.render(scene, camera);
}

updateAudioButtons();
resetGame();
animate();
