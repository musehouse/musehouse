import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { HouseDef, MusePublic } from "@musehouse/shared";
import { loadGLTF, MODEL_SCALE } from "./assets";
import { animateRig, buildCharacter, isNpcAvatar, type Rig } from "./characters";

const SPEECH_MS = 7000;

function el(tag: string, className: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

/** Shortest signed difference between two angles. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class MuseView {
  readonly root = new THREE.Group();
  /** Invisible cylinder used for click picking. */
  readonly hitbox: THREE.Mesh;
  private body: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAnim = "";
  /** Hand-built NPC characters are animated procedurally instead of with clips. */
  private rig: Rig | null = null;
  private rigAnim = "idle";
  private time = Math.random() * 10;
  private labelObj!: CSS2DObject;
  private readonly ring: THREE.Mesh;
  private readonly label: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly thoughtEl: HTMLElement;
  private bubbleTimer = 0;
  private target = new THREE.Vector3();
  private targetFacing = 0;
  private targetY = 0;
  private lieOffset = 0;
  data: MusePublic;
  selected = false;

  constructor(
    data: MusePublic,
    private readonly house: HouseDef,
    onClick: (id: string) => void,
  ) {
    this.data = data;
    this.root.position.set(data.x, 0, data.z);
    this.target.copy(this.root.position);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.36, 32),
      new THREE.MeshBasicMaterial({ color: data.color, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.root.add(this.ring);

    this.hitbox = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 1.3, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.hitbox.position.y = 0.65;
    this.hitbox.userData.museId = data.id;
    this.root.add(this.hitbox);

    // HTML label floating above the head: speech bubble, thought bubble, name tag.
    this.label = el("div", "muse-label");
    this.bubble = el("div", "bubble speech hidden", this.label);
    this.thoughtEl = el("div", "bubble thought hidden", this.label);
    const tag = el("div", "tag", this.label);
    const dot = el("span", "dot", tag);
    dot.style.background = data.color;
    this.nameEl = el("span", "name", tag);
    this.nameEl.textContent = data.name;
    this.iconEl = el("span", "icon", tag);
    if (data.npc) {
      const badge = el("span", "npc-badge", tag);
      badge.textContent = "NPC";
    }
    tag.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(data.id);
    });
    const label = new CSS2DObject(this.label);
    label.position.set(0, 1.45, 0);
    label.center.set(0.5, 1);
    this.root.add(label);
    this.labelObj = label;

    void this.loadBody(data.avatar);
  }

  private async loadBody(avatar: string) {
    if (isNpcAvatar(avatar)) {
      this.rig = buildCharacter(avatar);
      this.body = this.rig.root;
      this.root.add(this.body);
      this.labelObj.position.y = this.rig.height + 0.25;
      this.applyPose();
      return;
    }
    const gltf = await loadGLTF(`/assets/characters/character-${avatar}.glb`);
    let body: THREE.Object3D;
    if (gltf) {
      const character = cloneSkinned(gltf.scene);
      // Kenney characters already face +z, matching our convention (facing 0 = south).
      character.scale.setScalar(MODEL_SCALE);
      body = new THREE.Group();
      body.add(character);
      this.mixer = new THREE.AnimationMixer(character);
      for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    } else {
      // Placeholder capsule if the character model is missing.
      body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.22, 0.6, 4, 12),
        new THREE.MeshStandardMaterial({ color: this.data.color }),
      );
      body.position.y = 0.52;
    }
    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.body = body;
    this.root.add(body);
    this.currentAnim = "";
    this.applyPose();
  }

  update(data: MusePublic) {
    const prevActivity = this.data.activity;
    this.data = data;
    this.target.set(data.x, 0, data.z);
    this.targetFacing = data.facing;

    const icon = data.activity.icon ?? (data.activity.kind === "walking" ? "🚶" : "");
    if (this.iconEl.textContent !== icon) this.iconEl.textContent = icon;

    if (data.thought) {
      this.thoughtEl.textContent = data.thought.text;
      this.thoughtEl.classList.remove("hidden");
    } else {
      this.thoughtEl.classList.add("hidden");
    }

    if (
      prevActivity.kind !== data.activity.kind ||
      prevActivity.verb !== data.activity.verb ||
      prevActivity.emote !== data.activity.emote ||
      prevActivity.seat !== data.activity.seat
    ) {
      this.applyPose();
    }
  }

  say(text: string, toName?: string) {
    this.bubble.textContent = toName && !text.includes(toName) ? `@${toName} ${text}` : text;
    this.bubble.classList.remove("hidden");
    this.bubbleTimer = SPEECH_MS;
  }

  /** A "+0.10 USDC 💸" badge that floats up over the muse when they receive a tip. */
  tipped(amount: string) {
    const pop = el("div", "tip-pop");
    pop.textContent = `+${amount} USDC 💸`;
    this.label.prepend(pop);
    setTimeout(() => pop.remove(), 3200);
  }

  setSelected(selected: boolean) {
    this.selected = selected;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = selected ? 1 : 0.55;
    this.ring.scale.setScalar(selected ? 1.3 : 1);
    this.label.classList.toggle("selected", selected);
  }

  private applyPose() {
    const a = this.data.activity;
    this.targetY = 0;
    this.lieOffset = 0;
    if (this.body) this.body.rotation.set(0, 0, 0);
    if (a.kind === "using" && a.objectId !== undefined && a.seat !== undefined) {
      const obj = this.house.objects.find((o) => o.id === a.objectId);
      const seat = obj?.seats?.[a.seat];
      if (seat) this.targetY = seat.y;
    }
    if (a.pose === "lie" && this.body) {
      // Lie on the back, head towards the object's "back" side.
      this.body.rotation.x = -Math.PI / 2;
      this.lieOffset = this.rig ? this.rig.height * 0.47 : 0.55;
    }
    let anim = a.anim ?? (a.kind === "walking" ? "walk" : a.pose === "sit" ? "sit" : "idle");
    if (this.rig) {
      this.rigAnim = a.pose === "lie" ? "static" : a.emote === "wave" ? "wave" : a.emote === "cheer" ? "cheer" : anim;
      return;
    }
    if (a.pose === "lie") anim = "idle";
    this.play(anim);
  }

  private play(name: string) {
    if (!this.mixer || name === this.currentAnim) return;
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next) return;
    const prev = this.actions.get(this.currentAnim);
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play();
    if (prev && prev !== next) prev.fadeOut(0.25);
    this.currentAnim = name;
  }

  frame(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    this.root.position.x += (this.target.x - this.root.position.x) * k;
    this.root.position.z += (this.target.z - this.root.position.z) * k;
    this.root.position.y += (this.targetY - this.root.position.y) * k;
    this.root.rotation.y += angleDelta(this.root.rotation.y, this.targetFacing) * Math.min(1, dt * 10);
    if (this.body) this.body.position.z = this.lieOffset;
    this.ring.visible = this.data.activity.pose === "stand";
    this.mixer?.update(dt);
    this.time += dt;
    if (this.rig) animateRig(this.rig, this.rigAnim, this.time, dt);

    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt * 1000;
      if (this.bubbleTimer <= 0) this.bubble.classList.add("hidden");
    }
  }

  dispose() {
    this.label.remove();
    this.root.removeFromParent();
  }
}
