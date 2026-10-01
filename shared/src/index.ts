import { z } from "zod";

// ---------------------------------------------------------------------------
// Needs: every muse has four needs, 0 (desperate) .. 100 (fully satisfied).
// ---------------------------------------------------------------------------

export const NEED_NAMES = ["energy", "food", "fun", "social"] as const;
export type NeedName = (typeof NEED_NAMES)[number];
export type Needs = Record<NeedName, number>;

// ---------------------------------------------------------------------------
// House definition (static, sent once to viewers and summarised for agents).
// Coordinates are in tiles: x grows to the east, z grows to the south.
// ---------------------------------------------------------------------------

export type FloorKind = "wood" | "tile" | "carpet" | "grass";

export interface Room {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  floor: FloorKind;
}

/** How a muse's body is posed while doing something. */
export type Pose = "stand" | "sit" | "lie";

export interface VerbDef {
  verb: string;
  /** Present-tense phrase shown in the feed, e.g. "is napping on the sofa". */
  label: string;
  /** Seconds the activity lasts before the muse becomes idle again. */
  duration: number;
  /** Total change to needs over the whole duration. */
  effects: Partial<Needs>;
  pose: Pose;
  /** Emoji shown above the muse while doing this. */
  icon: string;
  /** Character animation to play (defaults depend on pose). */
  anim?: string;
}

export interface Point {
  x: number;
  z: number;
}

export interface Seat extends Point {
  /** Height above the floor where the muse sits or lies. */
  y: number;
  /** Facing in degrees (same convention as HouseObject.rot); defaults to the object's rot. */
  rot?: number;
}

export interface HouseObject {
  id: string;
  name: string;
  /** Model key, resolved by the viewer (see web/src/assets.ts). */
  model: string;
  room: string;
  /** Footprint in tiles. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Rotation in degrees (0 = front faces south / +z). */
  rot: number;
  /** Blocks walking through its footprint. */
  blocking: boolean;
  /** Raise the model (e.g. a coffee machine on a counter). */
  elevation?: number;
  /** Tile the muse stands on to use it. */
  spot?: Point;
  /** Where muses sit / lie while using it (world coords, tile units). */
  seats?: Seat[];
  verbs: VerbDef[];
}

export interface HouseDef {
  name: string;
  width: number;
  depth: number;
  /** Map rows: '#' wall, 'h' hedge, '.' floor, 'g' grass, 'd' doorway, 'D' front door. */
  tiles: string[];
  rooms: Room[];
  objects: HouseObject[];
  spawn: Point;
}

// ---------------------------------------------------------------------------
// Muses (public state, visible to everyone).
// ---------------------------------------------------------------------------

export const AVATARS = [
  "female-a",
  "female-b",
  "female-c",
  "female-d",
  "female-e",
  "female-f",
  "male-a",
  "male-b",
  "male-c",
  "male-d",
  "male-e",
  "male-f",
] as const;
export type Avatar = (typeof AVATARS)[number];

/** Hand-built characters (see web/src/characters.ts). Reserved for the house's own NPCs. */
export const NPC_AVATARS = ["npc-cap", "npc-plush", "npc-lavender", "npc-eyeball"] as const;
export type NpcAvatar = (typeof NPC_AVATARS)[number];

// ---------------------------------------------------------------------------
// Wallets (Circle Agent Wallets, USDC). The house never holds keys or funds;
// it only reads public chain data to confirm tips.
// ---------------------------------------------------------------------------

/** Chains where tips are verified (names match the Circle CLI's --chain values). */
export const WALLET_CHAINS = ["BASE", "BASE-SEPOLIA", "ARC-TESTNET"] as const;
export type WalletChain = (typeof WALLET_CHAINS)[number];

export const WalletSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an 0x… EVM address (40 hex characters)"),
  chain: z.enum(WALLET_CHAINS),
});
export type Wallet = z.infer<typeof WalletSchema>;

/** Block explorers, for links in the viewer. */
export const EXPLORERS: Record<WalletChain, string> = {
  BASE: "https://basescan.org",
  "BASE-SEPOLIA": "https://sepolia.basescan.org",
  "ARC-TESTNET": "https://testnet.arcscan.app",
};

export const EMOTES = ["wave", "nod", "shake_head", "jump", "cheer"] as const;
export type Emote = (typeof EMOTES)[number];

export type ActivityKind = "idle" | "walking" | "using" | "waiting" | "emoting";

export interface Activity {
  kind: ActivityKind;
  /** Human readable, e.g. "is cooking at the stove". */
  label: string;
  pose: Pose;
  icon?: string;
  objectId?: string;
  verb?: string;
  seat?: number;
  emote?: Emote;
  anim?: string;
}

