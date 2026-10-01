import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { AVATARS } from "@musehouse/shared";

/** Models and characters are scaled up so one Kenney "unit" fits the tile grid nicely. */
export const MODEL_SCALE = 1.5;

interface Part {
  file: string;
  /** Place on top of the previous part instead of on the floor. */
  stack?: boolean;
  /** Offset in tiles (after scaling, before the object's rotation). */
  offset?: [number, number, number];
  /** Extra rotation in degrees. */
  rot?: number;
}

interface ModelDef {
  parts: Part[];
  /** Center the footprint on the first part only (e.g. desk + chair in front of it). */
  anchorFirst?: boolean;
}

/**
 * Model keys used by the server's house definition -> Kenney Furniture Kit parts.
 * Swap any of these for other GLB files to restyle the house; unknown or missing
 * models fall back to simple coloured shapes.
 */
export const MODELS: Record<string, ModelDef> = {
  tv: { parts: [{ file: "cabinetTelevision" }, { file: "televisionModern", stack: true }] },
  sofa: { parts: [{ file: "loungeSofa" }] },
  armchair: { parts: [{ file: "loungeChair" }] },
  bookshelf: { parts: [{ file: "bookcaseClosedWide" }] },
  radio: { parts: [{ file: "sideTable" }, { file: "radio", stack: true }] },
  rugLiving: { parts: [{ file: "rugRectangle" }] },
  rugBedroom: { parts: [{ file: "rugRound" }] },
  doormat: { parts: [{ file: "rugDoormat" }] },
  pottedPlant: { parts: [{ file: "pottedPlant" }] },
  floorLamp: { parts: [{ file: "lampRoundFloor" }] },
  fridge: { parts: [{ file: "kitchenFridgeLarge" }] },
  counter: { parts: [{ file: "kitchenCabinet" }] },
  stove: { parts: [{ file: "kitchenStove" }] },
  sink: { parts: [{ file: "kitchenSink" }] },
  coffeeCounter: { parts: [{ file: "kitchenCabinet" }, { file: "kitchenCoffeeMachine", stack: true }] },
  microwaveCounter: { parts: [{ file: "kitchenCabinet" }, { file: "kitchenMicrowave", stack: true }] },
  trashcan: { parts: [{ file: "trashcan" }] },
  diningTable: { parts: [{ file: "tableRound" }] },
  chair: { parts: [{ file: "chairCushion" }] },
  bed: { parts: [{ file: "bedDouble" }] },
  nightstand: { parts: [{ file: "cabinetBedDrawerTable" }, { file: "lampRoundTable", stack: true }] },
  desk: {
    anchorFirst: true,
    parts: [{ file: "desk" }, { file: "computerScreen", stack: true }, { file: "chairDesk", offset: [0, 0, 0.75], rot: 180 }],
  },
  wardrobe: { parts: [{ file: "bookcaseClosedDoors" }] },
  bear: { parts: [{ file: "bear" }] },
  bench: { parts: [{ file: "benchCushion", offset: [-0.42, 0, 0] }, { file: "benchCushion", offset: [0.42, 0, 0] }] },
  lounger: { parts: [{ file: "loungeChairRelax" }] },
};

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF | null>>();

export function loadGLTF(url: string): Promise<GLTF | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).catch((err) => {
      console.warn(`[assets] could not load ${url}, using a placeholder`, err);
      return null;
    });
    cache.set(url, p);
  }
  return p;
}

/** Download every model up front (for the loading screen); later loads hit the cache. */
export async function preloadAssets(onProgress: (loaded: number, total: number) => void): Promise<void> {
  const urls = [
    ...new Set(Object.values(MODELS).flatMap((def) => def.parts.map((p) => `/assets/furniture/${p.file}.glb`))),
    ...AVATARS.map((a) => `/assets/characters/character-${a}.glb`),
  ];
  let loaded = 0;
  onProgress(0, urls.length);
  await Promise.all(urls.map((url) => loadGLTF(url).finally(() => onProgress(++loaded, urls.length))));
}

