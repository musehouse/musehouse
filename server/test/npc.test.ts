import { afterEach, describe, expect, it } from "vitest";
import { chooseAction, type Observation } from "@musehouse/shared";
import { HOUSE } from "../src/world/house.js";
import { World } from "../src/world/sim.js";
import { NPCS } from "../src/npc/roster.js";
import { startNpcs } from "../src/npc/runner.js";

let stop: (() => void) | null = null;
afterEach(() => stop?.());

describe("npcs", () => {
  it("move in as house-run residents with their own looks, in their own rooms", () => {
    const world = new World(HOUSE);
    stop = startNpcs(world, NPCS);
    const muses = world.publicMuses();
    expect(muses).toHaveLength(NPCS.length);
    for (const npc of NPCS) {
      const m = muses.find((x) => x.name === npc.name)!;
      expect(m.npc).toBe(true);
      expect(m.avatar).toBe(npc.avatar);
      expect(world.grid.isWalkable(npc.spawn.x, npc.spawn.z), `${npc.name} spawn`).toBe(true);
    }
    // Their names are taken for agents.
    expect(world.register({ name: "Puff", bio: "" }).ok).toBe(false);
  });

  it("are removed when stopped", () => {
    const world = new World(HOUSE);
    startNpcs(world, NPCS)();
    expect(world.publicMuses()).toHaveLength(0);
  });

  it("brain looks after the lowest need", async () => {
    const world = new World(HOUSE);
    const r = world.register({ name: "Tester", bio: "" });
    if (!r.ok) throw new Error(r.message);
    const obs = (await world.observe(r.muse.id, 0)) as Observation;
    obs.you.needs = { energy: 90, food: 5, fun: 90, social: 90 };
    obs.muses = [];
    const action = chooseAction(obs, { ...NPCS[0], favourites: [] }, { greeted: new Set() });
    expect(action?.type).toBe("use");
    const obj = obs.objects.find((o) => action?.type === "use" && o.id === action.object)!;
    expect(obj.verbs.some((v) => (v.effects.food ?? 0) > 0)).toBe(true);
  });

  it("brain stops replying to the same muse after a few back-and-forths", async () => {
    const world = new World(HOUSE);
    const r = world.register({ name: "Tester", bio: "" });
    if (!r.ok) throw new Error(r.message);
    const obs = (await world.observe(r.muse.id, 0)) as Observation;
    const memory = { greeted: new Set<string>() };
    let replies = 0;
    for (let i = 0; i < 20; i++) {
      obs.heard = [{ from: "Puff", fromId: "x", text: "Hiii!", to: "Tester", clock: "08:00" }];
      if (chooseAction(obs, NPCS[0], memory)?.type === "say") replies++;
    }
    expect(replies).toBeLessThanOrEqual(3);
  });
});