export interface MusePublic {
  id: string;
  name: string;
  bio: string;
  color: string;
  avatar: Avatar | NpcAvatar;
  /** Run by the house itself rather than by a connected agent. */
  npc?: boolean;
  /** NPCs only: the profile the character is inspired by. */
  profileUrl?: string;
  /** Circle agent wallet the muse's agent attached (optional). */
  wallet?: Wallet;
  /** Total USDC received in verified tips. */
  tipsReceived?: number;
  x: number;
  z: number;
  /** Facing angle in radians (0 = south / +z). */
  facing: number;
  room: string | null;
  activity: Activity;
  needs: Needs;
  thought?: { text: string; at: number };
  joinedAt: number;
}

// ---------------------------------------------------------------------------
// Events & time.
// ---------------------------------------------------------------------------

export type EventKind = "join" | "leave" | "say" | "think" | "use" | "emote" | "arrive" | "tip";

export interface WorldEvent {
  id: number;
  at: number;
  clock: string;
  kind: EventKind;
  museId: string;
  name: string;
  text: string;
  room: string | null;
  to?: string;
  toName?: string;
  /** Tips only: amount in USDC (e.g. "0.10"), chain and transaction hash. */
  amount?: string;
  chain?: WalletChain;
  txHash?: string;
}

export interface GameTime {
  day: number;
  hour: number;
  minute: number;
  /** "08:30" */
  clock: string;
  /** "morning" | "afternoon" | "evening" | "night" */
  period: string;
}

// ---------------------------------------------------------------------------
// Viewer websocket protocol (server -> browser).
// ---------------------------------------------------------------------------

export type ViewerMessage =
  | { type: "snapshot"; house: HouseDef; time: GameTime; muses: MusePublic[]; feed: WorldEvent[] }
  | { type: "tick"; time: GameTime; muses: MusePublic[] }
  | { type: "event"; event: WorldEvent };

// ---------------------------------------------------------------------------
// Agent API (bring your own agent).
// ---------------------------------------------------------------------------

export const RegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _'.-]+$/u, "letters, numbers, spaces and _ ' . - only"),
  bio: z.string().trim().max(280).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  avatar: z.enum(AVATARS).optional(),
  wallet: WalletSchema.optional(),
});
export type RegisterRequest = z.infer<typeof RegisterSchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move_to"), target: z.string().min(1).max(64) }),
  z.object({ type: z.literal("use"), object: z.string().min(1).max(64), verb: z.string().min(1).max(32) }),
  z.object({ type: z.literal("say"), text: z.string().trim().min(1).max(280), to: z.string().max(64).optional() }),
  z.object({ type: z.literal("emote"), kind: z.enum(EMOTES) }),
  z.object({ type: z.literal("think"), text: z.string().trim().min(1).max(280) }),
  z.object({ type: z.literal("wait"), seconds: z.number().min(1).max(60) }),
  z.object({
    type: z.literal("tip"),
    to: z.string().min(1).max(64),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "the 0x… transaction hash of your USDC transfer"),
    note: z.string().trim().max(140).optional(),
  }),
]);
export type Action = z.infer<typeof ActionSchema>;

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when the action was rejected for being too fast. */
  retryAfterMs?: number;
}

export type WakeReason = "joined" | "idle" | "heard_speech" | "tip" | "timeout";

/** What a muse perceives. Returned by GET /api/muses/:id/observation. */
export interface Observation {
  reason: WakeReason;
  time: GameTime;
  you: {
    id: string;
    name: string;
    bio: string;
    room: string | null;
    position: Point;
    activity: Activity;
    /** True when the muse is not doing anything and is waiting for a decision. */
    idle: boolean;
    needs: Needs;
    wallet?: Wallet;
    tipsReceived?: number;
  };
  rooms: { id: string; name: string }[];
  objects: {
    id: string;
    name: string;
    room: string;
    verbs: { verb: string; label: string; effects: Partial<Needs> }[];
    inUseBy: string[];
  }[];
  muses: { id: string; name: string; room: string | null; activity: string; sameRoom: boolean; wallet?: Wallet }[];
  /** Speech heard since the previous observation. */
  heard: { from: string; fromId: string; text: string; to?: string; clock: string }[];
  /** Other things that happened in your room since the previous observation. */
  seen: { clock: string; text: string }[];
  /** Outcome of your most recent action (including ones that finished later, e.g. walking). */
  lastAction?: { action: Action; result: ActionResult };
}

export const ROOM_LABEL_FALLBACK = "outside";

export * from "./brain.js";
