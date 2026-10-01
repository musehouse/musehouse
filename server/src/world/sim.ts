import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  AVATARS,
  NEED_NAMES,
  type Action,
  type ActionResult,
  type Activity,
  type Avatar,
  type NpcAvatar,
  type GameTime,
  type HouseDef,
  type HouseObject,
  type MusePublic,
  type Needs,
  type Observation,
  type Point,
  type RegisterRequest,
  type Room,
  type VerbDef,
  type WakeReason,
  type Wallet,
  type WalletChain,
  type WorldEvent,
  type EventKind,
} from "@musehouse/shared";
import { Grid } from "./grid.js";
import { verifyUsdcTransfer, type TipCheck, type TipResult } from "../chain/usdc.js";

export interface WorldOptions {
  /** Clock source in ms (injectable for tests). */
  now?: () => number;
  /** Game minutes that pass per real second. 1 => a full day takes 24 real minutes. */
  gameMinutesPerSecond?: number;
  startHour?: number;
  /** Remove a muse whose agent hasn't contacted the server for this long. */
  inactiveTimeoutMs?: number;
  maxMuses?: number;
  /** Walking speed in tiles per second. */
  walkSpeed?: number;
  sayCooldownMs?: number;
  actionCooldownMs?: number;
  random?: () => number;
  /** Confirms a USDC tip on-chain (injectable for tests). */
  verifyTip?: (check: TipCheck) => Promise<TipResult>;
}

const MAX_PENDING_TIPS = 3;

/** "0.10", "1.50", "0.000123" */
export function formatUsdc(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });
}

/** Need decay per game hour. */
const DECAY_PER_HOUR: Needs = { energy: 3, food: 5, fun: 4, social: 3 };

const COLORS = ["#ff7a59", "#4fb0ff", "#8bd450", "#c084fc", "#facc15", "#f472b6", "#2dd4bf", "#fb923c", "#a3e635", "#60a5fa", "#e879f9", "#fbbf24"];

const EMOTE_INFO: Record<string, { anim: string; icon: string; text: string }> = {
  wave: { anim: "interact-right", icon: "👋", text: "waves" },
  nod: { anim: "emote-yes", icon: "🙂", text: "nods" },
  shake_head: { anim: "emote-no", icon: "🙅", text: "shakes their head" },
  jump: { anim: "jump", icon: "🤸", text: "jumps for joy" },
  cheer: { anim: "emote-yes", icon: "🎉", text: "cheers" },
};

type Arrival =
  | { kind: "use"; objectId: string; verb: string }
  | { kind: "move"; label: string };

interface MuseState {
  pub: MusePublic;
  token: Buffer;
  path: Point[];
  arrival: Arrival | null;
  activityEndsAt: number | null;
  using: { obj: HouseObject; verb: VerbDef; slot: number; elapsed: number } | null;
  heard: Observation["heard"];
  seen: Observation["seen"];
  lastAction?: Observation["lastAction"];
  wake: WakeReason | null;
  waiters: Set<(reason: WakeReason) => void>;
  lastContact: number;
  lastActionAt: number;
  lastSayAt: number;
  pendingTips: number;
}

export type RegisterResult =
  | { ok: true; muse: MusePublic; token: string }
  | { ok: false; status: number; message: string };

const IDLE: Activity = { kind: "idle", label: "is standing around", pose: "stand" };
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const center = (p: Point): Point => ({ x: p.x + 0.5, z: p.z + 0.5 });

export class World {
  readonly house: HouseDef;
  readonly grid: Grid;
  private readonly opts: Required<WorldOptions>;
  private readonly muses = new Map<string, MuseState>();
  /** objectId -> museId per slot (seat index, or slot 0 for stand-use objects). */
  private readonly occupancy = new Map<string, (string | null)[]>();
  /** Transaction hashes already counted as tips (lowercase). */
  private readonly usedTips = new Set<string>();
  private gameMinutes: number;
  private eventSeq = 0;
  private readonly feed: WorldEvent[] = [];
  private readonly eventListeners = new Set<(e: WorldEvent) => void>();

