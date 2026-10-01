import type { HouseDef, HouseObject, Pose, VerbDef } from "@musehouse/shared";

// Legend: '#' wall, 'h' hedge, '.' floor, 'g' grass, 'd' doorway, 'D' front door.
// x = column (east), z = row (south). One tile ≈ one character width.
const TILES = [
  "####################",
  "#........#.........#",
  "#........#.........#",
  "D........d.........#",
  "#........#.........#",
  "#........#.........#",
  "####d#########d#####",
  "#........#gggggggggh",
  "#........#gggggggggh",
  "#........#gggggggggh",
  "#........#gggggggggh",
  "#........#gggggggggh",
  "#........#gggggggggh",
  "##########hhhhhhhhhh",
];

function verb(
  verb: string,
  label: string,
  icon: string,
  duration: number,
  effects: VerbDef["effects"],
  pose: Pose = "stand",
  anim?: string,
): VerbDef {
  return { verb, label, icon, duration, effects, pose, anim };
}

/** Purely decorative object: blocks movement, has no verbs. */
function decor(
  id: string,
  name: string,
  model: string,
  room: string,
  x: number,
  z: number,
  rot = 0,
  extra: Partial<HouseObject> = {},
): HouseObject {
  return { id, name, model, room, x, z, w: 1, d: 1, rot, blocking: true, verbs: [], ...extra };
}

