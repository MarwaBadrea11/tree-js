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
const BALL_MASS = 7.0;
const BALL_START = new THREE.Vector3(0, BALL_RADIUS, 8.3);
const ROLLING_FRICTION = 0.11;
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

function createLane() {
  const laneLength = LANE_START_Z - LANE_END_Z;
  const laneCenterZ = (LANE_START_Z + LANE_END_Z) * 0.5;

  const lane = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_HALF_WIDTH * 2, 0.08, laneLength),
    new THREE.MeshStandardMaterial({
      color: 0xba8958,
      roughness: 0.4,
      metalness: 0.07,
    })
  );
  lane.position.set(0, -0.04, laneCenterZ);
  lane.receiveShadow = true;
  scene.add(lane);

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
      color: 0x7ca18f,
      roughness: 1,
      metalness: 0,
    })
  );
  roomFloor.rotation.x = -Math.PI / 2;
  roomFloor.position.y = -0.09;
  roomFloor.receiveShadow = true;
  scene.add(roomFloor);
}

createLane();

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_RADIUS, 40, 28),
  new THREE.MeshStandardMaterial({
    color: 0x1d5f8f,
    roughness: 0.2,
    metalness: 0.3,
  })
);
ballMesh.castShadow = true;
ballMesh.position.copy(BALL_START);
scene.add(ballMesh);

const ball = {
  mesh: ballMesh,
  velocity: new THREE.Vector3(),
  mass: BALL_MASS,
  invMass: 1 / BALL_MASS,
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
    dt: document.querySelector("#stat-dt"),
    speed: document.querySelector("#stat-speed"),
    horizontalSpeed: document.querySelector("#stat-horizontal-speed"),
    kinetic: document.querySelector("#stat-kinetic"),
    momentum: document.querySelector("#stat-momentum"),
    friction: document.querySelector("#stat-friction"),
    gravity: document.querySelector("#stat-gravity"),
    angle: document.querySelector("#stat-angle"),
    launchSpeed: document.querySelector("#stat-launch-speed"),
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
const tempImpulse = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const identityQuat = new THREE.Quaternion();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  const speed = ball.velocity.length();
  const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
  const kinetic = 0.5 * BALL_MASS * speed * speed;
  const momentum = BALL_MASS * speed;

  const onGround = ball.mesh.position.y <= BALL_RADIUS + 0.0001;
  const frictionForce = onGround ? ROLLING_FRICTION * BALL_MASS * GRAVITY : 0;
  const gravityForce = BALL_MASS * GRAVITY;

  hud.stats.state.textContent = gameState;
  hud.stats.dt.textContent = `${(dt * 1000).toFixed(2)} ms`;
  hud.stats.speed.textContent = `${speed.toFixed(2)} m/s`;
  hud.stats.horizontalSpeed.textContent = `${horizontalSpeed.toFixed(2)} m/s`;
  hud.stats.kinetic.textContent = `${kinetic.toFixed(2)} J`;
  hud.stats.momentum.textContent = `${momentum.toFixed(2)} kg m/s`;
  hud.stats.friction.textContent = `${frictionForce.toFixed(2)} N`;
  hud.stats.gravity.textContent = `${gravityForce.toFixed(2)} N`;
  hud.stats.angle.textContent = `${THREE.MathUtils.radToDeg(aimAngle).toFixed(1)} deg`;
  hud.stats.launchSpeed.textContent = `${launchSpeed.toFixed(2)} m/s`;
  hud.stats.ballPos.textContent = `${ball.mesh.position.x.toFixed(2)}, ${ball.mesh.position.y.toFixed(2)}, ${ball.mesh.position.z.toFixed(2)}`;
  hud.stats.standing.textContent = `${countStandingPins()} / 10`;
}

function endGame() {
  gameState = GAME_STATE.GAMEOVER;
  ball.velocity.set(0, 0, 0);
  setStatus(`Game over. Total pinfall: ${totalPinfall}. Press R to restart.`);
}

