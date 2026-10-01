/**
 * A rule-based muse: no AI, no API key. It looks after its needs, wanders around,
 * and chats with whoever is in the same room using canned lines.
 *
 *   npm run simple -w examples -- "Pip" "A cheerful gardener who hums all day."
 */
import { pathToFileURL } from "node:url";
import { chooseAction, type Observation, type Persona } from "@musehouse/shared";
import { MuseClient, sleep } from "./client.js";

export type { Persona };

export async function runSimpleMuse(p: Persona, signal?: AbortSignal) {
  const muse = await MuseClient.moveIn({ name: p.name, bio: p.bio });
  console.log(`🏠 ${p.name} moved in (${muse.museId})`);
  signal?.addEventListener("abort", () => void muse.leave(), { once: true });
  const memory = { greeted: new Set<string>() };
  // Speaking doesn't change what we're doing, so the house won't wake us again; poll briefly instead.
  let quickPoll = false;

  while (!signal?.aborted) {
    let obs: Observation | null;
    try {
      obs = await muse.observe(quickPoll ? 2 : 25);
    } catch (err) {
      console.warn(`${p.name}: ${(err as Error).message}; retrying`);
      await sleep(2000);
      continue;
    }
    if (!obs) {
      console.log(`${p.name} is no longer in the house.`);
      return;
    }
    // A little thinking time makes things feel more natural.
    await sleep(400 + Math.random() * 900);
    const action = chooseAction(obs, p, memory);
    quickPoll = obs.you.idle && (!action || action.type === "say" || action.type === "think");
    if (!action) continue;
    const result = await muse.act(action);
    const what = "text" in action ? `"${action.text}"` : JSON.stringify(action);
    console.log(`${p.name} ${action.type} ${what} -> ${result.message}`);
    if (!result.ok) quickPoll = true;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [name = "Pip", bio = "A cheerful gardener who hums all day."] = process.argv.slice(2);
  const ac = new AbortController();
  process.on("SIGINT", () => {
    ac.abort();
    setTimeout(() => process.exit(0), 300);
  });
  await runSimpleMuse(
    {
      name,
      bio,
      greetings: ["Hi {name}! 👋", "Oh hey {name}, good to see you!", "Hello {name}!"],
      replies: ["Haha, totally!", "I was just thinking the same thing.", "Hmm, good question… I'm not sure!", "That sounds lovely."],
      musings: ["I wonder what's for dinner.", "This house feels cozy today.", "Maybe I should water the flowers."],
      favourites: ["water_flowers", "relax"],
    },
    ac.signal,
  );
}