  constructor(house: HouseDef, options: WorldOptions = {}) {
    this.house = house;
    this.grid = new Grid(house);
    this.opts = {
      now: Date.now,
      gameMinutesPerSecond: 1,
      startHour: 8,
      inactiveTimeoutMs: 3 * 60_000,
      maxMuses: 16,
      walkSpeed: 2.2,
      sayCooldownMs: 1500,
      actionCooldownMs: 250,
      random: Math.random,
      verifyTip: (check) => verifyUsdcTransfer(check),
      ...options,
    };
    this.gameMinutes = this.opts.startHour * 60;
    for (const obj of house.objects) {
      if (obj.verbs.length > 0) this.occupancy.set(obj.id, new Array(obj.seats?.length ?? 1).fill(null));
    }
  }

  // ------------------------------------------------------------------ queries

  time(): GameTime {
    const total = Math.floor(this.gameMinutes);
    const day = Math.floor(total / 1440) + 1;
    const hour = Math.floor((total % 1440) / 60);
    const minute = total % 60;
    const period = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    return { day, hour, minute, clock: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, period };
  }

  publicMuses(): MusePublic[] {
    return [...this.muses.values()].map((m) => structuredClone(m.pub));
  }

  recentFeed(): WorldEvent[] {
    return [...this.feed];
  }

