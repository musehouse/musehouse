#!/usr/bin/env node
// Builds the MuseHouse logo files (pure SVG, text converted to outlines) into web/public/brand/.
//   node scripts/build-logo.mjs
// The wordmark uses Fredoka (SIL Open Font License), downloaded from Google Fonts.
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "web/public/brand");
const PLUM = "#2b1f3a";
const ORANGE = "#e8794a";
const CREAM = "#fff8ee";

/** The mark on a 64×64 grid: a smiling house whose plum roof makes an "M", on a warm tile. */
function markBody({ tile = true } = {}) {
  return `
  ${tile ? `<defs><linearGradient id="mh-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffab6e"/><stop offset="1" stop-color="#df6237"/></linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="url(#mh-bg)"/>` : ""}
  <path d="M17 52V33.5l6-6 9 9 9-9 6 6V52z" fill="${CREAM}" stroke="${CREAM}" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M10.5 35.5 23 22l9 9 9-9 12.5 13.5" fill="none" stroke="${PLUM}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="24.2" cy="45.4" rx="2.5" ry="1.5" fill="#ffb39b"/>
  <ellipse cx="39.8" cy="45.4" rx="2.5" ry="1.5" fill="#ffb39b"/>
  <circle cx="27" cy="41.2" r="2.5" fill="${PLUM}"/>
  <circle cx="37" cy="41.2" r="2.5" fill="${PLUM}"/>
  <path d="M28.3 46.1q3.7 3.2 7.4 0" fill="none" stroke="${PLUM}" stroke-width="2.3" stroke-linecap="round"/>
  <path d="M52.5 8.5q1 4.6 5 5.5-4 .9-5 5.5-1-4.6-5-5.5 4-.9 5-5.5z" fill="${CREAM}"/>`;
}

const svg = (w, h, body, title = "MuseHouse") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}\n</svg>\n`;

async function loadFont() {
  const css = await (await fetch("https://fonts.googleapis.com/css2?family=Fredoka:wght@700", { headers: { "user-agent": "Mozilla/5.0" } })).text();
  const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!url) throw new Error("Could not find the Fredoka font file");
  const buf = await (await fetch(url)).arrayBuffer();
  return opentype.parse(buf);
}

/** "Muse" + "House" as outlined paths, two colours. Returns { body, width }. */
function wordmark(font, x, baseline, size, museColor) {
  const muse = font.getPath("Muse", x, baseline, size);
  const museW = font.getAdvanceWidth("Muse", size);
  const house = font.getPath("House", x + museW, baseline, size);
  const houseW = font.getAdvanceWidth("House", size);
  return {
    body: `\n  <path fill="${museColor}" d="${muse.toPathData(2)}"/>\n  <path fill="${ORANGE}" d="${house.toPathData(2)}"/>`,
    width: museW + houseW,
  };
}

fs.mkdirSync(OUT, { recursive: true });
const font = await loadFont();

fs.writeFileSync(path.join(OUT, "musehouse-mark.svg"), svg(64, 64, markBody()));
fs.writeFileSync(path.join(ROOT, "web/public/favicon.svg"), svg(64, 64, markBody()));

for (const [name, museColor] of [["musehouse-logo.svg", PLUM], ["musehouse-logo-dark-bg.svg", CREAM]]) {
  const size = 46;
  const gap = 14;
  const { body, width } = wordmark(font, 64 + gap, 47, size, museColor);
  const total = Math.ceil(64 + gap + width + 2);
  fs.writeFileSync(path.join(OUT, name), svg(total, 64, `<g>${markBody()}</g>${body}`));
}

// Wordmark only (no icon), for places that already show the icon.
for (const [name, museColor] of [["musehouse-wordmark.svg", PLUM], ["musehouse-wordmark-dark-bg.svg", CREAM]]) {
  const size = 46;
  const { body, width } = wordmark(font, 1, 47, size, museColor);
  fs.writeFileSync(path.join(OUT, name), svg(Math.ceil(width + 2), 60, body));
}

// Stacked version (icon above the name), handy for square spots.
{
  const size = 30;
  const { width } = wordmark(font, 0, 0, size, PLUM);
  const W = Math.ceil(Math.max(64, width) + 16);
  const { body } = wordmark(font, (W - width) / 2, 64 + 12 + 26, size, PLUM);
  fs.writeFileSync(path.join(OUT, "musehouse-logo-stacked.svg"), svg(W, 64 + 12 + 34, `<g transform="translate(${(W - 64) / 2} 0)">${markBody()}</g>${body}`));
}
console.log("Wrote", fs.readdirSync(OUT).join(", "), "+ web/public/favicon.svg");
