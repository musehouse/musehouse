import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { NpcAvatar } from "@musehouse/shared";

/**
 * Hand-built NPC characters (no external art). Each one is a small rig of pivots
 * (spine, head, shoulders, elbows, hips) animated procedurally by `animateRig`.
 * Characters face +z; their left side is +x.
 */

type IdleStyle = "cross" | "wave" | "calm" | "flex";

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
}

export interface Rig {
  root: THREE.Group;
  /** Moved up/down for bobbing, jumping and sitting. */
  body: THREE.Group;
  /** Pivot at hip height holding torso, head and arms. */
  spine: THREE.Group;
  head: THREE.Group;
  armL: Arm;
  armR: Arm;
  legL: THREE.Group;
  legR: THREE.Group;
  hipHeight: number;
  height: number;
  idle: IdleStyle;
  /** Left arm keeps holding something (the plush's laptop). */
  holdLeft?: boolean;
  /** Per-frame extras, e.g. blinking eyes. */
  extra?: (dt: number, t: number) => void;
}

// ---------------------------------------------------------------- helpers

function std(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function group(x = 0, y = 0, z = 0, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (children.length) g.add(...children);
  return g;
}

/** A capsule hanging down from its pivot (pivot at the top). */
function hanging(length: number, radius: number, material: THREE.Material): THREE.Mesh {
  return mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material, 0, -length / 2, 0);
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function decalMaterial(map: THREE.Texture) {
  return new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.05, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** A flat decal (for flat surfaces like a shirt front). */
function flatDecal(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMaterial(tex));
  m.position.set(x, y, z);
  return m;
}

/** A decal wrapped around the front of a (possibly tapered) round surface, e.g. a cap crown or a hoodie. */
function bandDecal(tex: THREE.Texture, y: number, height: number, rBottom: number, rTop: number, width: number): THREE.Mesh {
  const theta = width / ((rBottom + rTop) / 2);
  const geo = new THREE.CylinderGeometry(rTop, rBottom, height, 24, 1, true, -theta / 2, theta);
  const m = new THREE.Mesh(geo, decalMaterial(tex));
  m.position.y = y;
  return m;
}

/** A band decal hugging the front of a dome (a sphere cap scaled to height `h`) between heights y0 and y1. */
function domeDecal(tex: THREE.Texture, radius: number, h: number, y0: number, y1: number, width: number): THREE.Mesh {
  const r = (y: number) => radius * Math.sqrt(Math.max(0, 1 - (y / h) ** 2)) + 0.004;
  return bandDecal(tex, (y0 + y1) / 2, y1 - y0, r(y0), r(y1), width);
}

function smile(radius: number, tube: number, material: THREE.Material, y: number, z: number): THREE.Mesh {
  const m = mesh(new THREE.TorusGeometry(radius, tube, 6, 16, Math.PI), material, 0, y, z);
  m.rotation.z = Math.PI;
  return m;
}

// ---------------------------------------------------------------- logos (drawn, no image files)

function drawArcMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const lw = size * 0.17;
  const l = x + size * 0.2 + lw / 2;
  const r = x + size * 0.8 - lw / 2;
  const rad = (r - l) / 2;
  const cx = (l + r) / 2;
  const archY = y + size * 0.1 + lw / 2 + rad;
  const bottom = y + size * 0.92;
  const footY = bottom - lw / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(l, bottom);
  ctx.lineTo(l, archY);
  ctx.arc(cx, archY, rad, Math.PI, 0);
  ctx.lineTo(r, footY - lw * 0.6);
  ctx.quadraticCurveTo(r, footY, r - lw * 0.6, footY);
  ctx.lineTo(cx - size * 0.04, footY);
  ctx.stroke();
}

const arcMarkTexture = (color: string) => canvasTexture(128, 128, (ctx) => drawArcMark(ctx, 4, 4, 120, color));

const circleCapTexture = () =>
  canvasTexture(512, 128, (ctx) => {
    const cx = 92;
    const cy = 64;
    const grad = ctx.createLinearGradient(cx - 40, cy - 40, cx + 40, cy + 40);
    grad.addColorStop(0, "#2fd1b2");
    grad.addColorStop(0.5, "#3b8de6");
    grad.addColorStop(1, "#8b5cf6");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(cx, cy, 17, Math.PI * 0.35, Math.PI * 1.85);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 68px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("CIRCLE", 152, cy + 3);
  });