function finishThrow() {
  const standingAfter = countStandingPins();
  lastThrowPins = Math.max(0, standingBeforeThrow - standingAfter);
  totalPinfall += lastThrowPins;

  if (throwInRound === 1) {
    firstThrowPins = lastThrowPins;

    if (standingAfter === 0) {
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
  chargePower = power;
  hud.powerSlider.value = `${Math.round(power * 100)}`;

  launchSpeed = MIN_LAUNCH_SPEED + (MAX_LAUNCH_SPEED - MIN_LAUNCH_SPEED) * power;

  tempA.set(Math.sin(aimAngle), 0, -Math.cos(aimAngle)).normalize();
  ball.velocity.copy(tempA.multiplyScalar(launchSpeed));
  ball.mesh.position.y = BALL_RADIUS;

  standingBeforeThrow = countStandingPins();
  rollingTimer = 0;
  settleTimer = 0;

  gameState = GAME_STATE.ROLLING;
  setStatus("Ball rolling... watch collisions and physics values.");
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

  setupFreshRack();
  resetBallForAim();
  gameState = GAME_STATE.AIMING;

  setStatus("Aim with A/D, hold Space, release to roll.");
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

hud.resetBtn.addEventListener("click", resetGame);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
  ball.velocity.y -= GRAVITY * dt;
  ball.mesh.position.addScaledVector(ball.velocity, dt);

  if (ball.mesh.position.y < BALL_RADIUS) {
    ball.mesh.position.y = BALL_RADIUS;

    if (ball.velocity.y < 0) {
      ball.velocity.y = 0;
    }

    const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (horizontalSpeed > 0) {
      const speedDrop = ROLLING_FRICTION * GRAVITY * dt;
      const newSpeed = Math.max(0, horizontalSpeed - speedDrop);
      const scale = newSpeed / horizontalSpeed;
      ball.velocity.x *= scale;
      ball.velocity.z *= scale;
    }
  }

  ball.velocity.x *= BALL_DAMPING;
  ball.velocity.z *= BALL_DAMPING;

  if (Math.abs(ball.velocity.y) < 0.0005) {
    ball.velocity.y = 0;
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
    ball.mesh.position.x = limit;
    if (ball.velocity.x > 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
    }
  }

  if (ball.mesh.position.x < -limit) {
    ball.mesh.position.x = -limit;
    if (ball.velocity.x < 0) {
      ball.velocity.x *= -WALL_RESTITUTION;
    }
  }

  if (ball.mesh.position.z > LANE_START_Z + 0.8) {
    ball.mesh.position.z = LANE_START_Z + 0.8;
    if (ball.velocity.z > 0) {
      ball.velocity.z *= -0.2;
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

    const horizontalNormal = result.normal.clone();
    horizontalNormal.y = 0;

    if (horizontalNormal.lengthSq() > 0.00001) {
      horizontalNormal.normalize();
      const tipAxis = tempA.set(horizontalNormal.z, 0, -horizontalNormal.x).normalize();
      const tipStrength = result.impulse * 0.36;
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
    const pastPinDeck = ball.mesh.position.z < PIN_HEAD_Z - 1.8;
    const leftPlayableArea =
      ball.mesh.position.z < LANE_END_Z - 1.2 ||
      Math.abs(ball.mesh.position.x) > LANE_HALF_WIDTH + 1.4;

    const shouldSettle =
      leftPlayableArea ||
      (pastPinDeck && speed < 0.25) ||
      (speed < 0.22 && rollingTimer > 1.4) ||
      rollingTimer > MAX_ROLL_TIME;

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
    const targetX = Math.sin(aimAngle) * 8;
    tempA.set(targetX, 0.45, PIN_HEAD_Z + 1.2);

    camera.position.lerp(aimCamPos, 0.1);
    camera.lookAt(tempA);
    return;
  }

  if (gameState === GAME_STATE.ROLLING || gameState === GAME_STATE.SETTLING) {
    const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);

    if (horizontalSpeed > 0.1) {
      followDirection.set(ball.velocity.x, 0, ball.velocity.z).normalize();
    }

    tempA.copy(followDirection).multiplyScalar(-5.3);
    tempA.y = 2;
    tempA.add(ball.mesh.position);

    camera.position.lerp(tempA, 0.08);

    tempB.copy(ball.mesh.position);
    tempB.addScaledVector(followDirection, 2.2);
    tempB.y += 0.45;
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
  updateCamera();
  renderer.render(scene, camera);
}

resetGame();
animate();
