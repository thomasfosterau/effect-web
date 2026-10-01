/**
 * Import guard for the packages that publish on Effect rc.118 (effect-web#31):
 * the built `dist/` of effect-web, effect-web-robots and effect-web-sitemap
 * must import no removed `effect/unstable/*` path and nothing from the
 * alchemy runtime (`alchemy`, `@distilled.cloud/*`), which cannot load on
 * rc.118 until it ships a new build. Run after `vp run -r build`
 * (`vp run check:dist`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packages = ["web", "robots", "sitemap"];
const forbidden = [
  /["'`]effect\/(?:unstable|httpapi)(?:\/[^"'`]*)?["'`]/,
  /["'`]alchemy(?:\/[^"'`]*)?["'`]/,
  /["'`]@distilled\.cloud\/[^"'`]*["'`]/,
];

const failures = [];
for (const name of packages) {
  const dist = join("packages", name, "dist");
  const files = readdirSync(dist, { recursive: true, encoding: "utf8" }).filter((f) =>
    /\.(?:js|mjs|cjs|d\.ts|d\.mts|d\.cts)$/.test(f),
  );
  if (files.length === 0) failures.push(`${dist}: no built files (run vp run -r build first)`);
  for (const file of files) {
    const text = readFileSync(join(dist, file), "utf8");
    for (const pattern of forbidden) {
      const hit = text.match(pattern);
      if (hit) failures.push(`${join(dist, file)}: imports ${hit[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `check:dist: ${packages.length} packages import no effect/unstable, alchemy or @distilled.cloud`,
);
