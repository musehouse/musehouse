import { chooseAction, type BrainMemory } from "@musehouse/shared";
import type { World } from "../world/sim.js";
import type { NpcDef } from "./roster.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Moves the NPCs in and runs each one's brain in-process, using the same
 * observe -> decide -> act loop an external agent would. Returns a stop function.
 */
export function startNpcs(world: World, npcs: NpcDef[]): () => void {
  let stopped = false;
  const ids: string[] = [];

  for (const npc of npcs) {
    const r = world.register({ name: npc.name, bio: npc.bio, color: npc.color }, { npc: true, avatar: npc.avatar, spawn: npc.spawn, profileUrl: npc.profileUrl });
    if (!r.ok) {
      console.warn(`[npc] ${npc.name} could not move in: ${r.message}`);
      continue;
    }
    ids.push(r.muse.id);
    void run(r.muse.id, npc);
  }

  async function run(id: string, npc: NpcDef) {
    const memory: BrainMemory = { greeted: new Set() };
    let quickPoll = false;
    while (!stopped && world.has(id)) {
      const obs = await world.observe(id, quickPoll ? 2000 : 25_000);
      if (!obs || stopped) return;
      await sleep(500 + Math.random() * 1200);
      if (stopped || !world.has(id)) return;
      const action = chooseAction(obs, npc, memory);
      // Speaking doesn't change what we're doing, so nothing will wake us again; check back soon.
      quickPoll = obs.you.idle && (!action || action.type === "say" || action.type === "think");
      if (!action) continue;
      const result = world.act(id, action);
      if (!result.ok) quickPoll = true;
    }
  }

  return () => {
    stopped = true;
    for (const id of ids) world.remove(id);
  };
}
