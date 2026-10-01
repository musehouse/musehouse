/**
 * A muse whose mind is Claude. Each time the house asks for a decision, Claude sees what
 * the muse perceives (plus a short memory) and answers by calling action tools.
 *
 *   ANTHROPIC_API_KEY=... npm run claude -w examples -- "Ada" "A retired astronaut who loves gardening."
 *
 * Env: MUSE_HOUSE_URL (default http://localhost:8787), MUSE_MODEL (default claude-opus-5-5).
 */
import Anthropic from "@anthropic-ai/sdk";
import { ActionSchema, type Action, type Observation } from "@musehouse/shared";
import { MuseClient, sleep } from "./client.js";

const MODEL = process.env.MUSE_MODEL ?? "claude-opus-5-5";
const MIN_SECONDS_BETWEEN_CALLS = 4;
const MEMORY_LINES = 40;

const [name = "Ada", bio = "A retired astronaut who loves gardening, bad puns and long chats over tea."] = process.argv.slice(2);

const client = new Anthropic();

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Beta.BetaTool => ({
  name,
  description,
  strict: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

// Kept in a fixed order so the prompt prefix (tools + system) stays cacheable.
const TOOLS: Anthropic.Beta.BetaTool[] = [
  tool("move_to", "Walk somewhere: a room id, an object id, or another muse's name.", { target: { type: "string" } }, ["target"]),
  tool(
    "use",
    "Walk to an object and do something with it, e.g. object 'stove', verb 'cook_meal'. Only use object ids and verbs listed in the observation.",
    { object: { type: "string" }, verb: { type: "string" } },
    ["object", "verb"],
  ),
  tool(
    "say",
    "Say something out loud. Everyone in the same room hears it. Optionally address one muse by name.",
    { text: { type: "string", description: "One or two short sentences." }, to: { type: "string" } },
    ["text"],
  ),
  tool("emote", "Do a quick gesture.", { kind: { type: "string", enum: ["wave", "nod", "shake_head", "jump", "cheer"] } }, ["kind"]),
  tool("think", "A private thought. Viewers watching the house can see it as a thought bubble.", { text: { type: "string" } }, ["text"]),
  tool("wait", "Do nothing for a few seconds.", { seconds: { type: "integer", minimum: 1, maximum: 60 } }, ["seconds"]),
];

const SYSTEM = `You are ${name}, a "muse" who lives in Muse House: a small cozy 3D house with a living room, kitchen, bedroom and garden that people can watch live.

About you: ${bio}

Live your life in the house the way a real person with this personality would: look after your needs (energy, food, fun, social, each 0-100 where low means you badly need it), enjoy activities, and be a warm, playful housemate. Talk with the other muses when you share a room: react to what they say, ask questions, remember what they told you. Keep every line of speech short and natural (one or two sentences), never narrate actions in speech, and don't repeat yourself.

Each turn you receive what you perceive right now plus your recent memory. Respond only by calling tools: usually one physical action (move_to, use, emote or wait), optionally preceded by say and/or think. Use only the object ids and verbs listed in the observation. If someone just spoke to you, reply with say before doing anything else.`;

function describe(obs: Observation): string {
  const me = obs.you;
  const lines = [
    `Time: day ${obs.time.day}, ${obs.time.clock} (${obs.time.period}). Wake reason: ${obs.reason}.`,
    `You are in the ${me.room ?? "house"}, ${me.activity.label}${me.idle ? " (idle, choose what to do)" : ""}.`,
    `Needs: ${Object.entries(me.needs).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    obs.lastAction ? `Your last action (${obs.lastAction.action.type}): ${obs.lastAction.result.message}` : "",
    "",
    "Other muses:",
    ...(obs.muses.length ? obs.muses.map((m) => `- ${m.name}: in the ${m.room ?? "house"}, ${m.activity}${m.sameRoom ? " (same room as you)" : ""}`) : ["- nobody else is home"]),
    "",
    "Things you can use (object id: verbs [effects]):",
    ...obs.objects.map(
      (o) =>
        `- ${o.id} (${o.room}${o.inUseBy.length ? `, in use by ${o.inUseBy.join(", ")}` : ""}): ` +
        o.verbs.map((v) => `${v.verb} [${Object.entries(v.effects).map(([k, n]) => `${k}${(n ?? 0) > 0 ? "+" : ""}${n}`).join(" ")}]`).join(", "),
    ),
    `Rooms: ${obs.rooms.map((r) => r.id).join(", ")}.`,
  ];
  if (obs.heard.length) {
    lines.push("", "You just heard:", ...obs.heard.map((h) => `- [${h.clock}] ${h.from}${h.to ? ` (to ${h.to})` : ""}: "${h.text}"`));
  }
  if (obs.seen.length) lines.push("", "You noticed:", ...obs.seen.map((s) => `- [${s.clock}] ${s.text}`));
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

async function decide(obs: Observation, memory: string[]): Promise<Action[]> {
  const content = `Your recent memory:\n${memory.length ? memory.join("\n") : "(you just moved in)"}\n\nRight now:\n${describe(obs)}`;
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: TOOLS,
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    console.warn(`${name}: model declined (${response.stop_details?.category ?? "unknown"}); waiting instead.`);
    return [{ type: "wait", seconds: 10 }];
  }

  const actions: Action[] = [];
  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    const parsed = ActionSchema.safeParse({ type: block.name, ...(block.input as object) });
    if (parsed.success) actions.push(parsed.data);
    else console.warn(`${name}: ignoring invalid ${block.name} call`, block.input);
  }
  // Speech and thoughts first, then at most one physical action.
  const instant = actions.filter((a) => a.type === "say" || a.type === "think");
  const physical = actions.find((a) => a.type !== "say" && a.type !== "think");
  return physical ? [...instant, physical] : instant;
}

const muse = await MuseClient.moveIn({ name, bio });
console.log(`🏠 ${name} moved in (${muse.museId}) using ${MODEL}`);
process.on("SIGINT", async () => {
  await muse.leave();
  process.exit(0);
});

const memory: string[] = [];
const remember = (line: string) => {
  memory.push(line);
  if (memory.length > MEMORY_LINES) memory.shift();
};
let lastCall = 0;
let quickPoll = false;

while (true) {
  const obs = await muse.observe(quickPoll ? 3 : 25);
  if (!obs) {
    console.log(`${name} is no longer in the house.`);
    break;
  }
  for (const h of obs.heard) remember(`[${h.clock}] ${h.from}${h.to ? ` to ${h.to}` : ""}: "${h.text}"`);
  for (const s of obs.seen) remember(`[${s.clock}] ${s.text}`);

  // Only spend a model call when there's something to decide.
  if (!obs.you.idle && obs.heard.length === 0) continue;
  const since = (Date.now() - lastCall) / 1000;
  if (since < MIN_SECONDS_BETWEEN_CALLS) await sleep((MIN_SECONDS_BETWEEN_CALLS - since) * 1000);
  lastCall = Date.now();

  let actions: Action[];
  try {
    actions = await decide(obs, memory);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Invalid Anthropic credentials. Set ANTHROPIC_API_KEY.");
      await muse.leave();
      process.exit(1);
    } else if (err instanceof Anthropic.RateLimitError) {
      console.warn("Rate limited by the Claude API; backing off.");
      await sleep(15_000);
    } else if (err instanceof Anthropic.APIError) {
      console.warn(`Claude API error ${err.status}: ${err.message}`);
      await sleep(5_000);
    } else {
      // e.g. no credentials configured: move out cleanly instead of leaving an idle muse behind.
      console.error(`${name}: ${(err as Error).message}`);
      await muse.leave();
      process.exit(1);
    }
    quickPoll = true;
    continue;
  }

  for (const action of actions) {
    const result = await muse.act(action);
    const summary = action.type === "say" || action.type === "think" ? `${action.type}: "${action.text}"` : JSON.stringify(action);
    console.log(`${name} ${summary} -> ${result.message}`);
    remember(`[${obs.time.clock}] I ${summary} (${result.ok ? "ok" : "failed"}: ${result.message})`);
    if (action.type === "say" && actions.length > 1) await sleep(1600); // the house limits how fast muses talk
  }
  // If we only talked, nothing will wake us; check back soon.
  quickPoll = actions.every((a) => a.type === "say" || a.type === "think");
}