const usdcTexture = () =>
  canvasTexture(512, 160, (ctx) => {
    const cx = 86;
    const cy = 80;
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, 62, Math.PI * 0.62, Math.PI * 1.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 62, -Math.PI * 0.38, Math.PI * 0.38);
    ctx.stroke();
    ctx.font = "700 92px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", cx, cy + 4);
    ctx.textAlign = "left";
    ctx.font = "700 108px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText("USDC", 170, cy + 6);
  });

const laptopScreenTexture = () =>
  canvasTexture(256, 176, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 256, 176);
    g.addColorStop(0, "#3d6aa8");
    g.addColorStop(1, "#0f1f3d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 176);
    drawArcMark(ctx, 34, 52, 74, "#ffffff");
    ctx.fillStyle = "#ffffff";
    ctx.font = "400 58px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Arc", 116, 92);
  });

/** Skin with ink: a full tattoo sleeve. */
const tattooTexture = (skin: string) =>
  canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(25,18,15,0.75)";
    ctx.fillStyle = "rgba(25,18,15,0.55)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 20, y - 25, x - 15, y + 30, x + 25, y + 20);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }
  });

const furTexture = () => {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#ecd8b6";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) {
      ctx.strokeStyle = Math.random() < 0.5 ? "rgba(255,248,232,0.5)" : "rgba(190,160,120,0.35)";
      ctx.lineWidth = 1;
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 4, y + 3 + Math.random() * 3);
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
};

// ---------------------------------------------------------------- shared human body

interface HumanLook {
  skin: THREE.Material;
  upperArm: THREE.Material;
  forearm: THREE.Material;
  hand: THREE.Material;
  torso: THREE.Material;
  legs: THREE.Material;
  shoes: THREE.Material;
  sleeve?: THREE.Material;
}

/** Chibi human: big rounded head, short body. Returns the rig without face/hair details. */
function humanBase(look: HumanLook, idle: IdleStyle): Rig {
  const hipHeight = 0.38;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const legL = group(0.09, hipHeight, 0, hanging(0.26, 0.075, look.legs));
  const legR = group(-0.09, hipHeight, 0, hanging(0.26, 0.075, look.legs));
  for (const leg of [legL, legR]) {
    const shoe = mesh(new RoundedBoxGeometry(0.14, 0.08, 0.22, 2, 0.03), look.shoes, 0, -hipHeight + 0.04, 0.03);
    leg.add(shoe);
  }

  const spine = group(0, hipHeight);
  spine.add(mesh(new RoundedBoxGeometry(0.38, 0.36, 0.24, 3, 0.07), look.torso, 0, 0.18, 0));
  spine.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 10), look.skin, 0, 0.38, 0));

  const head = group(0, 0.58);
  head.add(mesh(new RoundedBoxGeometry(0.38, 0.36, 0.34, 4, 0.1), look.skin));
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.045, 10, 8), look.skin, s * 0.19, -0.01, 0));
  spine.add(head);

  const makeArm = (side: 1 | -1): Arm => {
    const shoulder = group(side * 0.235, 0.32, 0);
    shoulder.add(hanging(0.12, 0.056, look.upperArm));
    if (look.sleeve) shoulder.add(mesh(new THREE.CylinderGeometry(0.068, 0.07, 0.1, 12), look.sleeve, 0, -0.03, 0));
    const elbow = group(0, -0.15, 0);
    elbow.add(hanging(0.11, 0.05, look.forearm));
    elbow.add(mesh(new THREE.SphereGeometry(0.058, 10, 8), look.hand, 0, -0.16, 0));
    shoulder.add(elbow);
    spine.add(shoulder);
    return { shoulder, elbow };
  };

  body.add(legL, legR, spine);
  return { root, body, spine, head, armL: makeArm(1), armR: makeArm(-1), legL, legR, hipHeight, height: 1.18, idle };
}

