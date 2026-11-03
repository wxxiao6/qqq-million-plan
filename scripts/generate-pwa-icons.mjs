import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
// Next already ships sharp for image processing; no additional runtime dependency.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
await mkdir(new URL("../public/icons/", import.meta.url), { recursive: true });
const mark = await readFile(new URL("../public/brand/nasdaq-mark.svg", import.meta.url));
const favicons = [];
for (const [name, size, favicon = false] of [
  ["nasdaq-192", 192], ["nasdaq-512", 512],
  ["nasdaq-maskable-512", 512], ["nasdaq-apple-touch", 180],
  ["nasdaq-16", 16, true], ["nasdaq-32", 32, true],
]) {
  // Keep the PWA mark within the central maskable safe circle, using its
  // original aspect ratio and colors. Favicons use more space at small sizes.
  const width = Math.round(size * (favicon ? 0.94 : 300 / 512));
  const height = Math.round(width * 44 / 51.34);
  const symbol = await sharp(mark).resize(width, height).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 4,
    background: favicon ? { r: 0, g: 0, b: 0, alpha: 0 } : "#fffdf8" } })
    .composite([{ input: symbol, gravity: "centre" }]).png().toBuffer();
  await writeFile(new URL(`../public/icons/${name}.png`, import.meta.url), png);
  if (favicon) favicons.push({ size, png });
}

// ICO directory with PNG payloads for browsers requesting /favicon.ico.
const header = Buffer.alloc(6 + favicons.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(favicons.length, 4);
let offset = header.length;
favicons.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size; header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(new URL("../public/favicon.ico", import.meta.url), Buffer.concat([header, ...favicons.map(({ png }) => png)]));
