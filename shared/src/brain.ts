import type { Action, Emote, NeedName, Observation } from "./index.js";

/** Personality for the rule-based brain used by the house's NPCs and the demo agents. */
export interface Persona {
  name: string;
  bio: string;
  /** `{name}` is replaced with the other muse's name. */
  greetings: string[];
  replies: string[];
  musings: string[];
  /** Verbs this muse especially enjoys. */
  favourites: string[];
  /** Gestures it likes to make (default: a mix). */
  emotes?: Emote[];
}

export interface BrainMemory {
  greeted: Set<string>;
  /** Recent replies per speaker, so two muses don't answer each other forever. */
  talk?: Map<string, { at: number; count: number }>;
}

const CONVERSATION_GAP_MS = 30_000;

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * Simple needs-driven behaviour: reply when spoken to, greet newcomers, look after the
 * lowest need, otherwise wander, muse or emote. Returns null when there's nothing to do.
 */
export function chooseAction(obs: Observation, p: Persona, memory: BrainMemory): Action | null {
  const me = obs.you;

  // 1. Reply when someone talks to us (or to the room).
  const said = obs.heard.filter((h) => !h.to || h.to === me.name);
  const last = said[said.length - 1];
  memory.talk ??= new Map();
  const thread = last && memory.talk.get(last.from);
  const recent = thread && Date.now() - thread.at < CONVERSATION_GAP_MS ? thread.count : 0;
  // Each back-and-forth with the same muse halves the chance of answering again; at most 3 replies in a row.
  if (last && recent < 3 && Math.random() < 0.8 * 0.5 ** recent) {
    memory.talk.set(last.from, { at: Date.now(), count: recent + 1 });
    const line = /\?$/.test(last.text) ? pick(p.replies) : pick([...p.replies, ...p.greetings]);
    return { type: "say", text: line.replace("{name}", last.from), to: last.from };
  }

  if (!me.idle) return null;

  // 2. Greet someone new in the room.
  const fresh = obs.muses.find((m) => m.sameRoom && !memory.greeted.has(m.id));
  if (fresh) {
    memory.greeted.add(fresh.id);
    return { type: "say", text: pick(p.greetings).replace("{name}", fresh.name), to: fresh.name };
  }

  // 3. Look after the lowest need.
  const needs = Object.entries(me.needs) as [NeedName, number][];
  needs.sort((a, b) => a[1] - b[1]);
  const [need, value] = needs[0];
  if (need === "social" && value < 45) {
    const other = obs.muses.find((m) => !m.sameRoom) ?? obs.muses[0];
    if (other) return { type: "move_to", target: other.name };
  }
  if (value < 45 || Math.random() < 0.55) {
    const target = value < 45 ? need : pick(needs.slice(0, 2))[0];
    const options = obs.objects.flatMap((o) =>
      o.inUseBy.length > 0
        ? []
        : o.verbs
            .filter((v) => (v.effects[target] ?? 0) > 0)
            .map((v) => ({ object: o.id, verb: v.verb, score: (v.effects[target] ?? 0) + (p.favourites.includes(v.verb) ? 25 : 0) })),
    );
    options.sort((a, b) => b.score - a.score);
    const choice = options.length ? pick(options.slice(0, 3)) : null;
    if (choice) return { type: "use", object: choice.object, verb: choice.verb };
  }

  // 4. Otherwise wander, muse, or emote.
  const r = Math.random();
  if (r < 0.3) return { type: "think", text: pick(p.musings) };
  if (r < 0.4) return { type: "emote", kind: pick(p.emotes ?? (["wave", "jump", "cheer", "nod"] as const)) };
  if (r < 0.75) return { type: "move_to", target: pick(obs.rooms.filter((x) => x.id !== me.room)).id };
  return { type: "wait", seconds: 3 + Math.floor(Math.random() * 5) };
}