function eyesAndSmile(head: THREE.Group, eye: THREE.Material, mouth: THREE.Material, z = 0.172) {
  for (const s of [-1, 1]) {
    const e = mesh(new THREE.SphereGeometry(0.03, 10, 8), eye, s * 0.08, 0.02, z);
    e.scale.set(0.9, 1.15, 0.5);
    head.add(e);
  }
  head.add(smile(0.05, 0.009, mouth, -0.06, z));
}

// ---------------------------------------------------------------- the four NPCs

/** Snapback cap, blue-grey tee with the arch logo, tattooed arms, crossed arms. */
function buildCap(): Rig {
  const skinColor = "#7a4a32";
  const skin = std(skinColor);
  const ink = std("#ffffff", { map: tattooTexture(skinColor) });
  const tee = std("#7f98a5", { roughness: 0.9 });
  const rig = humanBase(
    { skin, upperArm: ink, forearm: ink, hand: skin, torso: tee, legs: std("#2c3038"), shoes: std("#1a1a1a"), sleeve: tee },
    "cross",
  );
  const dark = std("#141414", { roughness: 0.5 });
  eyesAndSmile(rig.head, dark, std("#3a1d14"));
  // Teeth peeking out of the big smile, a goatee and eyebrows.
  rig.head.add(mesh(new THREE.BoxGeometry(0.07, 0.014, 0.01), std("#ffffff"), 0, -0.065, 0.172));
  rig.head.add(mesh(new RoundedBoxGeometry(0.07, 0.05, 0.03, 2, 0.01), std("#1b1311"), 0, -0.135, 0.165));
  for (const s of [-1, 1]) rig.head.add(mesh(new THREE.BoxGeometry(0.07, 0.014, 0.012), std("#1b1311"), s * 0.08, 0.085, 0.172));

  // Black snapback with a flat brim and the arch logo.
  const cap = group(0, 0.15, 0);
  const crown = mesh(new THREE.SphereGeometry(0.205, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  crown.scale.y = 0.75;
  cap.add(crown);
  const brim = mesh(new RoundedBoxGeometry(0.32, 0.022, 0.17, 2, 0.008), dark, 0, 0.005, 0.24);
  cap.add(brim);
  cap.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), dark, 0, 0.155, 0));
  cap.add(domeDecal(arcMarkTexture("#f2f2f2"), 0.205, 0.205 * 0.75, 0.02, 0.095, 0.075));
  rig.head.add(cap);

  // Arch logo on the tee.
  rig.spine.add(flatDecal(arcMarkTexture("#1c1c1c"), 0.17, 0.17, 0, 0.19, 0.122));
  return rig;
}

/** Bald visionary in a lavender button shirt. */
function buildLavender(): Rig {
  const skin = std("#e8c2a3", { roughness: 0.55 });
  const shirt = std("#c6b1e6", { roughness: 0.85 });
  const rig = humanBase(
    { skin, upperArm: shirt, forearm: shirt, hand: skin, torso: shirt, legs: std("#363c4a"), shoes: std("#4e3326") },
    "calm",
  );
  // Blue eyes, a calm closed-mouth smile.
  for (const s of [-1, 1]) {
    rig.head.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), std("#ffffff"), s * 0.08, 0.02, 0.164));
    rig.head.add(mesh(new THREE.SphereGeometry(0.017, 8, 6), std("#3f6fa8"), s * 0.08, 0.02, 0.188));
    rig.head.add(mesh(new THREE.BoxGeometry(0.075, 0.012, 0.012), std("#8a6a55"), s * 0.08, 0.075, 0.172));
  }
  rig.head.add(smile(0.045, 0.008, std("#9b5a4c"), -0.06, 0.172));
  // Short hair around the sides and back only.
  const hair = std("#7a5c47", { roughness: 1 });
  rig.head.add(mesh(new RoundedBoxGeometry(0.36, 0.1, 0.04, 2, 0.015), hair, 0, -0.02, -0.165));
  for (const s of [-1, 1]) rig.head.add(mesh(new RoundedBoxGeometry(0.035, 0.1, 0.24, 2, 0.012), hair, s * 0.185, 0.0, -0.04));
  // Collar and buttons.
  const collarMat = std("#d8c9f0");
  for (const s of [-1, 1]) {
    const c = mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), collarMat, s * 0.06, 0.35, 0.11);
    c.rotation.z = s * 0.5;
    rig.spine.add(c);
  }
  for (let i = 0; i < 3; i++) rig.spine.add(mesh(new THREE.SphereGeometry(0.012, 6, 4), std("#f4f0fa"), 0, 0.28 - i * 0.09, 0.122));
  return rig;
}