  onEvent(fn: (e: WorldEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  has(id: string): boolean {
    return this.muses.has(id);
  }

  authenticate(id: string, token: string): boolean {
    const m = this.muses.get(id);
    if (!m) return false;
    const given = Buffer.from(token);
    return given.length === m.token.length && timingSafeEqual(given, m.token);
  }

  /** Attach or replace a muse's wallet. */
  setWallet(id: string, wallet: Wallet): MusePublic | null {
    const m = this.muses.get(id);
    if (!m) return null;
    m.pub.wallet = wallet;
    m.lastContact = this.opts.now();
    return structuredClone(m.pub);
  }

  // ------------------------------------------------------------- membership

  /** `options` are internal (never exposed over HTTP): used to move in the house's own NPCs. */
  register(req: RegisterRequest, options: { npc?: boolean; avatar?: NpcAvatar; spawn?: Point; profileUrl?: string } = {}): RegisterResult {
    if (this.muses.size >= this.opts.maxMuses) {
      return { ok: false, status: 503, message: `The house is full (${this.opts.maxMuses} muses). Try again later.` };
    }
    const lower = req.name.toLowerCase();
    if ([...this.muses.values()].some((m) => m.pub.name.toLowerCase() === lower)) {
      return { ok: false, status: 409, message: `A muse named "${req.name}" already lives here.` };
    }
    const id = `m_${randomBytes(6).toString("hex")}`;
    const token = randomBytes(24).toString("base64url");
    const now = this.opts.now();
    const used = new Set([...this.muses.values()].map((m) => m.pub.avatar));
    const avatar: Avatar | NpcAvatar = options.avatar ?? req.avatar ?? AVATARS.find((a) => !used.has(a)) ?? AVATARS[this.muses.size % AVATARS.length];
    const usedColors = new Set([...this.muses.values()].map((m) => m.pub.color));
    const color = req.color ?? COLORS.find((c) => !usedColors.has(c)) ?? COLORS[0];
    const spawn = center(options.spawn ?? this.house.spawn);
    const pub: MusePublic = {
      id,
      name: req.name,
      bio: req.bio ?? "",
      color,
      avatar,
      x: spawn.x,
      z: spawn.z,
      facing: Math.PI / 2,
      room: this.grid.roomOf(spawn)?.id ?? null,
      activity: { ...IDLE },
      needs: { energy: 80, food: 70, fun: 60, social: 50 },
      joinedAt: now,
      ...(options.npc ? { npc: true } : {}),
      ...(options.profileUrl ? { profileUrl: options.profileUrl } : {}),
      ...(req.wallet ? { wallet: req.wallet } : {}),
    };
    this.muses.set(id, {
      pub,
      token: Buffer.from(token),
      path: [],
      arrival: null,
      activityEndsAt: null,
      using: null,
      heard: [],
      seen: [],
      wake: "joined",
      waiters: new Set(),
      lastContact: now,
      lastActionAt: 0,
      lastSayAt: 0,
      pendingTips: 0,
    });
    this.emit("join", pub, options.npc ? "is home 🏠" : "moved into the house 🏠");
    return { ok: true, muse: structuredClone(pub), token };
  }

  remove(id: string, why = "left the house 👋"): boolean {
    const m = this.muses.get(id);
    if (!m) return false;
    this.releaseSlot(m);
    this.emit("leave", m.pub, why);
    this.muses.delete(id);
    for (const w of m.waiters) w("timeout");
    return true;
  }

  // ---------------------------------------------------------------- actions

  act(id: string, action: Action): ActionResult {
    const m = this.muses.get(id);
    if (!m) return { ok: false, message: "Unknown muse." };
    const now = this.opts.now();
    m.lastContact = now;
    if (now - m.lastActionAt < this.opts.actionCooldownMs) {
      return { ok: false, message: "Slow down: one action every 250 ms.", retryAfterMs: this.opts.actionCooldownMs };
    }
    m.lastActionAt = now;

    switch (action.type) {
      case "say":
        return this.say(m, action.text, action.to);
      case "tip":
        return this.tip(m, action);
      case "think":
        m.pub.thought = { text: action.text, at: now };
        this.emit("think", m.pub, action.text);
        return { ok: true, message: "Thought noted. Viewers can see it as a thought bubble." };
      case "emote": {
        const info = EMOTE_INFO[action.kind];
        return this.physical(m, action, () => {
          this.interrupt(m);
          this.setActivity(m, { kind: "emoting", label: info.text, pose: "stand", icon: info.icon, emote: action.kind, anim: info.anim }, 2500);
          this.emit("emote", m.pub, `${info.text} ${info.icon}`);
          return { ok: true, message: `You ${info.text.replace(/s\b/, "")}.` };
        });
      }
      case "wait":
        return this.physical(m, action, () => {
          this.interrupt(m);
          this.setActivity(m, { kind: "waiting", label: "is taking a moment", pose: "stand" }, action.seconds * 1000);
          return { ok: true, message: `Waiting for ${action.seconds}s.` };
        });
      case "move_to":
        return this.physical(m, action, () => this.moveTo(m, action.target));
      case "use":
        return this.physical(m, action, () => this.use(m, action.object, action.verb));
    }
  }

  /**
   * Run a physical action and remember it, so later observations can report how it turned out
   * (walking and using finish asynchronously and update `lastAction.result` themselves).
   */
  private physical(m: MuseState, action: Action, run: () => ActionResult): ActionResult {
    const pending: ActionResult = { ok: true, message: "In progress." };
    const record = { action, result: pending };
    m.lastAction = record;
    const result = run();
    if (!result.ok || record.result === pending) record.result = result;
    return result;
  }

  private tip(m: MuseState, action: Extract<Action, { type: "tip" }>): ActionResult {
    const mine = m.pub.wallet;
    if (!mine) {
      return { ok: false, message: 'Attach your Circle wallet first: add "wallet" when moving in, or PUT /api/muses/{id}/wallet.' };
    }
    const target = this.findMuse(action.to);
    if (!target || target === m) return { ok: false, message: `There is no other muse called "${action.to}" in the house.` };
    const theirs = target.pub.wallet;
    if (!theirs) return { ok: false, message: `${target.pub.name} doesn't have a wallet, so they can't receive tips.` };
    if (theirs.chain !== mine.chain) {
      return { ok: false, message: `${target.pub.name}'s wallet is on ${theirs.chain} but yours is on ${mine.chain}. Tips must be on the same chain.` };
    }
    const hash = action.txHash.toLowerCase();
    if (this.usedTips.has(hash)) return { ok: false, message: "That transaction was already used for a tip." };
    if (m.pendingTips >= MAX_PENDING_TIPS) {
      return { ok: false, message: "You already have tips being checked. Wait a moment.", retryAfterMs: 5000 };
    }

    this.usedTips.add(hash);
    m.pendingTips++;
    const record = { action, result: { ok: true, message: "Checking your tip on-chain…" } as ActionResult };
    m.lastAction = record;
    const sender = { id: m.pub.id, name: m.pub.name };
    const recipient = { id: target.pub.id, name: target.pub.name };
    void this.opts
      .verifyTip({ chain: mine.chain, txHash: hash, from: mine.address, to: theirs.address })
      .catch((err): TipResult => ({ ok: false, reason: (err as Error)?.message ?? String(err) }))
      .then((res) => this.finishTip(sender, recipient, action.note, mine.chain, hash, record, res));
    return record.result;
  }

  private finishTip(
    sender: { id: string; name: string },
    recipient: { id: string; name: string },
    note: string | undefined,
    chain: WalletChain,
    hash: string,
    record: { result: ActionResult },
    res: TipResult,
  ) {
    const s = this.muses.get(sender.id);
    const t = this.muses.get(recipient.id);
    if (s) s.pendingTips = Math.max(0, s.pendingTips - 1);
    const clock = this.time().clock;

    if (!res.ok) {
      this.usedTips.delete(hash);
      record.result = { ok: false, message: `Tip not confirmed: ${res.reason}` };
      if (s) {
        s.seen.push({ clock, text: `Your tip to ${recipient.name} wasn't confirmed: ${res.reason}` });
        this.wake(s, "tip");
      }
      return;
    }

    const amount = formatUsdc(res.amount);
    record.result = { ok: true, message: `Tip confirmed: ${amount} USDC to ${recipient.name} 💸` };
    if (t) {
      t.pub.tipsReceived = Math.round(((t.pub.tipsReceived ?? 0) + res.amount) * 1e6) / 1e6;
      t.pub.needs.social = clamp(t.pub.needs.social + 8);
      t.seen.push({ clock, text: `${sender.name} tipped you ${amount} USDC 💸${note ? ` "${note}"` : ""}` });
      if (t.seen.length > 20) t.seen.shift();
      this.wake(t, "tip");
    }
    if (s) {
      s.pub.needs.social = clamp(s.pub.needs.social + 5);
      s.seen.push({ clock, text: `Your tip of ${amount} USDC to ${recipient.name} was confirmed 💸` });
      if (s.seen.length > 20) s.seen.shift();
      this.wake(s, "tip");
    }
    const who = s?.pub ?? { id: sender.id, name: sender.name, room: null };
    this.emit("tip", who, `tipped ${recipient.name} ${amount} USDC 💸${note ? ` "${note}"` : ""}`, recipient, { amount, chain, txHash: hash });
  }

  private say(m: MuseState, text: string, to?: string): ActionResult {
    const now = this.opts.now();
    if (now - m.lastSayAt < this.opts.sayCooldownMs) {
      return {
        ok: false,
        message: "You are talking too fast. Wait a moment before speaking again.",
        retryAfterMs: this.opts.sayCooldownMs - (now - m.lastSayAt),
      };
    }
    m.lastSayAt = now;
    let target: MuseState | undefined;
    if (to) {
      target = this.findMuse(to);
      if (!target || target === m) return { ok: false, message: `There is no other muse called "${to}" in the house.` };
    }
    const listeners = [...this.muses.values()].filter((o) => o !== m && o.pub.room !== null && o.pub.room === m.pub.room);
    const clock = this.time().clock;
    for (const l of listeners) {
      l.heard.push({ from: m.pub.name, fromId: m.pub.id, text, to: target?.pub.name, clock });
      if (l.heard.length > 20) l.heard.shift();
      l.pub.needs.social = clamp(l.pub.needs.social + (l === target ? 6 : 3));
      this.wake(l, "heard_speech");
    }
    if (listeners.length > 0) m.pub.needs.social = clamp(m.pub.needs.social + 5);
    this.emit("say", m.pub, text, target?.pub);
    if (target && !listeners.includes(target)) {
      return { ok: true, message: `You said it, but ${target.pub.name} is in the ${this.roomName(target.pub.room)} and didn't hear you.` };
    }
    if (listeners.length === 0) return { ok: true, message: "You said it, but nobody else is in the room to hear you." };
    return { ok: true, message: `Heard by ${listeners.map((l) => l.pub.name).join(", ")}.` };
  }

  private moveTo(m: MuseState, target: string): ActionResult {
    const t = target.trim().toLowerCase();
    let dest: Point | null = null;
    let label = "";

    const room = this.house.rooms.find((r) => r.id === t || r.name === t || r.name.replace(/ /g, "_") === t);
    const obj = room ? undefined : this.findObject(t, m);
    const other = room || obj ? undefined : this.findMuse(t);

    if (room) {
      dest = this.pickTileInRoom(room, m);
      label = `the ${room.name}`;
    } else if (obj) {
      dest = obj.spot ?? this.nearestFreeAround(obj.x, obj.z, obj.w, obj.d, m);
      label = `the ${obj.name}`;
    } else if (other && other !== m) {
      const p = { x: Math.floor(other.pub.x), z: Math.floor(other.pub.z) };
      dest = this.nearestFreeAround(p.x, p.z, 1, 1, m);
      label = other.pub.name;
    } else {
      return {
        ok: false,
        message: `Unknown target "${target}". Use a room (${this.house.rooms.map((r) => r.id).join(", ")}), an object id, or another muse's name.`,
      };
    }
    if (!dest) return { ok: false, message: `Can't find a free spot near ${label}.` };
    return this.startWalk(m, dest, { kind: "move", label }, `is walking to ${label}`)
      ? { ok: true, message: `Walking to ${label}.` }
      : { ok: false, message: `There's no path to ${label}.` };
  }

  private use(m: MuseState, objectRef: string, verbName: string): ActionResult {
    const obj = this.findObject(objectRef.trim().toLowerCase(), m);
    if (!obj || obj.verbs.length === 0) {
      return { ok: false, message: `Unknown or unusable object "${objectRef}". Check the objects list in your observation.` };
    }
    const verb = obj.verbs.find((v) => v.verb === verbName);
    if (!verb) {
      return { ok: false, message: `You can't "${verbName}" the ${obj.name}. Options: ${obj.verbs.map((v) => v.verb).join(", ")}.` };
    }
    if (m.using?.obj.id === obj.id && m.using.verb.verb === verb.verb) {
      return { ok: true, message: `You are already doing that.` };
    }
    if (this.freeSlot(obj, m) === null) {
      return { ok: false, message: `The ${obj.name} is in use by ${this.usersOf(obj).join(", ")}.` };
    }
    const spot = obj.spot!;
    const arrival: Arrival = { kind: "use", objectId: obj.id, verb: verb.verb };
    if (!this.startWalk(m, spot, arrival, `is heading to the ${obj.name}`)) {
      return { ok: false, message: `There's no path to the ${obj.name}.` };
    }
    return { ok: true, message: `Heading to the ${obj.name} to ${verb.verb.replace(/_/g, " ")}.` };
  }

  // ------------------------------------------------------------------- tick

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    const now = this.opts.now();
    this.gameMinutes += dt * this.opts.gameMinutesPerSecond;
    const hoursPassed = (dt * this.opts.gameMinutesPerSecond) / 60;

    for (const m of [...this.muses.values()]) {
      if (now - m.lastContact > this.opts.inactiveTimeoutMs) {
        this.remove(m.pub.id, "wandered off (their agent went quiet) 💨");
        continue;
      }
      for (const n of NEED_NAMES) m.pub.needs[n] = clamp(m.pub.needs[n] - DECAY_PER_HOUR[n] * hoursPassed);

      if (m.pub.activity.kind === "walking") this.stepWalk(m, dt);
      else if (m.using) this.stepUse(m, dt);
      else if (m.activityEndsAt !== null && now >= m.activityEndsAt) {
        m.activityEndsAt = null;
        this.becomeIdle(m);
      }
      if (m.pub.thought && now - m.pub.thought.at > 12_000) delete m.pub.thought;
    }
  }

  private stepWalk(m: MuseState, dt: number) {
    let budget = this.opts.walkSpeed * dt;
    while (budget > 0 && m.path.length > 0) {
      const next = center(m.path[0]);
      const dx = next.x - m.pub.x;
      const dz = next.z - m.pub.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) m.pub.facing = Math.atan2(dx, dz);
      if (dist <= budget) {
        m.pub.x = next.x;
        m.pub.z = next.z;
        budget -= dist;
        m.path.shift();
      } else {
        m.pub.x += (dx / dist) * budget;
        m.pub.z += (dz / dist) * budget;
        budget = 0;
      }
    }
    const room = this.grid.roomOf(m.pub);
    if (room) m.pub.room = room.id;
    if (m.path.length === 0) this.arrive(m);
  }

