import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
// Next already ships sharp for image processing; no additional runtime dependency.
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
await mkdir(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const [name, size, maskable] of [
  ["icon-192", 192, false], ["icon-512", 512, false],
  ["maskable-512", 512, true], ["apple-touch-icon", 180, false],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${maskable ? "#1c1814" : "#f7f3ec"}"/>
    <rect x="32" y="32" width="448" height="448" rx="120" fill="#1c1814"/>
    <g fill="none" stroke="#fffdf8" stroke-width="23" stroke-linecap="round" stroke-linejoin="round">
      <path d="M184 158 256 257 328 158M256 257V359M191 264H321M191 309H321"/>
    </g>
    <circle cx="364" cy="148" r="18" fill="#c45c26"/>
  </svg>`;
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(`../public/icons/${name}.png`, import.meta.url).pathname);
}