/** Fluffy mascot: blue USDC hoodie, black CIRCLE cap, Arc laptop, always waving. */
function buildPlush(): Rig {
  const fur = std("#ffffff", { map: furTexture(), roughness: 1 });
  const hoodie = std("#2340c9", { roughness: 0.95 });
  const dark = std("#111111", { roughness: 0.45 });
  const hipHeight = 0.22;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const legL = group(0.13, hipHeight, 0, hanging(0.1, 0.11, fur));
  const legR = group(-0.13, hipHeight, 0, hanging(0.1, 0.11, fur));

  const spine = group(0, hipHeight);
  const belly = mesh(new THREE.SphereGeometry(0.32, 24, 18), fur, 0, 0.18, 0);
  belly.scale.set(1, 0.95, 0.9);
  spine.add(belly);
  // Hoodie body, hood ring, pocket and the USDC print.
  const shirt = mesh(new THREE.CylinderGeometry(0.305, 0.335, 0.38, 28), hoodie, 0, 0.27, 0);
  spine.add(shirt);
  const hem = mesh(new THREE.TorusGeometry(0.33, 0.035, 8, 28), hoodie, 0, 0.08, 0);
  hem.rotation.x = Math.PI / 2;
  spine.add(hem);
  const hood = mesh(new THREE.TorusGeometry(0.24, 0.07, 10, 28), hoodie, 0, 0.47, -0.02);
  hood.rotation.x = Math.PI / 2;
  spine.add(hood);
  const pocket = mesh(new RoundedBoxGeometry(0.28, 0.1, 0.04, 2, 0.02), std("#1f39b5", { roughness: 1 }), 0, 0.14, 0.31);
  pocket.rotation.x = -0.12;
  spine.add(pocket);
  spine.add(bandDecal(usdcTexture(), 0.31, 0.12, 0.338, 0.326, 0.38));

  const head = group(0, 0.66);
  const skull = mesh(new THREE.SphereGeometry(0.3, 24, 18), fur);
  skull.scale.set(1, 0.95, 0.95);
  head.add(skull);
  const face = mesh(new THREE.SphereGeometry(0.21, 20, 14), std("#f2dcc0", { roughness: 0.95 }), 0, -0.03, 0.15);
  face.scale.set(1, 0.85, 0.55);
  head.add(face);
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.032, 12, 10), std("#0b0b0b", { roughness: 0.15 }), s * 0.085, 0.0, 0.262));
    head.add(mesh(new THREE.SphereGeometry(0.009, 6, 4), std("#ffffff", { emissive: "#ffffff" }), s * 0.085 + 0.01, 0.013, 0.29));
    const cheek = mesh(new THREE.SphereGeometry(0.04, 12, 8), std("#f4a3a3", { transparent: true, opacity: 0.7 }), s * 0.15, -0.06, 0.225);
    cheek.scale.set(1, 0.7, 0.3);
    head.add(cheek);
  }
  head.add(smile(0.035, 0.007, std("#1a1a1a"), -0.07, 0.262));
  // Black cap with the CIRCLE logo.
  const cap = group(0, 0.11, -0.01);
  const crown = mesh(new THREE.SphereGeometry(0.305, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  crown.scale.y = 0.62;
  cap.add(crown);
  const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), dark, 0, 0.0, 0.2);
  brim.scale.set(1.05, 1, 0.75);
  brim.rotation.x = 0.12;
  cap.add(brim);
  cap.add(domeDecal(circleCapTexture(), 0.305, 0.305 * 0.62, 0.035, 0.1, 0.27));
  head.add(cap);
  spine.add(head);

  const makeArm = (side: 1 | -1): Arm => {
    const shoulder = group(side * 0.3, 0.42, 0);
    shoulder.add(hanging(0.1, 0.085, hoodie));
    const elbow = group(0, -0.14, 0);
    elbow.add(hanging(0.08, 0.08, hoodie));
    elbow.add(mesh(new THREE.SphereGeometry(0.095, 14, 10), fur, 0, -0.15, 0));
    shoulder.add(elbow);
    spine.add(shoulder);
    return { shoulder, elbow };
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // Laptop held open in the left paw, screen facing forward.
  const laptop = group(0, -0.2, 0.06);
  laptop.rotation.x = 1.45;
  laptop.scale.setScalar(1.3);
  const shell = std("#2b2d31", { roughness: 0.5 });
  laptop.add(mesh(new THREE.BoxGeometry(0.28, 0.016, 0.19), shell, 0, 0, 0));
  // Lid hinged at the back edge, opened up so its inner face (with the screen) faces forward.
  const lid = group(0, 0.008, -0.095);
  lid.rotation.x = -1.75;
  lid.add(mesh(new THREE.BoxGeometry(0.28, 0.012, 0.19), shell, 0, 0, 0.095));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.17), new THREE.MeshBasicMaterial({ map: laptopScreenTexture() }));
  screen.rotation.x = Math.PI / 2;
  screen.position.set(0, -0.0075, 0.095);
  lid.add(screen);
  laptop.add(lid);
  armL.elbow.add(laptop);

  body.add(legL, legR, spine);
  return { root, body, spine, head, armL, armR, legL, legR, hipHeight, height: 1.22, idle: "wave", holdLeft: true };
}

