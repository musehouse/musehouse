import { describe, expect, it } from "vitest";
import { HOUSE } from "../src/world/house.js";
import { Grid } from "../src/world/grid.js";
import { World } from "../src/world/sim.js";

function makeWorld() {
  let now = 1_000_000;
  const world = new World(HOUSE, { now: () => now, random: () => 0, actionCooldownMs: 0, sayCooldownMs: 0 });
  const advance = (ms: number, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      world.tick(step);
    }
  };
  const join = (name: string) => {
    const r = world.register({ name, bio: "" });
    if (!r.ok) throw new Error(r.message);
    return r.muse.id;
  };
  const muse = (id: string) => world.publicMuses().find((m) => m.id === id)!;
  return { world, advance, join, muse };
}

describe("house layout", () => {
  const grid = new Grid(HOUSE);

  it("has a rectangular map", () => {
    for (const row of HOUSE.tiles) expect(row.length).toBe(HOUSE.width);
    expect(HOUSE.tiles.length).toBe(HOUSE.depth);
  });

  it("can reach every room and every usable object from the front door", () => {
    for (const room of HOUSE.rooms) {
      const tiles = grid.walkableTilesIn(room);
      expect(tiles.length, room.id).toBeGreaterThan(0);
      expect(grid.findPath(HOUSE.spawn, tiles[0]), room.id).not.toBeNull();
    }
    for (const obj of HOUSE.objects.filter((o) => o.verbs.length > 0)) {
      expect(obj.spot, obj.id).toBeDefined();
      expect(grid.isWalkable(obj.spot!.x, obj.spot!.z), `${obj.id} spot walkable`).toBe(true);
      expect(grid.findPath(HOUSE.spawn, obj.spot!), obj.id).not.toBeNull();
    }
  });

  it("keeps objects inside their room and object ids unique", () => {
    const ids = new Set<string>();
    for (const obj of HOUSE.objects) {
      expect(ids.has(obj.id), obj.id).toBe(false);
      ids.add(obj.id);
      const room = HOUSE.rooms.find((r) => r.id === obj.room)!;
      expect(obj.x >= room.x && obj.x + obj.w <= room.x + room.w, `${obj.id} x`).toBe(true);
      expect(obj.z >= room.z && obj.z + obj.d <= room.z + room.d, `${obj.id} z`).toBe(true);
    }
  });
});