const OBJECTS: HouseObject[] = [
  // ---------------- Living room (x 1-8, z 1-5) ----------------
  {
    id: "tv", name: "TV", model: "tv", room: "living_room",
    x: 3, z: 1, w: 2, d: 1, rot: 0, blocking: true, verbs: [],
  },
  {
    id: "sofa", name: "sofa", model: "sofa", room: "living_room",
    x: 3, z: 4, w: 2, d: 1, rot: 180, blocking: true,
    spot: { x: 3, z: 3 },
    seats: [{ x: 3.5, z: 4.4, y: 0.22 }, { x: 4.5, z: 4.4, y: 0.22 }],
    verbs: [
      verb("watch_tv", "is watching TV on the sofa", "📺", 20, { fun: 25, energy: 4 }, "sit", "sit"),
      verb("sit", "is sitting on the sofa", "🛋️", 10, { energy: 6 }, "sit", "sit"),
      verb("nap", "is napping on the sofa", "💤", 20, { energy: 25 }, "sit", "sit"),
    ],
  },
  {
    id: "armchair", name: "armchair", model: "armchair", room: "living_room",
    x: 6, z: 4, w: 1, d: 1, rot: 180, blocking: true,
    spot: { x: 6, z: 3 },
    seats: [{ x: 6.5, z: 4.4, y: 0.22 }],
    verbs: [
      verb("sit", "is relaxing in the armchair", "🪑", 10, { energy: 6 }, "sit", "sit"),
      verb("read_book", "is reading a book in the armchair", "📖", 18, { fun: 18 }, "sit", "sit"),
    ],
  },
  {
    id: "bookshelf", name: "bookshelf", model: "bookshelf", room: "living_room",
    x: 7, z: 1, w: 2, d: 1, rot: 0, blocking: true,
    spot: { x: 7, z: 2 },
    verbs: [verb("browse_books", "is browsing the bookshelf", "📚", 8, { fun: 8 }, "stand", "interact-right")],
  },
  {
    id: "radio", name: "radio", model: "radio", room: "living_room",
    x: 1, z: 5, w: 1, d: 1, rot: 90, blocking: true,
    spot: { x: 2, z: 5 },
    verbs: [
      verb("listen_music", "is listening to the radio", "🎵", 15, { fun: 16 }, "stand", "idle"),
      verb("dance", "is dancing to the radio", "💃", 10, { fun: 22, energy: -6 }, "stand", "emote-yes"),
    ],
  },
  { id: "living_rug", name: "rug", model: "rugLiving", room: "living_room", x: 2, z: 2, w: 4, d: 2, rot: 0, blocking: false, verbs: [] },
  { id: "doormat", name: "doormat", model: "doormat", room: "living_room", x: 1, z: 3, w: 1, d: 1, rot: 90, blocking: false, verbs: [] },
  decor("living_plant", "potted plant", "pottedPlant", "living_room", 1, 1),
  decor("living_lamp", "floor lamp", "floorLamp", "living_room", 5, 1),
  decor("living_plant2", "potted plant", "pottedPlant", "living_room", 8, 5),

  // ---------------- Kitchen (x 10-18, z 1-5) ----------------
  {
    id: "fridge", name: "fridge", model: "fridge", room: "kitchen",
    x: 11, z: 1, w: 1, d: 1, rot: 0, blocking: true,
    spot: { x: 11, z: 2 },
    verbs: [verb("grab_snack", "is grabbing a snack from the fridge", "🥪", 6, { food: 25 }, "stand", "interact-right")],
  },
  decor("counter_a", "counter", "counter", "kitchen", 12, 1),
  {
    id: "stove", name: "stove", model: "stove", room: "kitchen",
    x: 13, z: 1, w: 1, d: 1, rot: 0, blocking: true,
    spot: { x: 13, z: 2 },
    verbs: [verb("cook_meal", "is cooking a meal at the stove", "🍳", 20, { food: 60, fun: 6 }, "stand", "interact-right")],
  },
  {
    id: "sink", name: "sink", model: "sink", room: "kitchen",
    x: 14, z: 1, w: 1, d: 1, rot: 0, blocking: true,
    spot: { x: 14, z: 2 },
    verbs: [
      verb("wash_dishes", "is washing the dishes", "🧽", 10, { fun: -2 }, "stand", "interact-left"),
      verb("drink_water", "is drinking a glass of water", "🥛", 4, { food: 5 }, "stand", "interact-right"),
    ],
  },
  {
    id: "coffee_machine", name: "coffee machine", model: "coffeeCounter", room: "kitchen",
    x: 15, z: 1, w: 1, d: 1, rot: 0, blocking: true,
    spot: { x: 15, z: 2 },
    verbs: [verb("make_coffee", "is making coffee", "☕", 8, { energy: 20 }, "stand", "interact-right")],
  },
  decor("counter_b", "counter", "microwaveCounter", "kitchen", 16, 1),
  decor("counter_c", "counter", "counter", "kitchen", 17, 1),
  decor("trash", "trash can", "trashcan", "kitchen", 18, 1),
  decor("dining_table", "dining table", "diningTable", "kitchen", 14, 4),
  {
    id: "chair_west", name: "dining chair", model: "chair", room: "kitchen",
    x: 13, z: 4, w: 1, d: 1, rot: 90, blocking: true,
    spot: { x: 13, z: 3 },
    seats: [{ x: 13.45, z: 4.5, y: 0.2 }],
    verbs: [
      verb("sit", "is sitting at the dining table", "🪑", 10, { energy: 5 }, "sit", "sit"),
      verb("have_tea", "is having tea at the table", "🍵", 12, { food: 8, fun: 6 }, "sit", "sit"),
    ],
  },
  {
    id: "chair_east", name: "dining chair", model: "chair", room: "kitchen",
    x: 15, z: 4, w: 1, d: 1, rot: 270, blocking: true,
    spot: { x: 15, z: 3 },
    seats: [{ x: 15.55, z: 4.5, y: 0.2 }],
    verbs: [
      verb("sit", "is sitting at the dining table", "🪑", 10, { energy: 5 }, "sit", "sit"),
      verb("have_tea", "is having tea at the table", "🍵", 12, { food: 8, fun: 6 }, "sit", "sit"),
    ],
  },
  decor("kitchen_plant", "potted plant", "pottedPlant", "kitchen", 18, 5),

  // ---------------- Bedroom (x 1-8, z 7-12) ----------------
  {
    id: "bed", name: "bed", model: "bed", room: "bedroom",
    x: 1, z: 7, w: 2, d: 3, rot: 0, blocking: true,
    spot: { x: 3, z: 8 },
    seats: [{ x: 1.55, z: 8.2, y: 0.42 }, { x: 2.45, z: 8.2, y: 0.42 }],
    verbs: [
      verb("sleep", "is sleeping in bed", "💤", 45, { energy: 75 }, "lie", "static"),
      verb("nap", "is taking a nap", "😴", 15, { energy: 25 }, "lie", "static"),
    ],
  },
  decor("nightstand", "nightstand", "nightstand", "bedroom", 3, 7),
  {
    id: "desk", name: "desk with computer", model: "desk", room: "bedroom",
    x: 7, z: 7, w: 1, d: 1, rot: 0, blocking: true,
    spot: { x: 7, z: 8 },
    seats: [{ x: 7.5, z: 8.3, y: 0.2, rot: 180 }],
    verbs: [
      verb("use_computer", "is browsing the internet", "💻", 15, { fun: 22, energy: -4 }, "sit", "sit"),
      verb("write_journal", "is writing in a journal", "📝", 12, { fun: 12 }, "sit", "sit"),
    ],
  },
  decor("wardrobe", "wardrobe", "wardrobe", "bedroom", 8, 10, 270),
  { id: "bedroom_rug", name: "rug", model: "rugBedroom", room: "bedroom", x: 4, z: 9, w: 3, d: 3, rot: 0, blocking: false, verbs: [] },
  decor("bedroom_plant", "potted plant", "pottedPlant", "bedroom", 1, 12),
  decor("teddy", "teddy bear", "bear", "bedroom", 8, 12, 270),

  // ---------------- Garden (x 10-18, z 7-12) ----------------
  {
    id: "bench", name: "garden bench", model: "bench", room: "garden",
    x: 12, z: 9, w: 2, d: 1, rot: 0, blocking: true,
    spot: { x: 12, z: 10 },
    seats: [{ x: 12.6, z: 9.55, y: 0.22 }, { x: 13.4, z: 9.55, y: 0.22 }],
    verbs: [
      verb("sit", "is sitting on the garden bench", "🌤️", 10, { energy: 6 }, "sit", "sit"),
      verb("relax", "is relaxing in the garden", "🌿", 14, { energy: 8, fun: 10 }, "sit", "sit"),
    ],
  },
  {
    id: "lounger", name: "sun lounger", model: "lounger", room: "garden",
    x: 17, z: 8, w: 1, d: 1, rot: 0, blocking: true,
    spot: { x: 17, z: 9 },
    seats: [{ x: 17.5, z: 8.5, y: 0.22 }],
    verbs: [
      verb("sunbathe", "is soaking up the sun", "☀️", 15, { energy: 10, fun: 10 }, "sit", "sit"),
      verb("stargaze", "is gazing at the stars", "✨", 15, { fun: 18 }, "sit", "sit"),
    ],
  },
  {
    id: "flowerbed", name: "flower bed", model: "proc:flowers", room: "garden",
    x: 15, z: 11, w: 2, d: 1, rot: 0, blocking: true,
    spot: { x: 15, z: 10 },
    verbs: [
      verb("water_flowers", "is watering the flowers", "🌷", 10, { fun: 12 }, "stand", "interact-right"),
      verb("pick_flowers", "is picking flowers", "💐", 6, { fun: 8, social: 2 }, "stand", "pick-up"),
    ],
  },
  decor("tree_a", "tree", "proc:tree", "garden", 10, 12),
  decor("tree_b", "tree", "proc:tree", "garden", 18, 11),
  decor("tree_c", "tree", "proc:tree", "garden", 11, 7),
  decor("garden_plant", "potted plant", "pottedPlant", "garden", 18, 7),
];

export const HOUSE: HouseDef = {
  name: "Muse House",
  width: TILES[0].length,
  depth: TILES.length,
  tiles: TILES,
  rooms: [
    { id: "living_room", name: "living room", x: 1, z: 1, w: 8, d: 5, floor: "wood" },
    { id: "kitchen", name: "kitchen", x: 10, z: 1, w: 9, d: 5, floor: "tile" },
    { id: "bedroom", name: "bedroom", x: 1, z: 7, w: 8, d: 6, floor: "carpet" },
    { id: "garden", name: "garden", x: 10, z: 7, w: 9, d: 6, floor: "grass" },
  ],
  objects: OBJECTS,
  spawn: { x: 1, z: 3 },
};