/** A dark ball covered in blinking purple eyes, on skinny legs. */
function buildEyeball(): Rig {
  const R = 0.4;
  const hipHeight = 0.24;
  const skin = std("#2a2422", { roughness: 0.95 });
  const limb = std("#1d1917", { roughness: 0.7 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const makeLeg = (side: 1 | -1) => {
    const leg = group(side * 0.12, hipHeight, 0, hanging(0.2, 0.024, limb));
    const foot = mesh(new THREE.SphereGeometry(0.045, 10, 8), limb, 0, -hipHeight + 0.02, 0.03);
    foot.scale.set(1, 0.5, 1.6);
    leg.add(foot);
    return leg;
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  const spine = group(0, hipHeight);
  const head = group(0, R * 0.92); // the ball is the head
  head.add(mesh(new THREE.SphereGeometry(R, 32, 24), skin));
  spine.add(head);

  // Eyes: shared geometry, an iris texture, randomly placed over the ball.
  const irisTex = canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, "#4a1f7a");
    g.addColorStop(0.45, "#9b59e0");
    g.addColorStop(0.85, "#c69cf2");
    g.addColorStop(1, "#7b3fc0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
      ctx.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
      ctx.stroke();
    }
  });
  const scleraMat = std("#f3e9f7", { roughness: 0.35 });
  const irisMat = new THREE.MeshStandardMaterial({ map: irisTex, roughness: 0.3 });
  const pupilMat = std("#050505", { roughness: 0.2 });
  const shineMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  const disc = new THREE.CircleGeometry(1, 24);

  const eyes: { lid: THREE.Group; look: THREE.Group; next: number; blink: number }[] = [];
  const addEye = (dir: THREE.Vector3, size: number) => {
    const eye = new THREE.Group();
    eye.position.copy(dir).multiplyScalar(R * 0.985);
    eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const lid = new THREE.Group();
    const sclera = new THREE.Mesh(sphere, scleraMat);
    sclera.scale.set(size * 1.3, size * 0.82, size * 0.42);
    lid.add(sclera);
    const look = new THREE.Group();
    look.position.z = size * 0.42 + 0.002;
    const iris = new THREE.Mesh(disc, irisMat);
    iris.scale.setScalar(size * 0.6);
    const pupil = new THREE.Mesh(disc, pupilMat);
    pupil.scale.setScalar(size * 0.27);
    pupil.position.z = 0.001;
    const shine = new THREE.Mesh(disc, shineMat);
    shine.scale.setScalar(size * 0.1);
    shine.position.set(size * 0.16, size * 0.16, 0.002);
    look.add(iris, pupil, shine);
    lid.add(look);
    eye.add(lid);
    head.add(eye);
    eyes.push({ lid, look, next: Math.random() * 4, blink: 0 });
  };

  const front = new THREE.Vector3(0, -0.08, 1).normalize();
  addEye(front, 0.2);
  const n = 46;
  for (let i = 0; i < n; i++) {
    // Fibonacci sphere, skipping the big eye, the bottom (legs) and some randomness.
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    if (dir.angleTo(front) < 0.62 || y < -0.62) continue;
    addEye(dir, 0.07 + Math.random() * 0.025);
  }

  const makeArm = (side: 1 | -1): Arm => {
    const shoulder = group(side * (R - 0.02), R * 0.82, 0);
    shoulder.add(hanging(0.16, 0.022, limb));
    const elbow = group(0, -0.17, 0);
    elbow.add(hanging(0.14, 0.02, limb));
    const hand = group(0, -0.17, 0);
    hand.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), limb));
    for (const f of [-1, 0, 1]) {
      const finger = mesh(new THREE.CapsuleGeometry(0.009, 0.04, 2, 6), limb, f * 0.018, -0.04, 0);
      finger.rotation.z = f * 0.3;
      hand.add(finger);
    }
    elbow.add(hand);
    shoulder.add(elbow);
    spine.add(shoulder);
    return { shoulder, elbow };
  };

  body.add(legL, legR, spine);
  const extra = (dt: number) => {
    for (const e of eyes) {
      e.next -= dt;
      if (e.next <= 0) {
        // Glance somewhere new; sometimes blink.
        e.look.position.x = (Math.random() - 0.5) * 0.02;
        e.look.position.y = (Math.random() - 0.5) * 0.015;
        if (Math.random() < 0.35) e.blink = 0.14;
        e.next = 1 + Math.random() * 4;
      }
      if (e.blink > 0) e.blink -= dt;
      const target = e.blink > 0 ? 0.08 : 1;
      e.lid.scale.y += (target - e.lid.scale.y) * Math.min(1, dt * 30);
    }
  };
  return {
    root,
    body,
    spine,
    head,
    armL: makeArm(1),
    armR: makeArm(-1),
    legL,
    legR,
    hipHeight,
    height: hipHeight + R * 1.92,
    idle: "flex",
    extra,
  };
}

