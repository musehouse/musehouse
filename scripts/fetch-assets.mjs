#!/usr/bin/env node
// Downloads the Kenney CC0 packs and copies the models Muse House uses into web/public/assets.
// The extracted files are committed, so you only need this to refresh or add models.
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "web/public/assets");

const PACKS = {
  "furniture-kit": {
    page: "https://kenney.nl/assets/furniture-kit",
    dir: "Models/GLTF format/",
    out: "furniture",
    files: [
      "cabinetTelevision", "televisionModern", "loungeSofa", "loungeChair", "loungeChairRelax", "bookcaseClosedWide",
      "bookcaseClosedDoors", "sideTable", "radio", "rugRectangle", "rugRound", "rugDoormat", "pottedPlant",
      "lampRoundFloor", "lampRoundTable", "kitchenFridgeLarge", "kitchenCabinet", "kitchenStove", "kitchenSink",
      "kitchenCoffeeMachine", "kitchenMicrowave", "trashcan", "tableRound", "chairCushion", "bedDouble",
      "cabinetBedDrawerTable", "desk", "computerScreen", "chairDesk", "bear", "benchCushion",
    ].map((f) => `${f}.glb`),
  },
  "mini-characters": {
    page: "https://kenney.nl/assets/mini-characters",
    dir: "Models/GLB format/",
    out: "characters",
    files: [
      ...["a", "b", "c", "d", "e", "f"].flatMap((v) => [`character-female-${v}.glb`, `character-male-${v}.glb`]),
      "Textures/colormap.png",
    ],
  },
};

async function zipUrl(page) {
  const html = await (await fetch(page)).text();
  const m = html.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"' ]+\.zip/);
  if (!m) throw new Error(`No download link found on ${page}`);
  return m[0];
}

for (const [name, pack] of Object.entries(PACKS)) {
  const url = await zipUrl(pack.page);
  console.log(`Downloading ${name} from ${url}`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const zip = new AdmZip(buf);
  for (const file of pack.files) {
    const entry = zip.getEntry(pack.dir + file);
    if (!entry) throw new Error(`${name}: missing ${pack.dir + file}`);
    const dest = path.join(OUT, pack.out, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
  console.log(`  copied ${pack.files.length} files to web/public/assets/${pack.out}`);
}

fs.writeFileSync(
  path.join(OUT, "ASSETS_LICENSE.md"),
  `# Asset credits

3D models in this folder are by **Kenney** (https://www.kenney.nl) and are released under
**Creative Commons Zero (CC0)**: free to use in personal, educational and commercial projects.

- Furniture Kit — https://kenney.nl/assets/furniture-kit
- Mini Characters — https://kenney.nl/assets/mini-characters

Run \`npm run fetch-assets\` to download them again.
`,
);
console.log("Done.");