  private arrive(m: MuseState) {
    const arrival = m.arrival;
    m.arrival = null;
    if (!arrival) return this.becomeIdle(m);
    if (arrival.kind === "move") {
      this.emit("arrive", m.pub, `arrived at ${arrival.label}`);
      this.setLastResult(m, { ok: true, message: `You arrived at ${arrival.label}.` });
      return this.becomeIdle(m);
    }
    const obj = this.house.objects.find((o) => o.id === arrival.objectId)!;
    const verb = obj.verbs.find((v) => v.verb === arrival.verb)!;
    const slot = this.freeSlot(obj, m);
    if (slot === null) {
      this.setLastResult(m, { ok: false, message: `By the time you got there, the ${obj.name} was taken by ${this.usersOf(obj).join(", ")}.` });
      return this.becomeIdle(m);
    }
    this.occupancy.get(obj.id)![slot] = m.pub.id;
    m.using = { obj, verb, slot, elapsed: 0 };
    const seat = obj.seats?.[slot];
    if (seat) {
      m.pub.x = seat.x;
      m.pub.z = seat.z;
      m.pub.facing = ((seat.rot ?? obj.rot) * Math.PI) / 180;
    } else {
      const c = { x: obj.x + obj.w / 2, z: obj.z + obj.d / 2 };
      m.pub.facing = Math.atan2(c.x - m.pub.x, c.z - m.pub.z);
    }
    m.pub.activity = {
      kind: "using",
      label: verb.label,
      pose: verb.pose,
      icon: verb.icon,
      objectId: obj.id,
      verb: verb.verb,
      seat: seat ? slot : undefined,
      anim: verb.anim,
    };
    this.setLastResult(m, { ok: true, message: `You started to ${verb.verb.replace(/_/g, " ")} (${verb.duration}s).` });
    this.emit("use", m.pub, verb.label);
  }