export function isNpcAvatar(avatar: string): avatar is NpcAvatar {
  return avatar.startsWith("npc-");
}

export function buildCharacter(avatar: NpcAvatar): Rig {
  const rig =
    avatar === "npc-cap" ? buildCap() : avatar === "npc-plush" ? buildPlush() : avatar === "npc-lavender" ? buildLavender() : buildEyeball();
  rig.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return rig;
}

// ---------------------------------------------------------------- animation

type V3 = [number, number, number];
type Pose = {
  spine: V3;
  head: V3;
  shoulderL: V3;
  elbowL: V3;
  shoulderR: V3;
  elbowR: V3;
  legL: V3;
  legR: V3;
  bodyY: number;
};

const zero = (): V3 => [0, 0, 0];

function idlePose(rig: Rig, p: Pose, t: number) {
  const breathe = Math.sin(t * 2) * 0.03;
  p.spine[0] = breathe;
  switch (rig.idle) {
    case "cross":
      p.shoulderL = [-0.35, -1.0, 0.05];
      p.elbowL = [-1.5, 0, 0];
      p.shoulderR = [-0.42, 1.0, -0.05];
      p.elbowR = [-1.45, 0, 0];
      break;
    case "wave":
      p.shoulderR = [0, 0, -2.5];
      p.elbowR = [0, 0, -0.35 + Math.sin(t * 7) * 0.45];
      break;
    case "calm":
      p.shoulderL = [-0.25, 0, 0.12];
      p.shoulderR = [-0.25, 0, -0.12];
      p.elbowL = p.elbowR = [-0.5, 0, 0];
      p.head[1] = Math.sin(t * 0.7) * 0.15;
      break;
    case "flex":
      p.shoulderR = [0, 0, -1.45];
      p.elbowR = [0, 0, -1.7 + Math.sin(t * 3) * 0.15];
      p.shoulderL = [0, 0, 0.75];
      p.elbowL = [0, 0, -1.5];
      p.bodyY = Math.abs(Math.sin(t * 3)) * 0.02;
      break;
  }
}

