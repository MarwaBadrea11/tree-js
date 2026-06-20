

import * as THREE from "three";


export const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8dcc0);
scene.fog = new THREE.Fog(0xe8dcc0, 20, 60);


export const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
100
);


const appRoot = document.querySelector("#game-root");

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
appRoot.appendChild(renderer.domElement);


export const clock = new THREE.Clock();
export let accumulator = 0;
export function addToAccumulator(v) { accumulator += v; }
export function drainAccumulator(dt) { accumulator -= dt; }


const ambientLight = new THREE.AmbientLight(0xffffff, 0.58);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff0d7, 1.12);
keyLight.position.set(5, 14, 10);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left   = -8;
keyLight.shadow.camera.right  =  8;
keyLight.shadow.camera.top    =  8;
keyLight.shadow.camera.bottom = -8;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x89ffe7, 0.32);
rimLight.position.set(-7, 5, -20);
scene.add(rimLight);


window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