describe("world simulation", () => {
  it("spawns muses at the front door and asks them for a decision", async () => {
    const { world, join } = makeWorld();
    const id = join("Nova");
    const obs = await world.observe(id, 0);
    expect(obs?.reason).toBe("joined");
    expect(obs?.you.room).toBe("living_room");
    expect(obs?.objects.some((o) => o.id === "fridge")).toBe(true);
  });

  it("rejects duplicate names", () => {
    const { world, join } = makeWorld();
    join("Nova");
    const r = world.register({ name: "nova", bio: "" });
    expect(r.ok).toBe(false);
  });

  it("walks to a room and wakes the agent on arrival", async () => {
    const { world, join, advance, muse } = makeWorld();
    const id = join("Nova");
    await world.observe(id, 0);
    expect(world.act(id, { type: "move_to", target: "kitchen" }).ok).toBe(true);
    expect(muse(id).activity.kind).toBe("walking");
    advance(15_000);
    expect(muse(id).room).toBe("kitchen");
    const obs = await world.observe(id, 0);
    expect(obs?.reason).toBe("idle");
    expect(obs?.lastAction?.result.message).toMatch(/arrived/);
  });

  it("uses objects, applies their effects and finishes", async () => {
    const { world, join, advance, muse } = makeWorld();
    const id = join("Nova");
    const before = muse(id).needs.food;
    expect(world.act(id, { type: "use", object: "stove", verb: "cook_meal" }).ok).toBe(true);
    advance(10_000);
    expect(muse(id).activity.verb).toBe("cook_meal");
    advance(25_000);
    expect(muse(id).activity.kind).toBe("idle");
    expect(muse(id).needs.food).toBeGreaterThan(Math.min(100, before + 60) - 2); // capped at 100
  });

  it("rejects invalid objects and verbs", () => {
    const { world, join } = makeWorld();
    const id = join("Nova");
    expect(world.act(id, { type: "use", object: "spaceship", verb: "fly" }).ok).toBe(false);
    expect(world.act(id, { type: "use", object: "fridge", verb: "dance" }).ok).toBe(false);
    expect(world.act(id, { type: "move_to", target: "moon" }).ok).toBe(false);
  });

  it("seats muses on separate seats and refuses when full", () => {
    const { world, join, advance, muse } = makeWorld();
    const a = join("Ada");
    const b = join("Bo");
    const c = join("Cy");
    world.act(a, { type: "use", object: "sofa", verb: "watch_tv" });
    world.act(b, { type: "use", object: "sofa", verb: "watch_tv" });
    advance(6000);
    expect(muse(a).activity.seat).toBe(0);
    expect(muse(b).activity.seat).toBe(1);
    const r = world.act(c, { type: "use", object: "sofa", verb: "sit" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/in use/);
  });

  it("delivers speech to muses in the same room and wakes them", async () => {
    const { world, join } = makeWorld();
    const a = join("Ada");
    const b = join("Bo");
    await world.observe(a, 0);
    await world.observe(b, 0);
    const pending = world.observe(b, 5_000);
    world.act(a, { type: "say", text: "Hello Bo!", to: "Bo" });
    const obs = await pending;
    expect(obs?.reason).toBe("heard_speech");
    expect(obs?.heard[0]).toMatchObject({ from: "Ada", text: "Hello Bo!", to: "Bo" });
  });

  it("does not deliver speech to other rooms", async () => {
    const { world, join, advance } = makeWorld();
    const a = join("Ada");
    const b = join("Bo");
    world.act(b, { type: "move_to", target: "garden" });
    advance(20_000);
    await world.observe(b, 0);
    const r = world.act(a, { type: "say", text: "Anyone?", to: "Bo" });
    expect(r.message).toMatch(/didn't hear/);
    const obs = await world.observe(b, 0);
    expect(obs?.heard ?? []).toHaveLength(0);
  });

  it("decays needs over time", () => {
    const { join, advance, muse } = makeWorld();
    const id = join("Nova");
    const before = muse(id).needs.food;
    advance(60_000, 1000); // one game hour
    expect(muse(id).needs.food).toBeCloseTo(before - 5, 0);
  });

  it("removes muses whose agent goes quiet", () => {
    const { world, join, advance } = makeWorld();
    const id = join("Nova");
    advance(4 * 60_000, 1000);
    expect(world.has(id)).toBe(false);
  });

  it("long-poll resolves with a timeout observation", async () => {
    const { world, join } = makeWorld();
    const id = join("Nova");
    await world.observe(id, 0);
    const obs = await world.observe(id, 20);
    expect(obs?.reason).toBe("timeout");
  });
});

describe("wallets and tips", () => {
  const W1 = { address: "0x1111111111111111111111111111111111111111", chain: "BASE-SEPOLIA" as const };
  const W2 = { address: "0x2222222222222222222222222222222222222222", chain: "BASE-SEPOLIA" as const };
  const HASH = "0x" + "cd".repeat(32);

  function tipWorld(verify: (c: unknown) => Promise<{ ok: true; amount: number } | { ok: false; reason: string }>) {
    const world = new World(HOUSE, { actionCooldownMs: 0, sayCooldownMs: 0, verifyTip: verify as never });
    const a = world.register({ name: "Ada", bio: "", wallet: W1 });
    const b = world.register({ name: "Bo", bio: "", wallet: W2 });
    if (!a.ok || !b.ok) throw new Error("register failed");
    return { world, a: a.muse.id, b: b.muse.id };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("confirms a tip, credits the recipient and tells both muses", async () => {
    const calls: unknown[] = [];
    const { world, a, b } = tipWorld(async (c) => {
      calls.push(c);
      return { ok: true, amount: 0.1 };
    });
    const events: string[] = [];
    world.onEvent((e) => e.kind === "tip" && events.push(`${e.name}->${e.toName} ${e.amount} ${e.chain}`));
    await world.observe(b, 0);
    const r = world.act(a, { type: "tip", to: "Bo", txHash: HASH, note: "thanks!" });
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Checking/) });
    await settle();
    expect(calls[0]).toMatchObject({ chain: "BASE-SEPOLIA", from: W1.address, to: W2.address, txHash: HASH });
    expect(events).toEqual(["Ada->Bo 0.10 BASE-SEPOLIA"]);
    expect(world.publicMuses().find((m) => m.id === b)?.tipsReceived).toBeCloseTo(0.1);
    const obs = await world.observe(b, 0);
    expect(obs?.reason).toBe("tip");
    expect(obs?.seen.some((s) => /Ada tipped you 0.10 USDC/.test(s.text))).toBe(true);
    const mine = await world.observe(a, 0);
    expect(mine?.lastAction?.result.message).toMatch(/Tip confirmed/);
  });

  it("refuses reused transactions", async () => {
    const { world, a } = tipWorld(async () => ({ ok: true, amount: 1 }));
    world.act(a, { type: "tip", to: "Bo", txHash: HASH });
    await settle();
    expect(world.act(a, { type: "tip", to: "Bo", txHash: HASH.toUpperCase().replace("0X", "0x") }).ok).toBe(false);
  });

  it("reports failed verification and frees the hash", async () => {
    let ok = false;
    const { world, a } = tipWorld(async () => (ok ? { ok: true, amount: 1 } : { ok: false, reason: "No USDC transfer" }));
    world.act(a, { type: "tip", to: "Bo", txHash: HASH });
    await settle();
    const obs = await world.observe(a, 0);
    expect(obs?.lastAction?.result).toMatchObject({ ok: false, message: expect.stringMatching(/not confirmed/) });
    ok = true;
    expect(world.act(a, { type: "tip", to: "Bo", txHash: HASH }).ok).toBe(true);
  });

  it("validates wallets, targets and chains", () => {
    const world = new World(HOUSE, { actionCooldownMs: 0, verifyTip: async () => ({ ok: true, amount: 1 }) });
    const a = world.register({ name: "Ada", bio: "" });
    const b = world.register({ name: "Bo", bio: "", wallet: W2 });
    const c = world.register({ name: "Cy", bio: "", wallet: { ...W1, chain: "ARC-TESTNET" } });
    if (!a.ok || !b.ok || !c.ok) throw new Error("register failed");
    expect(world.act(a.muse.id, { type: "tip", to: "Bo", txHash: HASH }).message).toMatch(/Attach your Circle wallet/);
    world.setWallet(a.muse.id, W1);
    expect(world.act(a.muse.id, { type: "tip", to: "Nobody", txHash: HASH }).ok).toBe(false);
    expect(world.act(a.muse.id, { type: "tip", to: "Cy", txHash: HASH }).message).toMatch(/same chain/);
    expect(world.act(a.muse.id, { type: "tip", to: "Ada", txHash: HASH }).ok).toBe(false);
  });

  it("can't tip NPCs, who have no wallet", () => {
    const world = new World(HOUSE, { actionCooldownMs: 0 });
    world.register({ name: "Puff", bio: "" }, { npc: true });
    const a = world.register({ name: "Ada", bio: "", wallet: W1 });
    if (!a.ok) throw new Error("register failed");
    expect(world.act(a.muse.id, { type: "tip", to: "Puff", txHash: HASH }).message).toMatch(/doesn't have a wallet/);
  });

  it("shares wallets in observations so agents know where to send", async () => {
    const { world, a } = tipWorld(async () => ({ ok: true, amount: 1 }));
    const obs = await world.observe(a, 0);
    expect(obs?.you.wallet).toEqual(W1);
    expect(obs?.muses.find((m) => m.name === "Bo")?.wallet).toEqual(W2);
  });
});