/** Animation names match the Kenney clips the server asks for, plus "wave" and "cheer". */
export function animateRig(rig: Rig, anim: string, t: number, dt: number) {
  const p: Pose = {
    spine: zero(),
    head: zero(),
    shoulderL: [0, 0, 0.08],
    elbowL: zero(),
    shoulderR: [0, 0, -0.08],
    elbowR: zero(),
    legL: zero(),
    legR: zero(),
    bodyY: 0,
  };
  const swing = Math.sin(t * 9);

  switch (anim) {
    case "walk":
      p.legL[0] = swing * 0.6;
      p.legR[0] = -swing * 0.6;
      p.shoulderL[0] = -swing * 0.5;
      p.shoulderR[0] = swing * 0.5;
      p.elbowL[0] = p.elbowR[0] = -0.3;
      p.bodyY = Math.abs(Math.cos(t * 9)) * 0.035;
      break;
    case "sit":
      p.legL[0] = p.legR[0] = -1.45;
      p.bodyY = -rig.hipHeight + 0.03;
      p.shoulderL = [-0.35, 0, 0.1];
      p.shoulderR = [-0.35, 0, -0.1];
      p.elbowL = p.elbowR = [-0.9, 0, 0];
      p.spine[0] = -0.05 + Math.sin(t * 2) * 0.02;
      break;
    case "interact-right":
    case "interact-left": {
      const arm = anim === "interact-right" ? "R" : "L";
      p[`shoulder${arm}`] = [-1.25 + Math.sin(t * 7) * 0.25, 0, 0];
      p[`elbow${arm}`] = [-0.3, 0, 0];
      p.head[0] = 0.15;
      break;
    }
    case "wave":
      p.shoulderR = [0, 0, -2.5];
      p.elbowR = [0, 0, -0.35 + Math.sin(t * 9) * 0.5];
      break;
    case "cheer":
    case "jump":
      p.shoulderL = [0, 0, 2.6 + Math.sin(t * 10) * 0.2];
      p.shoulderR = [0, 0, -2.6 - Math.sin(t * 10) * 0.2];
      p.bodyY = anim === "jump" ? Math.abs(Math.sin(t * 6)) * 0.25 : Math.abs(Math.sin(t * 8)) * 0.06;
      break;
    case "emote-yes":
      p.head[0] = Math.sin(t * 9) * 0.3;
      break;
    case "emote-no":
      p.head[1] = Math.sin(t * 10) * 0.45;
      break;
    case "pick-up":
      p.spine[0] = 0.55 + Math.sin(t * 4) * 0.08;
      p.shoulderL[0] = p.shoulderR[0] = -0.9;
      break;
    case "static":
      break;
    default:
      idlePose(rig, p, t);
  }

  if (rig.holdLeft && anim !== "cheer" && anim !== "jump") {
    p.shoulderL = [-0.15, 0, 0.15];
    p.elbowL = [-1.35, 0, 0];
  }

  const k = 1 - Math.exp(-dt * 14);
  const lerp = (o: THREE.Object3D, v: V3) => {
    o.rotation.x += (v[0] - o.rotation.x) * k;
    o.rotation.y += (v[1] - o.rotation.y) * k;
    o.rotation.z += (v[2] - o.rotation.z) * k;
  };
  lerp(rig.spine, p.spine);
  lerp(rig.head, p.head);
  lerp(rig.armL.shoulder, p.shoulderL);
  lerp(rig.armL.elbow, p.elbowL);
  lerp(rig.armR.shoulder, p.shoulderR);
  lerp(rig.armR.elbow, p.elbowR);
  lerp(rig.legL, p.legL);
  lerp(rig.legR, p.legR);
  rig.body.position.y += (p.bodyY - rig.body.position.y) * k;
  rig.extra?.(dt, t);
}
