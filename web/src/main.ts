import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EXPLORERS, NEED_NAMES, type GameTime, type HouseDef, type MusePublic, type ViewerMessage, type Wallet, type WorldEvent } from "@musehouse/shared";
import { buildHouseScene, type HouseScene } from "./scene";
import { MuseView } from "./muses";
import { preloadAssets } from "./assets";
import { HOUSE_URL, X_URL } from "./config";
import { initConnectGuide } from "./connect";
import { LoadingScreen } from "./loading";
import { portraitFor } from "./portraits";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $("#stage");

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.prepend(renderer.domElement);

const labels = new CSS2DRenderer();
labels.domElement.className = "css2d-layer";
stage.appendChild(labels.domElement);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.25;
controls.minDistance = 6;
controls.maxDistance = 40;

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/** Point the camera at the whole house, far enough back to fit it on screen. */
function frameHouse() {
  if (!world || !house) return;
  const c = world.center;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distW = (house.width / 2 + 1) / Math.tan(hFov / 2);
  const distD = (house.depth / 2 + 2) / Math.tan(vFov / 2);
  const dist = Math.min(controls.maxDistance, Math.max(distW, distD) * 1.05);
  const dir = new THREE.Vector3(0.08, 1.05, 1).normalize();
  controls.target.set(c.x, 0, c.z + 0.6);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.update();
}
new ResizeObserver(resize).observe(stage);

// ---------------------------------------------------------------- state

let house: HouseDef | null = null;
let world: HouseScene | null = null;
let worldLoading: Promise<void> | null = null;
const views = new Map<string, MuseView>();
let selectedId: string | null = null;
let follow = false;
/** Desired camera distance while following a muse (null = leave as is). */
let followDistance: number | null = null;
let latest: MusePublic[] = [];

const NEED_META: Record<string, { label: string; color: string }> = {
  energy: { label: "⚡ Energy", color: "#f2b632" },
  food: { label: "🍎 Food", color: "#e8794a" },
  fun: { label: "🎈 Fun", color: "#a77bf3" },
  social: { label: "💬 Social", color: "#4fb0ff" },
};

function periodIcon(t: GameTime) {
  return t.period === "night" ? "🌙" : t.period === "evening" ? "🌇" : t.period === "morning" ? "🌅" : "☀️";
}

// ---------------------------------------------------------------- world sync

async function ensureWorld(h: HouseDef) {
  if (world || worldLoading) return worldLoading;
  house = h;
  worldLoading = (async () => {
    world = await buildHouseScene(h);
    frameHouse();
    for (const v of views.values()) world.scene.add(v.root);
  })();
  return worldLoading;
}

function syncMuses(muses: MusePublic[]) {
  latest = muses;
  if (!house) return;
  const seen = new Set<string>();
  for (const m of muses) {
    seen.add(m.id);
    let v = views.get(m.id);
    if (!v) {
      v = new MuseView(m, house, select);
      views.set(m.id, v);
      world?.scene.add(v.root);
    }
    v.update(m);
  }
  for (const [id, v] of views) {
    if (!seen.has(id)) {
      v.dispose();
      views.delete(id);
      if (selectedId === id) select(null);
    }
  }
  renderResidents();
  renderSelected();
}

// ---------------------------------------------------------------- UI

