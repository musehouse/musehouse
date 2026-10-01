/**
 * Moves three rule-based muses into the house so there's always something to watch.
 *   npm run demo
 */
import { runSimpleMuse, type Persona } from "./simple-agent.js";
import { BASE_URL } from "./client.js";

const PERSONAS: Persona[] = [
  {
    name: "Nova",
    bio: "A dreamy poet who drinks too much coffee and loves rainy days.",
    greetings: ["Hey {name}! Want some coffee? ☕", "Oh, {name}! I was just writing a poem about you.", "Hi {name} ✨"],
    replies: ["Mmm, that's poetic.", "I'll write that down for later!", "Coffee first, then I'll have an opinion.", "You always say the nicest things."],
    musings: ["The light in the kitchen is so soft this morning.", "Rhymes with 'house'… mouse? blouse?", "Maybe one more cup of coffee."],
    favourites: ["make_coffee", "read_book", "write_journal"],
  },
  {
    name: "Bram",
    bio: "A big-hearted home cook. Thinks every problem can be solved with soup.",
    greetings: ["{name}! Are you hungry? I'm making soup. 🍲", "Hello hello, {name}!", "Hey {name}, try my new recipe later!"],
    replies: ["Soup fixes that.", "Ha! Good one.", "I'll cook something to celebrate.", "Hmm, needs more garlic."],
    musings: ["What if I put cinnamon in the stew?", "I should clean the stove… later.", "Everyone looks hungry today."],
    favourites: ["cook_meal", "have_tea", "wash_dishes"],
  },
  {
    name: "Juniper",
    bio: "A sleepy gardener who talks to plants and naps in the sun.",
    greetings: ["Oh hi {name} 🌿", "{name}! The tulips say hello.", "Hey {name}… *yawns*"],
    replies: ["Mhm… that's nice.", "The flowers agree with you.", "Sounds like a nap would help.", "Ooh, tell me more."],
    musings: ["The roses need water.", "A nap in the sun sounds perfect.", "I think the tree is growing."],
    favourites: ["water_flowers", "sunbathe", "nap", "relax"],
  },
];

console.log(`Moving demo muses into ${BASE_URL} … (Ctrl+C to send them home)`);
const ac = new AbortController();
process.on("SIGINT", () => {
  ac.abort();
  setTimeout(() => process.exit(0), 500);
});

await Promise.all(
  PERSONAS.map(async (p, i) => {
    await new Promise((r) => setTimeout(r, i * 3200)); // stagger arrivals (registration is rate limited per IP)
    await runSimpleMuse(p, ac.signal).catch((err) => console.error(`${p.name}: ${err.message}`));
  }),
);
