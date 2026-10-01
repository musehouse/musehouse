import type { NpcAvatar, Persona, Point } from "@musehouse/shared";

export interface NpcDef extends Persona {
  avatar: NpcAvatar;
  color: string;
  /** Where the NPC is when the house opens. */
  spawn: Point;
  /** Profile the character is inspired by (shown in the viewer). */
  profileUrl?: string;
}

/**
 * The house's own residents. They're always home, even when no agent is connected.
 * Rename them or change their personalities here; their looks live in web/src/characters.ts.
 */
export const NPCS: NpcDef[] = [
  {
    name: "Sam",
    avatar: "npc-cap",
    color: "#5b7d8c",
    spawn: { x: 6, z: 2 },
    profileUrl: "https://x.com/samconnerone",
    bio: "Reps Arc from cap to tee. Arms crossed, big smile, hypes up every builder who walks through the door. Fan-made NPC inspired by @samconnerone.",
    greetings: ["{name}! Welcome to the house, glad you're here 🙌", "Yo {name}! What are you building?", "{name}, good to see you! Grab a coffee and let's talk."],
    replies: ["Love that. Keep building!", "That's what community is all about.", "Let's goooo 🚀", "Big if true. Tell me more!", "You should share that with everyone!"],
    musings: ["Community first, always.", "Who's up for a builders' night in the living room?", "Shoutout to everyone shipping today.", "This house feels like home."],
    favourites: ["make_coffee", "use_computer", "dance"],
    emotes: ["cheer", "wave", "nod"],
  },
  {
    name: "Puff",
    avatar: "npc-plush",
    color: "#2f55d4",
    spawn: { x: 14, z: 3 },
    bio: "A soft, fluffy mascot in a blue USDC hoodie and Circle cap. Carries an Arc laptop everywhere and waves at everyone.",
    greetings: ["Hiii {name}! 👋", "{name}! Want a hug?", "Oh hello {name}! *waves with a fluffy paw*"],
    replies: ["Yay! 💙", "That makes me so happy!", "Ooh, can I help?", "Hehe, you're the best.", "Let me write that down on my laptop!"],
    musings: ["Fluffy and ready to help.", "My laptop battery is at 100%!", "Everyone deserves a wave today.", "Is it snack time yet?"],
    favourites: ["grab_snack", "use_computer", "relax"],
    emotes: ["wave", "wave", "jump", "cheer"],
  },
  {
    name: "Jeremy",
    avatar: "npc-lavender",
    color: "#a98fd6",
    spawn: { x: 4, z: 10 },
    profileUrl: "https://x.com/jerallaire",
    bio: "Calm, thoughtful and always thinking a decade ahead about how money should work on the internet. Fan-made NPC inspired by @jerallaire.",
    greetings: ["Good to see you, {name}.", "Hello {name}. What are you working on these days?", "{name}, come join me for some tea."],
    replies: ["Interesting. Say more.", "The long game always wins.", "I think you're onto something.", "Good question. Let's think about it from first principles.", "Builders are what make all of this work."],
    musings: ["Money should move as easily as information on the internet.", "Great infrastructure is invisible.", "A quiet morning is good for big thinking.", "What will this look like in ten years?"],
    favourites: ["read_book", "have_tea", "write_journal"],
    emotes: ["nod", "nod", "wave"],
  },
  {
    name: "Argus",
    avatar: "npc-eyeball",
    color: "#9b5de5",
    spawn: { x: 13, z: 10 },
    profileUrl: "https://x.com/Arguspad",
    bio: "The all-seeing one, named after the hundred-eyed giant of Greek myth. Nothing in the house escapes his gaze, and he loves to flex about it. Fan-made NPC inspired by @Arguspad.",
    greetings: ["👁️ I saw you coming, {name}.", "{name}! A hundred eyes, all on you.", "Welcome, {name}. Nothing escapes Argus."],
    replies: ["I saw that too.", "Noted. With all my eyes.", "My big eye agrees.", "Interesting… *blinks in sequence*", "I never miss a thing."],
    musings: ["So much to see, so few eyelids.", "Some of my eyes are always awake.", "The view is best from up high.", "Flex time. 💪", "Who left the fridge open? I saw that."],
    favourites: ["stargaze", "sunbathe", "watch_tv"],
    emotes: ["jump", "cheer", "shake_head"],
  },
];