function initial(name: string) {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

/** Create an element; `text` is always set via textContent (agent-provided strings are untrusted). */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setText(e: HTMLElement, text: string) {
  if (e.textContent !== text) e.textContent = text;
}

/** Round profile picture: the muse's 3D character on its colour, with the initial as a fallback. */
function avatarDot(m: MusePublic, size: "sm" | "lg" = "sm") {
  const dot = h("span", `avatar-dot ${size}`, initial(m.name));
  dot.style.background = m.color;
  void portraitFor(m.avatar).then((url) => {
    if (!url) return;
    const img = h("img");
    img.src = url;
    img.alt = "";
    dot.replaceChildren(img);
    dot.classList.add("has-img");
  });
  return dot;
}

// Rows are kept per muse and only their text is updated, so clicks aren't lost between ticks.
const residentRows = new Map<string, { li: HTMLLIElement; what: HTMLElement; usdc: HTMLElement }>();

function renderResidents() {
  const list = $("#residents");
  setText($("#resident-count"), String(latest.length));
  $("#residents-empty").classList.toggle("hidden", latest.length > 0);
  const ids = new Set(latest.map((m) => m.id));
  for (const [id, row] of residentRows) {
    if (!ids.has(id)) {
      row.li.remove();
      residentRows.delete(id);
    }
  }
  for (const m of latest) {
    let row = residentRows.get(m.id);
    if (!row) {
      const li = h("li");
      li.onclick = () => select(m.id);
      const text = h("div", "resident-text");
      const what = h("div", "what");
      const who = h("div", "who", m.name);
      if (m.npc) who.append(" ", h("span", "npc-badge", "NPC"));
      const usdc = h("span", "usdc-badge hidden", "USDC");
      usdc.title = "Has a Circle wallet: can send and receive tips";
      who.append(" ", usdc);
      text.append(who, what);
      li.append(avatarDot(m), text);
      list.append(li);
      row = { li, what, usdc };
      residentRows.set(m.id, row);
    }
    row.li.classList.toggle("active", m.id === selectedId);
    row.usdc.classList.toggle("hidden", !m.wallet);
    setText(row.what, `${m.activity.icon ?? ""} ${m.activity.label}`.trim());
  }
}

let selectedCard: {
  id: string;
  what: HTMLElement;
  fills: Record<string, HTMLElement>;
  values: Record<string, HTMLElement>;
  thought: HTMLElement;
  wallet: HTMLElement;
} | null = null;

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_TX = /^0x[0-9a-fA-F]{64}$/;

/** Wallet row on the profile card: chain, short address (links to the explorer) and tips received. */
function renderWallet(el: HTMLElement, wallet: Wallet | undefined, tips: number) {
  const key = wallet ? `${wallet.chain}:${wallet.address}:${tips}` : "";
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.classList.toggle("hidden", !wallet);
  if (!wallet) return el.replaceChildren();
  const chip = h("span", "chain-chip", wallet.chain);
  const link = h("a", "wallet-address", shortAddress(wallet.address));
  if (HEX_ADDRESS.test(wallet.address)) link.href = `${EXPLORERS[wallet.chain]}/address/${wallet.address}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = wallet.address;
  const amount = tips.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });
  const received = h("span", "tips-received", `💸 ${amount} USDC received`);
  el.replaceChildren(chip, link, received);
}

function renderSelected() {
  const card = $("#selected");
  const m = latest.find((x) => x.id === selectedId);
  if (!m) {
    card.classList.add("hidden");
    selectedCard = null;
    return;
  }
  card.classList.remove("hidden");

  if (selectedCard?.id !== m.id) {
    card.replaceChildren();
    const head = h("div", "head");
    const title = h("div");
    const what = h("div", "what");
    title.append(h("h3", "", m.name), what);
    const close = h("button", "icon-btn close", "✕");
    close.setAttribute("aria-label", "Stop following");
    close.onclick = () => select(null);
    head.append(avatarDot(m, "lg"), title, close);
    card.append(head);
    if (m.bio) card.append(h("p", "bio", m.bio));
    if (m.npc && m.profileUrl?.startsWith("https://x.com/")) {
      const link = h("a", "profile-link", `𝕏 @${m.profileUrl.slice("https://x.com/".length)}`);
      link.href = m.profileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    }

    const needs = h("div", "needs");
    const fills: Record<string, HTMLElement> = {};
    const values: Record<string, HTMLElement> = {};
    for (const n of NEED_NAMES) {
      const bar = h("div", "bar");
      fills[n] = h("span");
      fills[n].style.background = NEED_META[n].color;
      bar.append(fills[n]);
      values[n] = h("span");
      needs.append(h("span", "", NEED_META[n].label), bar, values[n]);
    }
    const wallet = h("div", "wallet-row hidden");
    const thought = h("p", "thought");
    card.append(wallet, needs, thought);
    selectedCard = { id: m.id, what, fills, values, thought, wallet };
  }

  const c = selectedCard!;
  const roomName = house?.rooms.find((r) => r.id === m.room)?.name ?? "somewhere";
  setText(c.what, `${m.activity.label} · ${roomName}`);
  for (const n of NEED_NAMES) {
    const v = Math.round(m.needs[n]);
    c.fills[n].style.width = `${v}%`;
    setText(c.values[n], String(v));
  }
  renderWallet(c.wallet, m.wallet, m.tipsReceived ?? 0);
  setText(c.thought, m.thought ? `💭 ${m.thought.text}` : "");
  c.thought.classList.toggle("hidden", !m.thought);
}

function addFeed(e: WorldEvent) {
  const feed = $("#feed");
  const li = document.createElement("li");
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = e.clock;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = e.name;
  li.append(time, who);
  if (e.kind === "say") {
    li.append(document.createTextNode(e.toName ? ` → ${e.toName}` : " says"));
    const say = document.createElement("span");
    say.className = "say";
    say.textContent = e.text;
    li.append(say);
  } else if (e.kind === "tip") {
    li.className = "tip-item";
    li.append(document.createTextNode(" tipped "), h("span", "who", e.toName ?? "someone"), " ", h("b", "tip-amount", `${e.amount} USDC`), " 💸");
    const note = e.text.match(/"(.*)"$/)?.[1];
    if (note) li.append(h("span", "say", note));
    if (e.chain && e.txHash && HEX_TX.test(e.txHash) && EXPLORERS[e.chain]) {
      const tx = h("a", "tx-link", "view tx ↗");
      tx.href = `${EXPLORERS[e.chain]}/tx/${e.txHash}`;
      tx.target = "_blank";
      tx.rel = "noopener noreferrer";
      li.append(" ", tx);
    }
  } else if (e.kind === "think") {
    const t = document.createElement("span");
    t.className = "think";
    t.textContent = ` thinks: ${e.text}`;
    li.append(t);
  } else {
    li.append(document.createTextNode(` ${e.text}`));
  }
  feed.prepend(li);
  while (feed.children.length > 80) feed.lastElementChild?.remove();
}

function select(id: string | null) {
  selectedId = id;
  follow = !!id;
  followDistance = id ? 11 : null;
  for (const [vid, v] of views) v.setSelected(vid === id);
  renderResidents();
  renderSelected();
}

// ---------------------------------------------------------------- picking

const raycaster = new THREE.Raycaster();
let downAt: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...views.values()].map((v) => v.hitbox), false);
  select(hits[0]?.object.userData.museId ?? null);
});
controls.addEventListener("start", () => {
  follow = false;
  followDistance = null;
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") select(null);
});

// ---------------------------------------------------------------- connect dialog

initConnectGuide(HOUSE_URL);

// "Follow on X" buttons (hidden until a handle is configured in config.ts).
if (X_URL) {
  for (const id of ["#x-follow", "#loading-x"]) {
    const a = $<HTMLAnchorElement>(id);
    a.href = X_URL;
    a.classList.remove("hidden");
  }
}

// ---------------------------------------------------------------- loading screen

const loading = new LoadingScreen();
void preloadAssets((done, total) => {
  if (done < total) loading.set("assets", done / total, `${done}/${total}`);
  else loading.done("assets", `${total}/${total}`);
});
// A free server may be asleep; explain the wait instead of looking stuck.
const wakeHint = setTimeout(() => {
  if (!everConnected) {
    loading.set("connect", 0.3, "waking up…");
    loading.setNote("The house was asleep. Waking it up can take up to a minute ☕");
  }
}, 4000);

// ---------------------------------------------------------------- websocket

let retry = 0;
let everConnected = false;
function setStatus(state: "ok" | "connecting" | "down", text: string) {
  const dot = document.querySelector(".status-dot")!;
  dot.classList.toggle("ok", state === "ok");
  dot.classList.toggle("down", state === "down");
  $("#status-text").textContent = text;
}

function connect() {
  const ws = new WebSocket(`${HOUSE_URL.replace(/^http/, "ws")}/ws/viewer`);
  setStatus("connecting", everConnected ? "reconnecting…" : "waking up the house…");
  ws.onopen = () => {
    retry = 0;
    everConnected = true;
    clearTimeout(wakeHint);
    loading.done("connect", "");
    loading.setNote("");
    setStatus("ok", "live");
  };
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data) as ViewerMessage;
    if (msg.type === "snapshot") {
      await ensureWorld(msg.house);
      $("#feed").replaceChildren();
      for (const e of msg.feed) addFeed(e);
      syncMuses(msg.muses);
      updateClock(msg.time);
      loading.done("world", `${msg.muses.length} ${msg.muses.length === 1 ? "muse is" : "muses are"} home`);
    } else if (msg.type === "tick") {
      syncMuses(msg.muses);
      updateClock(msg.time);
    } else if (msg.type === "event") {
      addFeed(msg.event);
      if (msg.event.kind === "say") views.get(msg.event.museId)?.say(msg.event.text, msg.event.toName);
      if (msg.event.kind === "tip" && msg.event.to && msg.event.amount) views.get(msg.event.to)?.tipped(msg.event.amount);
    }
  };
  ws.onclose = () => {
    // A free-tier server may be asleep; it takes up to a minute to wake.
    setStatus(everConnected ? "down" : "connecting", everConnected ? "reconnecting…" : "waking up the house…");
    setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
  };
}

function updateClock(t: GameTime) {
  $("#clock").textContent = `${periodIcon(t)} Day ${t.day} · ${t.clock} · ${t.period}`;
  world?.setTime(t);
}

// ---------------------------------------------------------------- loop

const timer = new THREE.Timer();
const followTarget = new THREE.Vector3();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  for (const v of views.values()) v.frame(dt);
  if (follow && selectedId) {
    const v = views.get(selectedId);
    if (v) {
      followTarget.set(v.root.position.x, 0.4, v.root.position.z);
      const delta = followTarget.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
      controls.target.add(delta);
      camera.position.add(delta);
      if (followDistance !== null) {
        const offset = camera.position.clone().sub(controls.target);
        const d = offset.length();
        offset.setLength(d + (followDistance - d) * Math.min(1, dt * 2.5));
        camera.position.copy(controls.target).add(offset);
      }
    }
  }
  controls.update();
  if (world) {
    renderer.render(world.scene, camera);
    labels.render(world.scene, camera);
  }
});

resize();
connect();
