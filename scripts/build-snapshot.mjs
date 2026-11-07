// Build the bundled price snapshot used when live data is unavailable.
// Usage: node scripts/build-snapshot.mjs <dir with Yahoo chart JSON files>
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeYahoo } from "../lib/yahoo.js";

const src = process.argv[2];
if (!src) throw new Error("Pass the folder that holds the downloaded Yahoo JSON files");
const indexPath = new URL("../trading/data/index.json", import.meta.url);
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
for (const f of readdirSync(new URL("../trading/data/", import.meta.url))) {
  if (!f.endsWith(".json") || f === "index.json" || f === "hillclimb.json") continue;
  const s = JSON.parse(readFileSync(new URL(`../trading/data/${f}`, import.meta.url), "utf8"));
  index[s.symbol] = { name: s.name, from: s.d[0], to: s.d.at(-1), bars: s.d.length };
}
for (const f of readdirSync(src).filter((f) => f.endsWith(".json"))) {
  const s = normalizeYahoo(JSON.parse(readFileSync(join(src, f), "utf8")));
  writeFileSync(new URL(`../trading/data/${s.symbol}.json`, import.meta.url), JSON.stringify(s));
  index[s.symbol] = { name: s.name, from: s.d[0], to: s.d.at(-1), bars: s.d.length };
}
writeFileSync(indexPath, JSON.stringify(index, null, 1));
console.log(index);
