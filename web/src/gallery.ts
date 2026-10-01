// Preview page for the hand-built NPC characters: /characters.html
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { NPC_AVATARS } from "@musehouse/shared";
import { animateRig, buildCharacter, type Rig } from "./characters";

const NAMES: Record<string, string> = { "npc-cap": "Sam", "npc-plush": "Puff", "npc-lavender": "Jeremy", "npc-eyeball": "Argus" };
const ANIMS = ["idle", "walk", "sit", "wave", "cheer", "interact-right", "emote-yes", "emote-no", "pick-up"];

const host = document.getElementById("gallery")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f3ece2");
scene.add(new THREE.HemisphereLight(0xffffff, 0xb59f86, 1.6));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(3, 6, 5);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: "#e6dccd" }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
camera.position.set(0, 1.6, 6.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.65, 0);
controls.enableDamping = true;

const rigs: Rig[] = NPC_AVATARS.map((avatar, i) => {
  const rig = buildCharacter(avatar);
  rig.root.position.x = (i - 1.5) * 1.15;
  scene.add(rig.root);
  const label = document.createElement("div");
  label.className = "pill";
  label.style.cssText = "position:fixed;transform:translate(-50%,0);z-index:2;font-weight:700";
  label.textContent = NAMES[avatar];
  document.body.appendChild(label);
  rig.root.userData.label = label;
  return rig;
});

let anim = new URLSearchParams(location.search).get("anim") ?? "idle";
const ui = document.getElementById("anims")!;
for (const a of ANIMS) {
  const b = document.createElement("button");
  b.textContent = a;
  b.onclick = () => {
    anim = a;
    for (const c of ui.children) c.classList.toggle("on", c === b);
  };
  b.classList.toggle("on", a === anim);
  ui.appendChild(b);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.position.z = camera.aspect < 1 ? 11 : 6.2;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  for (const rig of rigs) {
    animateRig(rig, anim, t, dt);
    rig.root.position.y = anim === "sit" ? rig.hipHeight - 0.03 : 0;
    const p = rig.root.position.clone().setY(-0.08).project(camera);
    const label = rig.root.userData.label as HTMLElement;
    label.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    label.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  }
  controls.update();
  renderer.render(scene, camera);
});