function enableShadows(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/** Load one part, normalised so it's centred on x/z and stands on y = 0. */
async function loadPart(file: string): Promise<THREE.Object3D | null> {
  const gltf = await loadGLTF(`/assets/furniture/${file}.glb`);
  if (!gltf) return null;
  const obj = gltf.scene.clone(true);
  obj.scale.setScalar(MODEL_SCALE);
  const pivot = new THREE.Group();
  pivot.add(obj);
  const box = new THREE.Box3().setFromObject(pivot);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  enableShadows(pivot);
  return pivot;
}

export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  elevation?: number;
}

/** Build a placed furniture object for the given model key and footprint. */
export async function buildModel(key: string, fp: Footprint): Promise<THREE.Object3D> {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);

  if (key.startsWith("proc:")) {
    inner.add(buildProcedural(key.slice(5), fp));
  } else {
    const def = MODELS[key];
    let prev: THREE.Object3D | null = null;
    let anchor: THREE.Box3 | null = null;
    for (const part of def?.parts ?? []) {
      const obj = await loadPart(part.file);
      if (!obj) continue;
      if (part.rot) obj.rotation.y = (part.rot * Math.PI) / 180;
      if (part.stack && prev) {
        const below = new THREE.Box3().setFromObject(prev);
        const c = below.getCenter(new THREE.Vector3());
        obj.position.set(c.x, below.max.y, c.z);
      }
      if (part.offset) obj.position.add(new THREE.Vector3(...part.offset));
      inner.add(obj);
      if (!anchor) anchor = new THREE.Box3().setFromObject(obj);
      prev = obj;
    }
    if (inner.children.length === 0) inner.add(placeholder(fp));
    // Centre the whole model (or its first part) at the origin.
    const box = def?.anchorFirst && anchor ? anchor : new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, 0, -c.z);
  }

  group.rotation.y = (fp.rot * Math.PI) / 180;
  group.position.set(fp.x + fp.w / 2, fp.elevation ?? 0, fp.z + fp.d / 2);
  return group;
}

function placeholder(fp: Footprint): THREE.Object3D {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(fp.w * 0.8, 0.5, fp.d * 0.8),
    new THREE.MeshStandardMaterial({ color: 0xb08968 }),
  );
  mesh.position.y = 0.25;
  enableShadows(mesh);
  return mesh;
}

function buildProcedural(kind: string, fp: Footprint): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === "tree") {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }),
    );
    trunk.position.y = 0.4;
    g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9d4a, roughness: 0.8, flatShading: true });
    for (const [x, y, z, r] of [
      [0, 1.05, 0, 0.5],
      [0.22, 0.9, 0.12, 0.34],
      [-0.2, 0.92, -0.1, 0.36],
      [0.02, 1.4, 0.02, 0.32],
    ]) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
      leaf.position.set(x, y, z);
      g.add(leaf);
    }
  } else if (kind === "flowers") {
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(fp.w * 0.92, 0.16, fp.d * 0.8),
      new THREE.MeshStandardMaterial({ color: 0x7a4e2d, roughness: 1 }),
    );
    bed.position.y = 0.08;
    g.add(bed);
    const colors = [0xff6b8b, 0xffd166, 0xc77dff, 0xff9f1c, 0xffffff];
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f8f3a });
    let i = 0;
    for (let x = -fp.w / 2 + 0.2; x < fp.w / 2 - 0.1; x += 0.22) {
      for (const z of [-0.18, 0.12]) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22), stemMat);
        stem.position.set(x + (z > 0 ? 0.08 : 0), 0.27, z);
        const bloom = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.06, 0),
          new THREE.MeshStandardMaterial({ color: colors[i++ % colors.length], flatShading: true }),
        );
        bloom.position.set(stem.position.x, 0.4, z);
        g.add(stem, bloom);
      }
    }
  } else {
    g.add(placeholder(fp));
  }
  enableShadows(g);
  return g;
}