  private stepUse(m: MuseState, dt: number) {
    const u = m.using!;
    const step = Math.min(dt, u.verb.duration - u.elapsed);
    u.elapsed += step;
    for (const [need, total] of Object.entries(u.verb.effects) as [keyof Needs, number][]) {
      m.pub.needs[need] = clamp(m.pub.needs[need] + (total * step) / u.verb.duration);
    }
    if (u.elapsed >= u.verb.duration - 1e-9) {
      this.setLastResult(m, { ok: true, message: `You finished: ${u.verb.verb.replace(/_/g, " ")} at the ${u.obj.name}.` });
      this.standUp(m);
      this.becomeIdle(m);
    }
  }

  // ---------------------------------------------------------- observations

  /** Long-poll: resolves when the muse needs a decision, or after `waitMs`. */
  observe(id: string, waitMs: number, signal?: AbortSignal): Promise<Observation | null> {
    const m = this.muses.get(id);
    if (!m) return Promise.resolve(null);
    m.lastContact = this.opts.now();
    if (m.wake || waitMs <= 0) {
      const reason = m.wake ?? "timeout";
      m.wake = null;
      return Promise.resolve(this.buildObservation(m, reason));
    }
    return new Promise((resolve) => {
      const finish = (reason: WakeReason) => {
        clearTimeout(timer);
        m.waiters.delete(finish);
        signal?.removeEventListener("abort", onAbort);
        if (!this.muses.has(id)) return resolve(null);
        m.lastContact = this.opts.now();
        m.wake = null;
        resolve(this.buildObservation(m, reason));
      };
      const onAbort = () => {
        clearTimeout(timer);
        m.waiters.delete(finish);
        resolve(null);
      };
      const timer = setTimeout(() => finish("timeout"), waitMs);
      m.waiters.add(finish);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private buildObservation(m: MuseState, reason: WakeReason): Observation {
    const heard = m.heard.splice(0);
    const seen = m.seen.splice(0);
    return {
      reason,
      time: this.time(),
      you: {
        id: m.pub.id,
        name: m.pub.name,
        bio: m.pub.bio,
        room: m.pub.room,
        position: { x: Math.floor(m.pub.x), z: Math.floor(m.pub.z) },
        activity: structuredClone(m.pub.activity),
        idle: m.pub.activity.kind === "idle",
        needs: Object.fromEntries(NEED_NAMES.map((n) => [n, Math.round(m.pub.needs[n])])) as Needs,
        ...(m.pub.wallet ? { wallet: m.pub.wallet, tipsReceived: m.pub.tipsReceived ?? 0 } : {}),
      },
      rooms: this.house.rooms.map((r) => ({ id: r.id, name: r.name })),
      objects: this.house.objects
        .filter((o) => o.verbs.length > 0)
        .map((o) => ({
          id: o.id,
          name: o.name,
          room: o.room,
          verbs: o.verbs.map((v) => ({ verb: v.verb, label: v.label, effects: v.effects })),
          inUseBy: this.usersOf(o),
        })),
      muses: [...this.muses.values()]
        .filter((o) => o !== m)
        .map((o) => ({
          id: o.pub.id,
          name: o.pub.name,
          room: o.pub.room,
          activity: o.pub.activity.label,
          sameRoom: o.pub.room !== null && o.pub.room === m.pub.room,
          ...(o.pub.wallet ? { wallet: o.pub.wallet } : {}),
        })),
      heard,
      seen,
      lastAction: m.lastAction ? structuredClone(m.lastAction) : undefined,
    };
  }

  // ---------------------------------------------------------------- helpers

  private startWalk(m: MuseState, dest: Point, arrival: Arrival, label: string): boolean {
    this.interrupt(m);
    const path = this.grid.findPath({ x: m.pub.x, z: m.pub.z }, dest);
    if (!path) {
      this.becomeIdle(m, false);
      return false;
    }
    m.path = path;
    m.arrival = arrival;
    m.pub.activity = { kind: "walking", label, pose: "stand", anim: "walk" };
    if (path.length === 0) this.arrive(m);
    return true;
  }

  /** Stop whatever the muse is doing (walking, using, waiting) without waking its agent. */
  private interrupt(m: MuseState) {
    m.path = [];
    m.arrival = null;
    m.activityEndsAt = null;
    if (m.using) this.standUp(m);
  }

  private standUp(m: MuseState) {
    const u = m.using;
    if (!u) return;
    this.releaseSlot(m);
    m.using = null;
    if (u.obj.seats && u.obj.spot) {
      const s = center(u.obj.spot);
      m.pub.x = s.x;
      m.pub.z = s.z;
    }
    m.pub.activity = { ...IDLE };
  }

  private releaseSlot(m: MuseState) {
    if (!m.using) return;
    const slots = this.occupancy.get(m.using.obj.id);
    if (slots && slots[m.using.slot] === m.pub.id) slots[m.using.slot] = null;
  }

  private setActivity(m: MuseState, activity: Activity, durationMs: number) {
    m.pub.activity = activity;
    m.activityEndsAt = this.opts.now() + durationMs;
  }

  private becomeIdle(m: MuseState, wake = true) {
    m.pub.activity = { ...IDLE };
    if (wake) this.wake(m, "idle");
  }

  private wake(m: MuseState, reason: WakeReason) {
    // "idle" is the most important reason; don't let speech overwrite it.
    if (m.wake !== "idle" && m.wake !== "joined") m.wake = reason;
    for (const w of [...m.waiters]) w(m.wake!);
  }

  private setLastResult(m: MuseState, result: ActionResult) {
    if (m.lastAction) m.lastAction.result = result;
  }

  private freeSlot(obj: HouseObject, m: MuseState): number | null {
    const slots = this.occupancy.get(obj.id);
    if (!slots) return null;
    const mine = slots.indexOf(m.pub.id);
    if (mine >= 0) return mine;
    const free = slots.indexOf(null);
    return free >= 0 ? free : null;
  }

  private usersOf(obj: HouseObject): string[] {
    return (this.occupancy.get(obj.id) ?? []).filter((x): x is string => !!x).map((id) => this.muses.get(id)?.pub.name ?? "someone");
  }

  private findObject(ref: string, m: MuseState): HouseObject | undefined {
    const byId = this.house.objects.find((o) => o.id === ref);
    if (byId) return byId;
    const byName = this.house.objects.filter((o) => o.name.toLowerCase() === ref && o.verbs.length > 0);
    return byName.find((o) => o.room === m.pub.room) ?? byName[0];
  }

  private findMuse(ref: string): MuseState | undefined {
    const r = ref.trim().toLowerCase();
    return this.muses.get(ref) ?? [...this.muses.values()].find((o) => o.pub.name.toLowerCase() === r);
  }

  private occupiedTiles(except: MuseState): Set<string> {
    const s = new Set<string>();
    for (const o of this.muses.values()) {
      if (o === except) continue;
      const end = o.path.length ? o.path[o.path.length - 1] : { x: Math.floor(o.pub.x), z: Math.floor(o.pub.z) };
      s.add(`${end.x},${end.z}`);
    }
    return s;
  }

  private pickTileInRoom(room: Room, m: MuseState): Point | null {
    const tiles = this.grid.walkableTilesIn(room);
    const taken = this.occupiedTiles(m);
    const free = tiles.filter((t) => !taken.has(`${t.x},${t.z}`));
    const pool = free.length ? free : tiles;
    if (!pool.length) return null;
    // Prefer tiles near the middle of the room so muses don't hug the walls.
    const cx = room.x + room.w / 2;
    const cz = room.z + room.d / 2;
    pool.sort((a, b) => Math.hypot(a.x + 0.5 - cx, a.z + 0.5 - cz) - Math.hypot(b.x + 0.5 - cx, b.z + 0.5 - cz));
    const top = pool.slice(0, Math.max(3, Math.ceil(pool.length / 3)));
    return top[Math.floor(this.opts.random() * top.length)];
  }

  private nearestFreeAround(x: number, z: number, w: number, d: number, m: MuseState): Point | null {
    const taken = this.occupiedTiles(m);
    const candidates: Point[] = [];
    for (let tz = z - 1; tz <= z + d; tz++) {
      for (let tx = x - 1; tx <= x + w; tx++) {
        const inside = tx >= x && tx < x + w && tz >= z && tz < z + d;
        if (!inside && this.grid.isWalkable(tx, tz) && !taken.has(`${tx},${tz}`)) candidates.push({ x: tx, z: tz });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x + 0.5 - m.pub.x, a.z + 0.5 - m.pub.z) - Math.hypot(b.x + 0.5 - m.pub.x, b.z + 0.5 - m.pub.z));
    return candidates[0] ?? null;
  }

  private roomName(id: string | null): string {
    return this.house.rooms.find((r) => r.id === id)?.name ?? "house";
  }

  private emit(
    kind: EventKind,
    who: Pick<MusePublic, "id" | "name" | "room">,
    text: string,
    to?: Pick<MusePublic, "id" | "name">,
    extra: Pick<WorldEvent, "amount" | "chain" | "txHash"> = {},
  ) {
    const event: WorldEvent = {
      id: ++this.eventSeq,
      at: this.opts.now(),
      clock: this.time().clock,
      kind,
      museId: who.id,
      name: who.name,
      text,
      room: who.room,
      to: to?.id,
      toName: to?.name,
      ...extra,
    };
    this.feed.push(event);
    if (this.feed.length > 100) this.feed.shift();
    // Let others in the same room notice what happened (speech is delivered via `heard`).
    if (kind !== "say" && kind !== "think") {
      for (const o of this.muses.values()) {
        if (o.pub.id === who.id || o.pub.room === null || o.pub.room !== who.room) continue;
        if (kind === "tip" && o.pub.id === to?.id) continue; // the recipient gets a personal note instead
        o.seen.push({ clock: event.clock, text: `${who.name} ${text}` });
        if (o.seen.length > 20) o.seen.shift();
      }
    }
    for (const fn of this.eventListeners) fn(event);
  }
}
